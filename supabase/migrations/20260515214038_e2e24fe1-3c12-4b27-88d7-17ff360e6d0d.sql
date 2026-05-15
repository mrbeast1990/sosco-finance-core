
-- 1) Funders: add project linkage columns
ALTER TABLE public.funders
  ADD COLUMN IF NOT EXISTS project_code TEXT,
  ADD COLUMN IF NOT EXISTS is_project BOOLEAN NOT NULL DEFAULT true;

-- 2) Expenses: add Excel attachment
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS excel_attachment_url TEXT;

-- 3) Backfill: link existing funders to projects with matching name
UPDATE public.funders f
SET project_code = p.code, is_project = true
FROM public.projects p
WHERE p.deleted_at IS NULL
  AND p.name = f.name
  AND f.project_code IS NULL;

-- Mark unmatched funders as non-projects (no auto-create on backfill)
UPDATE public.funders SET is_project = false WHERE project_code IS NULL;

-- 4) Trigger to sync funder → project
CREATE OR REPLACE FUNCTION public.funders_sync_project()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id UUID;
BEGIN
  IF NEW.is_project IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.project_code IS NULL OR length(trim(NEW.project_code)) = 0 THEN
    RAISE EXCEPTION 'رقم المشروع مطلوب عند تفعيل خيار "هذا الممول مشروع"';
  END IF;

  SELECT id INTO v_existing_id FROM public.projects WHERE code = NEW.project_code AND deleted_at IS NULL;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.projects (code, name, status, created_by)
    VALUES (NEW.project_code, NEW.name, 'active', NEW.created_by);
  ELSE
    UPDATE public.projects SET name = NEW.name WHERE id = v_existing_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS funders_sync_project_trg ON public.funders;
CREATE TRIGGER funders_sync_project_trg
  AFTER INSERT OR UPDATE OF name, project_code, is_project ON public.funders
  FOR EACH ROW EXECUTE FUNCTION public.funders_sync_project();

-- 5) Update create_expense_atomic to accept excel attachment
CREATE OR REPLACE FUNCTION public.create_expense_atomic(
  _project_id uuid, _category_id uuid, _amount numeric, _expense_date date,
  _description text, _attachment_url text, _allocations jsonb,
  _excel_attachment_url text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_expense_id UUID;
  v_entry_id UUID;
  v_expense_account UUID;
  v_alloc_total NUMERIC := 0;
  v_alloc JSONB;
  v_check_id UUID;
  v_amt NUMERIC;
  v_remaining NUMERIC;
  v_cash_row RECORD;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'غير مصرح: يجب تسجيل الدخول'; END IF;
  IF NOT public.has_permission(v_user_id, 'expenses.create') THEN
    RAISE EXCEPTION 'غير مصرح بتسجيل المصروفات';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'مبلغ المصروف يجب أن يكون أكبر من صفر'; END IF;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_alloc_total := v_alloc_total + (v_alloc->>'amount')::NUMERIC;
  END LOOP;
  IF ROUND(v_alloc_total, 2) <> ROUND(_amount, 2) THEN
    RAISE EXCEPTION 'مجموع التخصيصات (%) لا يساوي مبلغ المصروف (%)', v_alloc_total, _amount;
  END IF;

  SELECT expense_account_id INTO v_expense_account FROM public.expense_categories WHERE id = _category_id;
  IF v_expense_account IS NULL THEN RAISE EXCEPTION 'فئة المصروف غير صالحة'; END IF;

  INSERT INTO public.expenses (project_id, category_id, amount, expense_date, description, attachment_url, excel_attachment_url, created_by)
  VALUES (_project_id, _category_id, _amount, _expense_date, _description, _attachment_url, _excel_attachment_url, v_user_id)
  RETURNING id INTO v_expense_id;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_check_id := (v_alloc->>'funding_check_id')::UUID;
    v_amt := (v_alloc->>'amount')::NUMERIC;
    INSERT INTO public.expense_funding_allocations (expense_id, funding_check_id, amount)
    VALUES (v_expense_id, v_check_id, v_amt);
    v_remaining := public.check_remaining(v_check_id);
    IF v_remaining < 0 THEN
      RAISE EXCEPTION 'تم تجاوز رصيد الصك (المتبقي: %)', v_remaining;
    END IF;
  END LOOP;

  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (_expense_date, COALESCE(_description, 'مصروف'), 'expense', v_expense_id, v_user_id)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_entry_id, v_expense_account, _amount, 0, COALESCE(_description, 'مصروف'));

  FOR v_cash_row IN
    SELECT ca.account_id AS ledger_account, ca.name AS cash_name, SUM((a.value->>'amount')::NUMERIC) AS total
    FROM jsonb_array_elements(_allocations) AS a(value)
    JOIN public.funding_checks fc ON fc.id = (a.value->>'funding_check_id')::UUID
    JOIN public.cash_accounts ca ON ca.id = fc.cash_account_id
    GROUP BY ca.account_id, ca.name
  LOOP
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_cash_row.ledger_account, 0, v_cash_row.total, 'دفع من ' || v_cash_row.cash_name);
  END LOOP;

  UPDATE public.expenses SET journal_entry_id = v_entry_id WHERE id = v_expense_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'create', 'expense', v_expense_id,
          jsonb_build_object('amount', _amount, 'allocations', _allocations,
                             'project_id', _project_id, 'category_id', _category_id));

  RETURN v_expense_id;
END $function$;
