CREATE OR REPLACE FUNCTION public.update_withdrawal_atomic(
  _id UUID,
  _person_name TEXT,
  _person_role TEXT,
  _withdrawal_date DATE,
  _payment_method TEXT,
  _cash_account_id UUID,
  _project_id UUID,
  _funding_check_id UUID,
  _description TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_w public.owner_withdrawals%ROWTYPE;
  v_allocation public.withdrawal_funding_allocations%ROWTYPE;
  v_check_id UUID;
  v_available NUMERIC;
  v_before JSONB;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT public.has_permission(v_user_id, 'withdrawals.update') THEN
    RAISE EXCEPTION 'غير مصرح بتعديل المسحوبات';
  END IF;
  IF NULLIF(TRIM(_person_name), '') IS NULL THEN RAISE EXCEPTION 'اسم الشخص مطلوب'; END IF;
  IF _person_role NOT IN ('owner','partner','manager','other') THEN RAISE EXCEPTION 'الصفة غير صالحة'; END IF;
  IF _payment_method NOT IN ('cash','bank_transfer','check','other') THEN RAISE EXCEPTION 'طريقة الدفع غير صالحة'; END IF;

  SELECT * INTO v_w FROM public.owner_withdrawals
  WHERE id = _id AND deleted_at IS NULL FOR UPDATE;
  IF v_w.id IS NULL THEN RAISE EXCEPTION 'المسحوبة غير موجودة'; END IF;
  IF v_w.status = 'cancelled' THEN RAISE EXCEPTION 'لا يمكن تعديل مسحوبة ملغية'; END IF;

  v_before := to_jsonb(v_w);
  SELECT * INTO v_allocation FROM public.withdrawal_funding_allocations
  WHERE withdrawal_id = _id FOR UPDATE;

  IF _funding_check_id IS NOT NULL THEN
    SELECT id INTO v_check_id FROM public.funding_checks
    WHERE id = _funding_check_id AND deleted_at IS NULL FOR UPDATE;
    IF v_check_id IS NULL THEN RAISE EXCEPTION 'صك التمويل غير موجود'; END IF;
    v_available := public.check_remaining(_funding_check_id);
    IF v_allocation.id IS NOT NULL AND v_allocation.funding_check_id = _funding_check_id THEN
      v_available := v_available + v_allocation.amount;
    END IF;
    IF v_available < v_w.amount THEN RAISE EXCEPTION 'رصيد الصك غير كافٍ'; END IF;
  END IF;

  UPDATE public.owner_withdrawals SET
    person_name = TRIM(_person_name),
    person_role = _person_role,
    withdrawal_date = _withdrawal_date,
    payment_method = _payment_method,
    cash_account_id = _cash_account_id,
    project_id = _project_id,
    funding_check_id = _funding_check_id,
    description = NULLIF(TRIM(_description), ''),
    updated_at = now()
  WHERE id = _id;

  IF v_w.status = 'approved' AND _funding_check_id IS NOT NULL THEN
    INSERT INTO public.withdrawal_funding_allocations (withdrawal_id, funding_check_id, amount, created_by)
    VALUES (_id, _funding_check_id, v_w.amount, v_user_id)
    ON CONFLICT (withdrawal_id) DO UPDATE SET
      funding_check_id = EXCLUDED.funding_check_id,
      amount = EXCLUDED.amount;
  ELSE
    DELETE FROM public.withdrawal_funding_allocations WHERE withdrawal_id = _id;
  END IF;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'update', 'withdrawal', _id,
    jsonb_build_object('before', v_before, 'after', (
      SELECT to_jsonb(ow) FROM public.owner_withdrawals ow WHERE ow.id = _id
    )));
  RETURN _id;
END $$;

REVOKE EXECUTE ON FUNCTION public.update_withdrawal_atomic(UUID,TEXT,TEXT,DATE,TEXT,UUID,UUID,UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_withdrawal_atomic(UUID,TEXT,TEXT,DATE,TEXT,UUID,UUID,UUID,TEXT) TO authenticated;
