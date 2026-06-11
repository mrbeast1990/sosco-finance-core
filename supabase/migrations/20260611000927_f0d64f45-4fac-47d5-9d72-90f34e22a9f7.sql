
CREATE OR REPLACE FUNCTION public.update_expense_atomic(_expense_id uuid, _expense_scope text, _project_id uuid, _asset_id uuid, _asset_expense_type text, _asset_cost_treatment text, _category_id uuid, _amount numeric, _expense_date date, _description text, _allocations jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_old_entry_id UUID;
  v_entry_id UUID;
  v_debit_account UUID;
  v_is_capital BOOLEAN := false;
  v_old_capital BOOLEAN := false;
  v_debit_desc TEXT;
  v_payment_count INT;
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

  -- Block editing of payable expenses that already have payments
  IF v_exp.payment_status = 'payable' THEN
    SELECT COUNT(*) INTO v_payment_count
    FROM public.payable_payments pp
    JOIN public.payables p ON p.id = pp.payable_id
    WHERE p.expense_id = _expense_id;
    IF v_payment_count > 0 THEN
      RAISE EXCEPTION 'لا يمكن تعديل مصروف آجل تم تسديد جزء أو كامل قيمته. قم بعكس التسديدات أولاً.';
    END IF;
    -- Also do not allow editing payable expenses through this RPC (use payable-specific flow if needed)
    RAISE EXCEPTION 'تعديل المصاريف الآجلة غير مدعوم من هذه الواجهة. الرجاء حذف المصروف وإعادة إنشائه.';
  END IF;

  v_old_entry_id := v_exp.journal_entry_id;

  -- Build BEFORE snapshot
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

  -- Create NEW journal entry FIRST
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

  -- Update expense row (point to new entry FIRST so we can safely delete old)
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
    journal_entry_id = v_entry_id,
    updated_at = now(),
    updated_by = v_user_id
  WHERE id = _expense_id;

  -- Now safely delete old entry (FK no longer references it)
  IF v_old_entry_id IS NOT NULL THEN
    DELETE FROM public.journal_lines WHERE journal_entry_id = v_old_entry_id;
    DELETE FROM public.journal_entries WHERE id = v_old_entry_id;
  END IF;

  -- Apply new capital improvement if needed
  IF v_is_capital THEN
    UPDATE public.assets
    SET current_value = COALESCE(current_value, COALESCE(purchase_value, 0)) + _amount,
        updated_at = now()
    WHERE id = _asset_id;
  END IF;

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
          jsonb_build_object('before', v_before, 'after', v_after, 'old_journal_entry_id', v_old_entry_id, 'new_journal_entry_id', v_entry_id));

  RETURN _expense_id;
END $function$;
