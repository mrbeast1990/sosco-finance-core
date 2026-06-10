
INSERT INTO public.accounts (code, name, type)
SELECT '2100', 'حسابات دائنة (موردون)', 'liability'
WHERE NOT EXISTS (SELECT 1 FROM public.accounts WHERE code = '2100');

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'paid',
  ADD COLUMN IF NOT EXISTS creditor_name TEXT,
  ADD COLUMN IF NOT EXISTS due_date DATE;

CREATE OR REPLACE FUNCTION public.expenses_payment_status_check()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.payment_status NOT IN ('paid','payable') THEN
    RAISE EXCEPTION 'payment_status غير صالح';
  END IF;
  IF NEW.payment_status = 'payable' AND (NEW.creditor_name IS NULL OR length(trim(NEW.creditor_name)) = 0) THEN
    RAISE EXCEPTION 'اسم الدائن مطلوب للمصروف الآجل';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_expenses_payment_status ON public.expenses;
CREATE TRIGGER trg_expenses_payment_status
  BEFORE INSERT OR UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.expenses_payment_status_check();

CREATE TABLE IF NOT EXISTS public.payables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id UUID NOT NULL UNIQUE REFERENCES public.expenses(id) ON DELETE CASCADE,
  creditor_name TEXT NOT NULL,
  original_amount NUMERIC NOT NULL CHECK (original_amount > 0),
  paid_amount NUMERIC NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);
CREATE INDEX IF NOT EXISTS idx_payables_status ON public.payables(status);
CREATE INDEX IF NOT EXISTS idx_payables_due_date ON public.payables(due_date);
CREATE INDEX IF NOT EXISTS idx_payables_creditor ON public.payables(creditor_name);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payables TO authenticated;
GRANT ALL ON public.payables TO service_role;
ALTER TABLE public.payables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payables_select" ON public.payables FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'expenses.view') OR public.has_permission(auth.uid(), 'payables.view'));
CREATE POLICY "payables_modify" ON public.payables FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP TRIGGER IF EXISTS trg_payables_updated_at ON public.payables;
CREATE TRIGGER trg_payables_updated_at BEFORE UPDATE ON public.payables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.payable_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payable_id UUID NOT NULL REFERENCES public.payables(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL,
  cash_account_id UUID REFERENCES public.cash_accounts(id),
  funding_check_id UUID REFERENCES public.funding_checks(id),
  journal_entry_id UUID REFERENCES public.journal_entries(id),
  attachment_url TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payable_payments_payable ON public.payable_payments(payable_id);
CREATE INDEX IF NOT EXISTS idx_payable_payments_date ON public.payable_payments(payment_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payable_payments TO authenticated;
GRANT ALL ON public.payable_payments TO service_role;
ALTER TABLE public.payable_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payable_payments_select" ON public.payable_payments FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'expenses.view') OR public.has_permission(auth.uid(), 'payables.view'));
CREATE POLICY "payable_payments_modify" ON public.payable_payments FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO public.permissions (code, name, module)
SELECT * FROM (VALUES
  ('payables.view', 'عرض الذمم الدائنة', 'payables'),
  ('payables.pay',  'تسديد الذمم الدائنة', 'payables'),
  ('payables.delete','حذف الذمم الدائنة', 'payables')
) AS v(code, name, module)
WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.code = v.code);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.code = 'admin' AND p.code IN ('payables.view','payables.pay','payables.delete')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_expense_v3(
  _payment_status TEXT,
  _creditor_name TEXT,
  _due_date DATE,
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_expense_id UUID;
  v_entry_id UUID;
  v_debit_account UUID;
  v_ap_account UUID;
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
  IF _payment_status NOT IN ('paid','payable') THEN RAISE EXCEPTION 'حالة الدفع غير صالحة'; END IF;
  IF _expense_scope NOT IN ('project','asset','general') THEN RAISE EXCEPTION 'نطاق مصروف غير صالح'; END IF;

  IF _expense_scope = 'project' AND _project_id IS NULL THEN
    RAISE EXCEPTION 'المشروع مطلوب لمصروف المشروع';
  END IF;
  IF _expense_scope = 'asset' THEN
    IF _asset_id IS NULL THEN RAISE EXCEPTION 'الأصل مطلوب'; END IF;
    IF _asset_cost_treatment NOT IN ('operating_expense','capital_improvement') THEN
      RAISE EXCEPTION 'نوع المعالجة غير صالح';
    END IF;
    v_is_capital := (_asset_cost_treatment = 'capital_improvement');
  END IF;
  IF _expense_scope <> 'asset' THEN
    _asset_id := NULL; _asset_expense_type := NULL; _asset_cost_treatment := NULL;
  END IF;
  IF _expense_scope <> 'project' THEN
    _project_id := NULL;
  END IF;

  IF _payment_status = 'payable' THEN
    IF _creditor_name IS NULL OR length(trim(_creditor_name)) = 0 THEN
      RAISE EXCEPTION 'اسم الدائن مطلوب للمصروف الآجل';
    END IF;
  ELSE
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
      v_alloc_total := v_alloc_total + (v_alloc->>'amount')::NUMERIC;
    END LOOP;
    IF ROUND(v_alloc_total,2) <> ROUND(_amount,2) THEN
      RAISE EXCEPTION 'مجموع التخصيصات (%) لا يساوي المبلغ (%)', v_alloc_total, _amount;
    END IF;
  END IF;

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
    expense_scope, asset_id, asset_expense_type, asset_cost_treatment,
    payment_status, creditor_name, due_date
  ) VALUES (
    _project_id, _category_id, _amount, _expense_date, _description,
    _attachment_url, _excel_attachment_url, v_user_id,
    _expense_scope, _asset_id, _asset_expense_type, _asset_cost_treatment,
    _payment_status, _creditor_name, _due_date
  ) RETURNING id INTO v_expense_id;

  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (_expense_date, COALESCE(_description, v_debit_desc),
          CASE WHEN v_is_capital THEN 'capital_improvement' ELSE 'expense' END,
          v_expense_id, v_user_id)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_entry_id, v_debit_account, _amount, 0, v_debit_desc);

  IF _payment_status = 'paid' THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
      v_check_id := (v_alloc->>'funding_check_id')::UUID;
      v_amt := (v_alloc->>'amount')::NUMERIC;
      INSERT INTO public.expense_funding_allocations (expense_id, funding_check_id, amount)
      VALUES (v_expense_id, v_check_id, v_amt);
      v_remaining := public.check_remaining(v_check_id);
      IF v_remaining < 0 THEN RAISE EXCEPTION 'تم تجاوز رصيد الصك (المتبقي: %)', v_remaining; END IF;
    END LOOP;

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
  ELSE
    SELECT id INTO v_ap_account FROM public.accounts WHERE code = '2100';
    IF v_ap_account IS NULL THEN RAISE EXCEPTION 'حساب الدائنين (2100) غير موجود'; END IF;
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_ap_account, 0, _amount, 'مستحق للدائن: ' || _creditor_name);

    INSERT INTO public.payables (expense_id, creditor_name, original_amount, due_date, status, created_by)
    VALUES (v_expense_id, _creditor_name, _amount, _due_date, 'open', v_user_id);
  END IF;

  UPDATE public.expenses SET journal_entry_id = v_entry_id WHERE id = v_expense_id;

  IF v_is_capital THEN
    UPDATE public.assets
    SET current_value = COALESCE(current_value, COALESCE(purchase_value, 0)) + _amount,
        updated_at = now()
    WHERE id = _asset_id;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'create', 'expense', v_expense_id,
          jsonb_build_object('amount', _amount, 'scope', _expense_scope,
                             'payment_status', _payment_status,
                             'creditor', _creditor_name,
                             'project_id', _project_id, 'asset_id', _asset_id));
  RETURN v_expense_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.create_expense_v3(TEXT,TEXT,DATE,TEXT,UUID,UUID,TEXT,TEXT,UUID,NUMERIC,DATE,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_expense_v3(TEXT,TEXT,DATE,TEXT,UUID,UUID,TEXT,TEXT,UUID,NUMERIC,DATE,TEXT,TEXT,JSONB,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.pay_payable_atomic(
  _payable_id UUID,
  _payment_date DATE,
  _amount NUMERIC,
  _payment_method TEXT,
  _cash_account_id UUID,
  _funding_check_id UUID,
  _attachment_url TEXT,
  _notes TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_p public.payables%ROWTYPE;
  v_ap_account UUID;
  v_cash_account UUID;
  v_cash_name TEXT;
  v_entry_id UUID;
  v_new_paid NUMERIC;
  v_new_status TEXT;
  v_remaining_check NUMERIC;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT public.has_permission(v_user_id, 'payables.pay') THEN
    RAISE EXCEPTION 'غير مصرح بتسديد الذمم';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;

  SELECT * INTO v_p FROM public.payables WHERE id = _payable_id FOR UPDATE;
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'الذمة غير موجودة'; END IF;
  IF v_p.status = 'paid' THEN RAISE EXCEPTION 'تم تسديد هذه الذمة بالكامل'; END IF;
  IF _amount > (v_p.original_amount - v_p.paid_amount) THEN
    RAISE EXCEPTION 'المبلغ يتجاوز المتبقي (%)', (v_p.original_amount - v_p.paid_amount);
  END IF;

  SELECT id INTO v_ap_account FROM public.accounts WHERE code = '2100';
  IF v_ap_account IS NULL THEN RAISE EXCEPTION 'حساب الدائنين (2100) غير موجود'; END IF;

  IF _funding_check_id IS NOT NULL THEN
    SELECT ca.account_id, ca.name INTO v_cash_account, v_cash_name
    FROM public.funding_checks fc JOIN public.cash_accounts ca ON ca.id = fc.cash_account_id
    WHERE fc.id = _funding_check_id;
    INSERT INTO public.expense_funding_allocations (expense_id, funding_check_id, amount)
    VALUES (v_p.expense_id, _funding_check_id, _amount);
    v_remaining_check := public.check_remaining(_funding_check_id);
    IF v_remaining_check < 0 THEN RAISE EXCEPTION 'تم تجاوز رصيد الصك (المتبقي: %)', v_remaining_check; END IF;
  ELSIF _cash_account_id IS NOT NULL THEN
    SELECT account_id, name INTO v_cash_account, v_cash_name FROM public.cash_accounts WHERE id = _cash_account_id;
  ELSE
    RAISE EXCEPTION 'يجب تحديد حساب الدفع أو الصك';
  END IF;
  IF v_cash_account IS NULL THEN RAISE EXCEPTION 'حساب الدفع غير معرّف'; END IF;

  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (_payment_date, 'تسديد ذمة للدائن: ' || v_p.creditor_name, 'payable_payment', _payable_id, v_user_id)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_entry_id, v_ap_account, _amount, 0, 'تسديد ذمة: ' || v_p.creditor_name);
  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_entry_id, v_cash_account, 0, _amount, 'صرف من ' || COALESCE(v_cash_name,''));

  INSERT INTO public.payable_payments (
    payable_id, payment_date, amount, payment_method,
    cash_account_id, funding_check_id, journal_entry_id, attachment_url, notes, created_by
  ) VALUES (
    _payable_id, _payment_date, _amount, _payment_method,
    _cash_account_id, _funding_check_id, v_entry_id, _attachment_url, _notes, v_user_id
  );

  v_new_paid := v_p.paid_amount + _amount;
  IF v_new_paid >= v_p.original_amount THEN v_new_status := 'paid';
  ELSE v_new_status := 'partially_paid';
  END IF;

  UPDATE public.payables
  SET paid_amount = v_new_paid, status = v_new_status, updated_at = now()
  WHERE id = _payable_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'pay', 'payable', _payable_id,
          jsonb_build_object('amount', _amount, 'date', _payment_date, 'method', _payment_method));

  RETURN v_entry_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.pay_payable_atomic(UUID,DATE,NUMERIC,TEXT,UUID,UUID,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_payable_atomic(UUID,DATE,NUMERIC,TEXT,UUID,UUID,TEXT,TEXT) TO authenticated;
