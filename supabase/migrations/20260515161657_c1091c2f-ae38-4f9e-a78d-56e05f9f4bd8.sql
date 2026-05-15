-- 1. Seed default cash accounts if missing (idempotent)
INSERT INTO public.cash_accounts (name, type, account_id, is_active)
SELECT 'الصندوق الرئيسي', 'cashbox'::cash_account_type, id, true
FROM public.accounts WHERE code = '1011'
  AND NOT EXISTS (SELECT 1 FROM public.cash_accounts WHERE type = 'cashbox');

INSERT INTO public.cash_accounts (name, type, account_id, is_active)
SELECT 'الحساب البنكي', 'bank'::cash_account_type, id, true
FROM public.accounts WHERE code = '1012'
  AND NOT EXISTS (SELECT 1 FROM public.cash_accounts WHERE type = 'bank');

INSERT INTO public.cash_accounts (name, type, account_id, is_active)
SELECT 'صندوق الميدان', 'field'::cash_account_type, id, true
FROM public.accounts WHERE code = '1013'
  AND NOT EXISTS (SELECT 1 FROM public.cash_accounts WHERE type = 'field');

-- 2. Add cash_account_id to funding_checks
ALTER TABLE public.funding_checks
  ADD COLUMN cash_account_id UUID REFERENCES public.cash_accounts(id) ON DELETE RESTRICT;

-- Backfill existing checks with default cashbox
UPDATE public.funding_checks
SET cash_account_id = (SELECT id FROM public.cash_accounts WHERE type = 'cashbox' LIMIT 1)
WHERE cash_account_id IS NULL;

ALTER TABLE public.funding_checks ALTER COLUMN cash_account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_funding_checks_cash_account ON public.funding_checks(cash_account_id);

-- 3. Drop expenses.payment_account_id (no longer needed)
ALTER TABLE public.expenses DROP COLUMN IF EXISTS payment_account_id;

-- 4. Rewrite create_expense_atomic — payment account derived from allocations
DROP FUNCTION IF EXISTS public.create_expense_atomic(uuid, uuid, uuid, numeric, date, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.create_expense_atomic(
  _project_id uuid,
  _category_id uuid,
  _amount numeric,
  _expense_date date,
  _description text,
  _attachment_url text,
  _allocations jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  -- Validate allocations sum
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_alloc_total := v_alloc_total + (v_alloc->>'amount')::NUMERIC;
  END LOOP;
  IF ROUND(v_alloc_total, 2) <> ROUND(_amount, 2) THEN
    RAISE EXCEPTION 'مجموع التخصيصات (%) لا يساوي مبلغ المصروف (%)', v_alloc_total, _amount;
  END IF;

  SELECT expense_account_id INTO v_expense_account FROM public.expense_categories WHERE id = _category_id;
  IF v_expense_account IS NULL THEN RAISE EXCEPTION 'فئة المصروف غير صالحة'; END IF;

  -- Insert expense (no payment_account_id anymore)
  INSERT INTO public.expenses (project_id, category_id, amount, expense_date, description, attachment_url, created_by)
  VALUES (_project_id, _category_id, _amount, _expense_date, _description, _attachment_url, v_user_id)
  RETURNING id INTO v_expense_id;

  -- Insert allocations + balance check
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

  -- Journal entry
  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (_expense_date, COALESCE(_description, 'مصروف'), 'expense', v_expense_id, v_user_id)
  RETURNING id INTO v_entry_id;

  -- Debit: expense category account (full amount)
  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_entry_id, v_expense_account, _amount, 0, COALESCE(_description, 'مصروف'));

  -- Credit: one line per cash account, summed across allocations
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
END $$;

-- 5. Rewrite reverse_expense_atomic to mirror new logic
CREATE OR REPLACE FUNCTION public.reverse_expense_atomic(_expense_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_exp public.expenses%ROWTYPE;
  v_entry_id UUID;
  v_expense_account UUID;
  v_cash_row RECORD;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT public.has_permission(v_user_id, 'expenses.delete') THEN
    RAISE EXCEPTION 'غير مصرح بعكس/حذف المصروفات';
  END IF;

  SELECT * INTO v_exp FROM public.expenses WHERE id = _expense_id AND deleted_at IS NULL;
  IF v_exp.id IS NULL THEN RAISE EXCEPTION 'المصروف غير موجود أو محذوف'; END IF;

  SELECT expense_account_id INTO v_expense_account FROM public.expense_categories WHERE id = v_exp.category_id;

  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (CURRENT_DATE, 'عكس مصروف: ' || COALESCE(_reason,''), 'expense_reversal', _expense_id, v_user_id)
  RETURNING id INTO v_entry_id;

  -- Reverse: debit each cash account, credit expense category
  FOR v_cash_row IN
    SELECT ca.account_id AS ledger_account, ca.name AS cash_name, SUM(a.amount) AS total
    FROM public.expense_funding_allocations a
    JOIN public.funding_checks fc ON fc.id = a.funding_check_id
    JOIN public.cash_accounts ca ON ca.id = fc.cash_account_id
    WHERE a.expense_id = _expense_id
    GROUP BY ca.account_id, ca.name
  LOOP
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_cash_row.ledger_account, v_cash_row.total, 0, 'استرجاع إلى ' || v_cash_row.cash_name);
  END LOOP;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_entry_id, v_expense_account, 0, v_exp.amount, 'عكس قيد المصروف');

  UPDATE public.expenses SET deleted_at = now(), updated_by = v_user_id, updated_at = now() WHERE id = _expense_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'reverse', 'expense', _expense_id, jsonb_build_object('reason', _reason));
END $$;