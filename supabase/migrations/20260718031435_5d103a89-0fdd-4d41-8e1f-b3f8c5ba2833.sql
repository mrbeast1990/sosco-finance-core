
-- Phase 2: Multi-check withdrawal allocations
-- Add uniqueness (allow multiple checks per withdrawal, one row per check)
ALTER TABLE public.withdrawal_funding_allocations
  ADD CONSTRAINT withdrawal_funding_allocations_unique_check
  UNIQUE (withdrawal_id, funding_check_id);

-- Update create_withdrawal_atomic in place: add optional _allocations jsonb param
DROP FUNCTION IF EXISTS public.create_withdrawal_atomic(date, text, text, numeric, text, uuid, uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.create_withdrawal_atomic(
  _withdrawal_date date,
  _person_name text,
  _person_role text,
  _amount numeric,
  _payment_method text,
  _cash_account_id uuid,
  _funding_check_id uuid,
  _project_id uuid,
  _description text,
  _attachment_url text,
  _allocations jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_id UUID;
  v_alloc JSONB;
  v_alloc_total NUMERIC := 0;
  v_multi BOOLEAN := (_allocations IS NOT NULL AND jsonb_typeof(_allocations) = 'array' AND jsonb_array_length(_allocations) > 0);
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

  IF v_multi THEN
    IF _funding_check_id IS NOT NULL THEN
      RAISE EXCEPTION 'لا يمكن تمرير صك واحد مع تخصيصات متعددة';
    END IF;
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
      IF (v_alloc->>'funding_check_id') IS NULL OR (v_alloc->>'amount') IS NULL THEN
        RAISE EXCEPTION 'تخصيص غير صالح';
      END IF;
      IF (v_alloc->>'amount')::NUMERIC <= 0 THEN
        RAISE EXCEPTION 'مبلغ التخصيص يجب أن يكون أكبر من صفر';
      END IF;
      v_alloc_total := v_alloc_total + (v_alloc->>'amount')::NUMERIC;
    END LOOP;
    IF ROUND(v_alloc_total, 2) <> ROUND(_amount, 2) THEN
      RAISE EXCEPTION 'مجموع التخصيصات (%) لا يساوي مبلغ المسحوبة (%)', v_alloc_total, _amount;
    END IF;
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

  IF v_multi THEN
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(_allocations) LOOP
      INSERT INTO public.withdrawal_funding_allocations (withdrawal_id, funding_check_id, amount, created_by)
      VALUES (v_id, (v_alloc->>'funding_check_id')::UUID, (v_alloc->>'amount')::NUMERIC, v_user_id);
    END LOOP;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'create', 'withdrawal', v_id,
          jsonb_build_object('amount', _amount, 'person', _person_name, 'role', _person_role,
                             'multi_check', v_multi, 'allocations', COALESCE(_allocations, '[]'::jsonb)));

  RETURN v_id;
END $function$;

-- Update approve_withdrawal_atomic to support multi-check when allocations already exist
CREATE OR REPLACE FUNCTION public.approve_withdrawal_atomic(_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_w public.owner_withdrawals%ROWTYPE;
  v_entry_id UUID;
  v_withdrawal_account UUID;
  v_alloc_count INT;
  v_cash_row RECORD;
  v_check_row RECORD;
  v_remaining NUMERIC;
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

  SELECT COUNT(*) INTO v_alloc_count
  FROM public.withdrawal_funding_allocations WHERE withdrawal_id = _id;

  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (v_w.withdrawal_date,
          'مسحوبة ' || v_w.withdrawal_no || ' — ' || v_w.person_name,
          'withdrawal', v_w.id, v_user_id)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_entry_id, v_withdrawal_account, v_w.amount, 0, 'مسحوبة ' || v_w.person_name);

  IF v_alloc_count > 0 THEN
    -- Multi-check path: validate each check
    FOR v_check_row IN
      SELECT wfa.funding_check_id, wfa.amount, fc.deleted_at
      FROM public.withdrawal_funding_allocations wfa
      JOIN public.funding_checks fc ON fc.id = wfa.funding_check_id
      WHERE wfa.withdrawal_id = _id
    LOOP
      IF v_check_row.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'أحد الصكوك محذوف أو غير متاح';
      END IF;
      v_remaining := public.check_remaining(v_check_row.funding_check_id);
      IF v_remaining < v_check_row.amount THEN
        RAISE EXCEPTION 'رصيد الصك غير كافٍ (المتبقي: %, المطلوب: %)', v_remaining, v_check_row.amount;
      END IF;
    END LOOP;

    FOR v_cash_row IN
      SELECT ca.account_id AS ledger_account, ca.name AS cash_name, SUM(wfa.amount) AS total
      FROM public.withdrawal_funding_allocations wfa
      JOIN public.funding_checks fc ON fc.id = wfa.funding_check_id
      JOIN public.cash_accounts ca ON ca.id = fc.cash_account_id
      WHERE wfa.withdrawal_id = _id
      GROUP BY ca.account_id, ca.name
    LOOP
      INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES (v_entry_id, v_cash_row.ledger_account, 0, v_cash_row.total, 'صرف من ' || v_cash_row.cash_name);
    END LOOP;
  ELSE
    -- Legacy single-check / cash path (unchanged behavior)
    IF v_w.funding_check_id IS NOT NULL THEN
      v_remaining := public.check_remaining(v_w.funding_check_id);
      IF v_remaining < v_w.amount THEN
        RAISE EXCEPTION 'المبلغ يتجاوز رصيد الصك المتاح (%). الرصيد المتبقي: %', v_w.amount, v_remaining;
      END IF;
      SELECT ca.account_id, ca.name INTO v_cash_account, v_cash_name
      FROM public.funding_checks fc JOIN public.cash_accounts ca ON ca.id = fc.cash_account_id
      WHERE fc.id = v_w.funding_check_id;
      INSERT INTO public.withdrawal_funding_allocations (withdrawal_id, funding_check_id, amount, created_by)
      VALUES (v_w.id, v_w.funding_check_id, v_w.amount, v_user_id);
    ELSIF v_w.cash_account_id IS NOT NULL THEN
      SELECT account_id, name INTO v_cash_account, v_cash_name FROM public.cash_accounts WHERE id = v_w.cash_account_id;
    ELSE
      IF v_w.payment_method = 'bank_transfer' THEN
        SELECT id INTO v_cash_account FROM public.accounts WHERE code = '1020';
        v_cash_name := 'البنك';
      ELSE
        SELECT id INTO v_cash_account FROM public.accounts WHERE code = '1011';
        v_cash_name := 'الصندوق الرئيسي';
      END IF;
    END IF;
    IF v_cash_account IS NULL THEN RAISE EXCEPTION 'حساب الدفع غير معرّف'; END IF;
    INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_entry_id, v_cash_account, 0, v_w.amount, 'صرف من ' || COALESCE(v_cash_name, ''));
  END IF;

  UPDATE public.owner_withdrawals
  SET status = 'approved', approved_by = v_user_id, approved_at = now(),
      journal_entry_id = v_entry_id, updated_at = now()
  WHERE id = _id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'approve', 'withdrawal', _id,
          jsonb_build_object('amount', v_w.amount, 'multi_check', v_alloc_count > 0));

  RETURN v_entry_id;
END $function$;
