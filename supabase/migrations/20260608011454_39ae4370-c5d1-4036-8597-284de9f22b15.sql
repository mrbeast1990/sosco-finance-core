
-- ============================================================
-- 1) New GL accounts (idempotent)
-- ============================================================
INSERT INTO public.accounts (code, name, type, is_system, parent_id)
SELECT v.code, v.name, v.type::public.account_type, true, NULL
FROM (VALUES
  ('1020', 'البنك', 'asset'),
  ('1500', 'الأصول الثابتة', 'asset'),
  ('3100', 'مسحوبات الشركاء/المالكين', 'equity')
) AS v(code, name, type)
WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.code = v.code);

-- ============================================================
-- 2) Assets table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_code TEXT NOT NULL UNIQUE,
  asset_name TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  serial_number TEXT,
  plate_number TEXT,
  purchase_date DATE,
  purchase_value NUMERIC,
  current_value NUMERIC,
  current_location TEXT,
  responsible_person TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY assets_select ON public.assets FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'assets.view'));
CREATE POLICY assets_insert ON public.assets FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'assets.create'));
CREATE POLICY assets_update ON public.assets FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'assets.update'));
CREATE POLICY assets_delete ON public.assets FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'assets.delete'));

-- ============================================================
-- 3) Owner withdrawals table
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS public.withdrawal_seq START 1;

CREATE TABLE IF NOT EXISTS public.owner_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_no TEXT NOT NULL UNIQUE DEFAULT ('WD-' || nextval('public.withdrawal_seq')::TEXT),
  withdrawal_date DATE NOT NULL DEFAULT CURRENT_DATE,
  person_name TEXT NOT NULL,
  person_role TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,
  cash_account_id UUID REFERENCES public.cash_accounts(id),
  funding_check_id UUID REFERENCES public.funding_checks(id),
  project_id UUID REFERENCES public.projects(id),
  description TEXT,
  attachment_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  journal_entry_id UUID,
  reversal_entry_id UUID,
  created_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES auth.users(id),
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_withdrawals TO authenticated;
GRANT ALL ON public.owner_withdrawals TO service_role;
ALTER TABLE public.owner_withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY withdrawals_select ON public.owner_withdrawals FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'withdrawals.view'));
CREATE POLICY withdrawals_insert ON public.owner_withdrawals FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'withdrawals.create'));
CREATE POLICY withdrawals_update ON public.owner_withdrawals FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'withdrawals.update')
      OR public.has_permission(auth.uid(), 'withdrawals.approve')
      OR public.has_permission(auth.uid(), 'withdrawals.cancel'));
CREATE POLICY withdrawals_delete ON public.owner_withdrawals FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'withdrawals.delete'));

-- ============================================================
-- 4) Extend expenses table
-- ============================================================
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS expense_scope TEXT NOT NULL DEFAULT 'project',
  ADD COLUMN IF NOT EXISTS asset_id UUID REFERENCES public.assets(id),
  ADD COLUMN IF NOT EXISTS asset_expense_type TEXT,
  ADD COLUMN IF NOT EXISTS asset_cost_treatment TEXT;

-- Existing rows already have project_id, ensure scope='project'
UPDATE public.expenses SET expense_scope = 'project' WHERE expense_scope IS NULL OR expense_scope = '';

-- Make project_id nullable for general/asset scopes
ALTER TABLE public.expenses ALTER COLUMN project_id DROP NOT NULL;

-- ============================================================
-- 5) Permissions
-- ============================================================
INSERT INTO public.permissions (code, name, module) VALUES
  ('withdrawals.view',     'عرض المسحوبات',       'withdrawals'),
  ('withdrawals.create',   'إنشاء مسحوبة',         'withdrawals'),
  ('withdrawals.update',   'تعديل مسحوبة',         'withdrawals'),
  ('withdrawals.approve',  'اعتماد مسحوبة',        'withdrawals'),
  ('withdrawals.cancel',   'إلغاء مسحوبة',         'withdrawals'),
  ('withdrawals.delete',   'حذف مسحوبة',           'withdrawals'),
  ('withdrawals.reports',  'تقارير المسحوبات',     'withdrawals'),
  ('assets.view',          'عرض الأصول',           'assets'),
  ('assets.create',        'إنشاء أصل',             'assets'),
  ('assets.update',        'تعديل أصل',             'assets'),
  ('assets.delete',        'حذف أصل',               'assets'),
  ('assets.reports',       'تقارير الأصول',         'assets')
ON CONFLICT (code) DO NOTHING;

-- Grant all new permissions to admin role
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code = 'admin'
  AND p.code IN (
    'withdrawals.view','withdrawals.create','withdrawals.update',
    'withdrawals.approve','withdrawals.cancel','withdrawals.delete','withdrawals.reports',
    'assets.view','assets.create','assets.update','assets.delete','assets.reports'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- 6) Withdrawals functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_withdrawal_atomic(
  _withdrawal_date DATE,
  _person_name TEXT,
  _person_role TEXT,
  _amount NUMERIC,
  _payment_method TEXT,
  _cash_account_id UUID,
  _funding_check_id UUID,
  _project_id UUID,
  _description TEXT,
  _attachment_url TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_id UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT public.has_permission(v_user_id, 'withdrawals.create') THEN
    RAISE EXCEPTION 'غير مصرح بإنشاء المسحوبات';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;
  IF _person_role NOT IN ('owner','partner','manager','other') THEN
    RAISE EXCEPTION 'دور غير صالح';
  END IF;
  IF _payment_method NOT IN ('cash','bank_transfer','check','other') THEN
    RAISE EXCEPTION 'طريقة دفع غير صالحة';
  END IF;

  INSERT INTO public.owner_withdrawals (
    withdrawal_date, person_name, person_role, amount, payment_method,
    cash_account_id, funding_check_id, project_id, description, attachment_url,
    status, created_by
  ) VALUES (
    _withdrawal_date, _person_name, _person_role, _amount, _payment_method,
    _cash_account_id, _funding_check_id, _project_id, _description, _attachment_url,
    'draft', v_user_id
  ) RETURNING id INTO v_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'create', 'withdrawal', v_id,
          jsonb_build_object('amount', _amount, 'person', _person_name, 'role', _person_role));

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.approve_withdrawal_atomic(_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_w public.owner_withdrawals%ROWTYPE;
  v_entry_id UUID;
  v_withdrawal_account UUID;
  v_cash_account UUID;
  v_cash_name TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT public.has_permission(v_user_id, 'withdrawals.approve') THEN
    RAISE EXCEPTION 'غير مصرح باعتماد المسحوبات';
  END IF;

  SELECT * INTO v_w FROM public.owner_withdrawals WHERE id = _id AND deleted_at IS NULL FOR UPDATE;
  IF v_w.id IS NULL THEN RAISE EXCEPTION 'المسحوبة غير موجودة'; END IF;
  IF v_w.status <> 'draft' THEN RAISE EXCEPTION 'يمكن اعتماد المسوّدات فقط'; END IF;

  SELECT id INTO v_withdrawal_account FROM public.accounts WHERE code = '3100';
  IF v_withdrawal_account IS NULL THEN RAISE EXCEPTION 'حساب المسحوبات (3100) غير موجود'; END IF;

  -- Resolve credit (cash) account
  IF v_w.cash_account_id IS NOT NULL THEN
    SELECT account_id, name INTO v_cash_account, v_cash_name FROM public.cash_accounts WHERE id = v_w.cash_account_id;
  ELSIF v_w.funding_check_id IS NOT NULL THEN
    SELECT ca.account_id, ca.name INTO v_cash_account, v_cash_name
    FROM public.funding_checks fc JOIN public.cash_accounts ca ON ca.id = fc.cash_account_id
    WHERE fc.id = v_w.funding_check_id;
  ELSE
    -- Default to bank account for bank_transfer, else main cash
    IF v_w.payment_method = 'bank_transfer' THEN
      SELECT id INTO v_cash_account FROM public.accounts WHERE code = '1020';
      v_cash_name := 'البنك';
    ELSE
      SELECT id INTO v_cash_account FROM public.accounts WHERE code = '1011';
      v_cash_name := 'الصندوق الرئيسي';
    END IF;
  END IF;
  IF v_cash_account IS NULL THEN RAISE EXCEPTION 'حساب الدفع غير معرّف'; END IF;

  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (v_w.withdrawal_date,
          'مسحوبة ' || v_w.withdrawal_no || ' — ' || v_w.person_name,
          'withdrawal', v_w.id, v_user_id)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_entry_id, v_withdrawal_account, v_w.amount, 0, 'مسحوبة ' || v_w.person_name);

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_entry_id, v_cash_account, 0, v_w.amount, 'صرف من ' || COALESCE(v_cash_name, ''));

  UPDATE public.owner_withdrawals
  SET status = 'approved', approved_by = v_user_id, approved_at = now(),
      journal_entry_id = v_entry_id, updated_at = now()
  WHERE id = _id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'approve', 'withdrawal', _id, jsonb_build_object('amount', v_w.amount));

  RETURN v_entry_id;
END $$;

CREATE OR REPLACE FUNCTION public.cancel_withdrawal_atomic(_id UUID, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_w public.owner_withdrawals%ROWTYPE;
  v_reversal_id UUID;
  v_line RECORD;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT public.has_permission(v_user_id, 'withdrawals.cancel') THEN
    RAISE EXCEPTION 'غير مصرح بإلغاء المسحوبات';
  END IF;

  SELECT * INTO v_w FROM public.owner_withdrawals WHERE id = _id AND deleted_at IS NULL FOR UPDATE;
  IF v_w.id IS NULL THEN RAISE EXCEPTION 'المسحوبة غير موجودة'; END IF;
  IF v_w.status = 'cancelled' THEN RAISE EXCEPTION 'تم الإلغاء مسبقاً'; END IF;

  -- If approved, create reversal journal entry
  IF v_w.status = 'approved' AND v_w.journal_entry_id IS NOT NULL THEN
    INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
    VALUES (CURRENT_DATE,
            'عكس مسحوبة ' || v_w.withdrawal_no || COALESCE(' — ' || _reason, ''),
            'withdrawal_cancel', v_w.id, v_user_id)
    RETURNING id INTO v_reversal_id;

    FOR v_line IN
      SELECT account_id, debit, credit, description
      FROM public.journal_lines WHERE journal_entry_id = v_w.journal_entry_id
    LOOP
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES (v_reversal_id, v_line.account_id, v_line.credit, v_line.debit, 'عكس: ' || COALESCE(v_line.description,''));
    END LOOP;
  END IF;

  UPDATE public.owner_withdrawals
  SET status = 'cancelled', cancelled_by = v_user_id, cancelled_at = now(),
      cancel_reason = _reason, reversal_entry_id = v_reversal_id, updated_at = now()
  WHERE id = _id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'cancel', 'withdrawal', _id, jsonb_build_object('reason', _reason));
END $$;

-- ============================================================
-- 7) Extended expense create function (new signature with scope)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_expense_v2(
  _expense_scope TEXT,
  _project_id UUID,
  _asset_id UUID,
  _asset_expense_type TEXT,
  _asset_cost_treatment TEXT,
  _category_id UUID,
  _amount NUMERIC,
  _expense_date DATE,
  _description TEXT,
  _attachment_url TEXT,
  _allocations JSONB,
  _excel_attachment_url TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_expense_id UUID;
  v_entry_id UUID;
  v_debit_account UUID;
  v_alloc_total NUMERIC := 0;
  v_alloc JSONB;
  v_check_id UUID;
  v_amt NUMERIC;
  v_remaining NUMERIC;
  v_cash_row RECORD;
  v_is_capital BOOLEAN := false;
  v_debit_desc TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT public.has_permission(v_user_id, 'expenses.create') THEN
    RAISE EXCEPTION 'غير مصرح بتسجيل المصروفات';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;
  IF _expense_scope NOT IN ('project','asset','general') THEN
    RAISE EXCEPTION 'نطاق مصروف غير صالح';
  END IF;

  IF _expense_scope = 'project' AND _project_id IS NULL THEN
    RAISE EXCEPTION 'المشروع مطلوب لمصروف المشروع';
  END IF;
  IF _expense_scope = 'asset' THEN
    IF _asset_id IS NULL THEN RAISE EXCEPTION 'الأصل مطلوب لمصروف الأصل'; END IF;
    IF _asset_cost_treatment NOT IN ('operating_expense','capital_improvement') THEN
      RAISE EXCEPTION 'نوع المعالجة المحاسبية للأصل غير صالح';
    END IF;
    v_is_capital := (_asset_cost_treatment = 'capital_improvement');
  END IF;
  IF _expense_scope <> 'asset' THEN
    _asset_id := NULL; _asset_expense_type := NULL; _asset_cost_treatment := NULL;
  END IF;
  IF _expense_scope <> 'project' THEN
    _project_id := NULL;
  END IF;

  -- Validate allocations
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_alloc_total := v_alloc_total + (v_alloc->>'amount')::NUMERIC;
  END LOOP;
  IF ROUND(v_alloc_total,2) <> ROUND(_amount,2) THEN
    RAISE EXCEPTION 'مجموع التخصيصات (%) لا يساوي المبلغ (%)', v_alloc_total, _amount;
  END IF;

  -- Resolve debit account
  IF v_is_capital THEN
    SELECT id INTO v_debit_account FROM public.accounts WHERE code = '1500';
    IF v_debit_account IS NULL THEN RAISE EXCEPTION 'حساب الأصول الثابتة (1500) غير موجود'; END IF;
    v_debit_desc := 'تحسين رأسمالي للأصل';
  ELSE
    SELECT expense_account_id INTO v_debit_account FROM public.expense_categories WHERE id = _category_id;
    IF v_debit_account IS NULL THEN RAISE EXCEPTION 'فئة المصروف غير صالحة'; END IF;
    v_debit_desc := COALESCE(_description, 'مصروف');
  END IF;

  INSERT INTO public.expenses (
    project_id, category_id, amount, expense_date, description,
    attachment_url, excel_attachment_url, created_by,
    expense_scope, asset_id, asset_expense_type, asset_cost_treatment
  ) VALUES (
    _project_id, _category_id, _amount, _expense_date, _description,
    _attachment_url, _excel_attachment_url, v_user_id,
    _expense_scope, _asset_id, _asset_expense_type, _asset_cost_treatment
  ) RETURNING id INTO v_expense_id;

  -- Allocations + balance check
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_check_id := (v_alloc->>'funding_check_id')::UUID;
    v_amt := (v_alloc->>'amount')::NUMERIC;
    INSERT INTO public.expense_funding_allocations (expense_id, funding_check_id, amount)
    VALUES (v_expense_id, v_check_id, v_amt);
    v_remaining := public.check_remaining(v_check_id);
    IF v_remaining < 0 THEN RAISE EXCEPTION 'تم تجاوز رصيد الصك (المتبقي: %)', v_remaining; END IF;
  END LOOP;

  -- Journal entry
  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (_expense_date, COALESCE(_description, v_debit_desc),
          CASE WHEN v_is_capital THEN 'capital_improvement' ELSE 'expense' END,
          v_expense_id, v_user_id)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_entry_id, v_debit_account, _amount, 0, v_debit_desc);

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

  -- If capital improvement, increase asset current_value
  IF v_is_capital THEN
    UPDATE public.assets
    SET current_value = COALESCE(current_value, COALESCE(purchase_value, 0)) + _amount,
        updated_at = now()
    WHERE id = _asset_id;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'create', 'expense', v_expense_id,
          jsonb_build_object('amount', _amount, 'scope', _expense_scope,
                             'project_id', _project_id, 'asset_id', _asset_id,
                             'treatment', _asset_cost_treatment));

  RETURN v_expense_id;
END $$;

-- ============================================================
-- 8) updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS assets_set_updated_at ON public.assets;
CREATE TRIGGER assets_set_updated_at BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS withdrawals_set_updated_at ON public.owner_withdrawals;
CREATE TRIGGER withdrawals_set_updated_at BEFORE UPDATE ON public.owner_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
