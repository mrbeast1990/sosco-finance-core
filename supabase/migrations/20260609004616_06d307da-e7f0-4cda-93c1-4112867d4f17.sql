
-- 1) Update expense atomically with before/after snapshot in audit log
CREATE OR REPLACE FUNCTION public.update_expense_atomic(
  _expense_id uuid,
  _expense_scope text,
  _project_id uuid,
  _asset_id uuid,
  _asset_expense_type text,
  _asset_cost_treatment text,
  _category_id uuid,
  _amount numeric,
  _expense_date date,
  _description text,
  _allocations jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_exp public.expenses%ROWTYPE;
  v_before JSONB;
  v_after JSONB;
  v_alloc JSONB;
  v_alloc_total NUMERIC := 0;
  v_check_id UUID;
  v_amt NUMERIC;
  v_remaining NUMERIC;
  v_cash_row RECORD;
  v_entry_id UUID;
  v_debit_account UUID;
  v_is_capital BOOLEAN := false;
  v_old_capital BOOLEAN := false;
  v_debit_desc TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT public.has_permission(v_user_id, 'expenses.edit') THEN
    RAISE EXCEPTION 'غير مصرح بتعديل المصروفات';
  END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر'; END IF;
  IF _expense_scope NOT IN ('project','asset','general') THEN
    RAISE EXCEPTION 'نطاق مصروف غير صالح';
  END IF;

  SELECT * INTO v_exp FROM public.expenses WHERE id = _expense_id AND deleted_at IS NULL FOR UPDATE;
  IF v_exp.id IS NULL THEN RAISE EXCEPTION 'المصروف غير موجود'; END IF;

  -- Build BEFORE snapshot (with joined names + allocations)
  SELECT jsonb_build_object(
    'expense_date', v_exp.expense_date,
    'amount', v_exp.amount,
    'description', v_exp.description,
    'expense_scope', v_exp.expense_scope,
    'project_id', v_exp.project_id,
    'project_name', (SELECT name FROM public.projects WHERE id = v_exp.project_id),
    'asset_id', v_exp.asset_id,
    'asset_name', (SELECT asset_name FROM public.assets WHERE id = v_exp.asset_id),
    'asset_expense_type', v_exp.asset_expense_type,
    'asset_cost_treatment', v_exp.asset_cost_treatment,
    'category_id', v_exp.category_id,
    'category_name', (SELECT name FROM public.expense_categories WHERE id = v_exp.category_id),
    'allocations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'funding_check_id', a.funding_check_id,
        'check_number', fc.check_number,
        'amount', a.amount
      ))
      FROM public.expense_funding_allocations a
      LEFT JOIN public.funding_checks fc ON fc.id = a.funding_check_id
      WHERE a.expense_id = v_exp.id
    ), '[]'::jsonb)
  ) INTO v_before;

  v_old_capital := (v_exp.asset_cost_treatment = 'capital_improvement' AND v_exp.asset_id IS NOT NULL);

  -- Normalize scope-specific
  IF _expense_scope = 'project' AND _project_id IS NULL THEN
    RAISE EXCEPTION 'المشروع مطلوب لمصروف المشروع';
  END IF;
  IF _expense_scope = 'asset' THEN
    IF _asset_id IS NULL THEN RAISE EXCEPTION 'الأصل مطلوب'; END IF;
    IF _asset_cost_treatment NOT IN ('operating_expense','capital_improvement') THEN
      RAISE EXCEPTION 'نوع المعالجة المحاسبية غير صالح';
    END IF;
    v_is_capital := (_asset_cost_treatment = 'capital_improvement');
  END IF;
  IF _expense_scope <> 'asset' THEN
    _asset_id := NULL; _asset_expense_type := NULL; _asset_cost_treatment := NULL;
  END IF;
  IF _expense_scope <> 'project' THEN
    _project_id := NULL;
  END IF;

  -- Validate allocations sum
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_alloc_total := v_alloc_total + (v_alloc->>'amount')::NUMERIC;
  END LOOP;
  IF ROUND(v_alloc_total,2) <> ROUND(_amount,2) THEN
    RAISE EXCEPTION 'مجموع التخصيصات (%) لا يساوي المبلغ (%)', v_alloc_total, _amount;
  END IF;

  -- Reverse capital improvement effect on asset (if any)
  IF v_old_capital THEN
    UPDATE public.assets
    SET current_value = COALESCE(current_value, 0) - v_exp.amount,
        updated_at = now()
    WHERE id = v_exp.asset_id;
  END IF;

  -- Resolve new debit account
  IF v_is_capital THEN
    SELECT id INTO v_debit_account FROM public.accounts WHERE code = '1500';
    IF v_debit_account IS NULL THEN RAISE EXCEPTION 'حساب الأصول الثابتة (1500) غير موجود'; END IF;
    v_debit_desc := 'تحسين رأسمالي للأصل';
  ELSE
    SELECT expense_account_id INTO v_debit_account FROM public.expense_categories WHERE id = _category_id;
    IF v_debit_account IS NULL THEN RAISE EXCEPTION 'فئة المصروف غير صالحة'; END IF;
    v_debit_desc := COALESCE(_description, 'مصروف');
  END IF;

  -- Replace allocations
  DELETE FROM public.expense_funding_allocations WHERE expense_id = _expense_id;
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
    v_check_id := (v_alloc->>'funding_check_id')::UUID;
    v_amt := (v_alloc->>'amount')::NUMERIC;
    INSERT INTO public.expense_funding_allocations (expense_id, funding_check_id, amount)
    VALUES (_expense_id, v_check_id, v_amt);
    v_remaining := public.check_remaining(v_check_id);
    IF v_remaining < 0 THEN RAISE EXCEPTION 'تم تجاوز رصيد الصك (المتبقي: %)', v_remaining; END IF;
  END LOOP;

  -- Update expense row
  UPDATE public.expenses SET
    project_id = _project_id,
    category_id = _category_id,
    amount = _amount,
    expense_date = _expense_date,
    description = _description,
    expense_scope = _expense_scope,
    asset_id = _asset_id,
    asset_expense_type = _asset_expense_type,
    asset_cost_treatment = _asset_cost_treatment,
    updated_at = now(),
    updated_by = v_user_id
  WHERE id = _expense_id;

  -- Replace journal entry: delete old lines and old entry, create new
  IF v_exp.journal_entry_id IS NOT NULL THEN
    DELETE FROM public.journal_lines WHERE journal_entry_id = v_exp.journal_entry_id;
    DELETE FROM public.journal_entries WHERE id = v_exp.journal_entry_id;
  END IF;

  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (_expense_date, COALESCE(_description, v_debit_desc),
          CASE WHEN v_is_capital THEN 'capital_improvement' ELSE 'expense' END,
          _expense_id, v_user_id)
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

  UPDATE public.expenses SET journal_entry_id = v_entry_id WHERE id = _expense_id;

  -- Apply new capital improvement if needed
  IF v_is_capital THEN
    UPDATE public.assets
    SET current_value = COALESCE(current_value, COALESCE(purchase_value, 0)) + _amount,
        updated_at = now()
    WHERE id = _asset_id;
  END IF;

  -- Build AFTER snapshot
  SELECT jsonb_build_object(
    'expense_date', _expense_date,
    'amount', _amount,
    'description', _description,
    'expense_scope', _expense_scope,
    'project_id', _project_id,
    'project_name', (SELECT name FROM public.projects WHERE id = _project_id),
    'asset_id', _asset_id,
    'asset_name', (SELECT asset_name FROM public.assets WHERE id = _asset_id),
    'asset_expense_type', _asset_expense_type,
    'asset_cost_treatment', _asset_cost_treatment,
    'category_id', _category_id,
    'category_name', (SELECT name FROM public.expense_categories WHERE id = _category_id),
    'allocations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'funding_check_id', a.funding_check_id,
        'check_number', fc.check_number,
        'amount', a.amount
      ))
      FROM public.expense_funding_allocations a
      LEFT JOIN public.funding_checks fc ON fc.id = a.funding_check_id
      WHERE a.expense_id = _expense_id
    ), '[]'::jsonb)
  ) INTO v_after;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'update', 'expense', _expense_id,
          jsonb_build_object('before', v_before, 'after', v_after));

  RETURN _expense_id;
END $$;

-- 2) Enhance reverse_expense_atomic to log full snapshot
CREATE OR REPLACE FUNCTION public.reverse_expense_atomic(_expense_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_exp public.expenses%ROWTYPE;
  v_entry_id UUID;
  v_expense_account UUID;
  v_cash_row RECORD;
  v_before JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT public.has_permission(v_user_id, 'expenses.delete') THEN
    RAISE EXCEPTION 'غير مصرح بعكس/حذف المصروفات';
  END IF;

  SELECT * INTO v_exp FROM public.expenses WHERE id = _expense_id AND deleted_at IS NULL;
  IF v_exp.id IS NULL THEN RAISE EXCEPTION 'المصروف غير موجود أو محذوف'; END IF;

  SELECT jsonb_build_object(
    'expense_date', v_exp.expense_date,
    'amount', v_exp.amount,
    'description', v_exp.description,
    'expense_scope', v_exp.expense_scope,
    'project_id', v_exp.project_id,
    'project_name', (SELECT name FROM public.projects WHERE id = v_exp.project_id),
    'asset_id', v_exp.asset_id,
    'asset_name', (SELECT asset_name FROM public.assets WHERE id = v_exp.asset_id),
    'asset_cost_treatment', v_exp.asset_cost_treatment,
    'category_id', v_exp.category_id,
    'category_name', (SELECT name FROM public.expense_categories WHERE id = v_exp.category_id),
    'allocations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'funding_check_id', a.funding_check_id,
        'check_number', fc.check_number,
        'amount', a.amount
      ))
      FROM public.expense_funding_allocations a
      LEFT JOIN public.funding_checks fc ON fc.id = a.funding_check_id
      WHERE a.expense_id = v_exp.id
    ), '[]'::jsonb)
  ) INTO v_before;

  SELECT expense_account_id INTO v_expense_account FROM public.expense_categories WHERE id = v_exp.category_id;

  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (CURRENT_DATE, 'عكس مصروف: ' || COALESCE(_reason,''), 'expense_reversal', _expense_id, v_user_id)
  RETURNING id INTO v_entry_id;

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

  IF v_expense_account IS NOT NULL THEN
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_expense_account, 0, v_exp.amount, 'عكس قيد المصروف');
  END IF;

  -- Reverse capital improvement on asset if applicable
  IF v_exp.asset_id IS NOT NULL AND v_exp.asset_cost_treatment = 'capital_improvement' THEN
    UPDATE public.assets
    SET current_value = COALESCE(current_value, 0) - v_exp.amount,
        updated_at = now()
    WHERE id = v_exp.asset_id;
  END IF;

  UPDATE public.expenses SET deleted_at = now(), updated_by = v_user_id, updated_at = now() WHERE id = _expense_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'delete', 'expense', _expense_id,
          jsonb_build_object('before', v_before, 'reason', _reason));
END $$;
