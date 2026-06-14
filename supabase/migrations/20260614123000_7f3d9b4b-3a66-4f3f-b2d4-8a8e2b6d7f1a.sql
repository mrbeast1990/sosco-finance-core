-- Create withdrawal funding allocation table and integrate owner withdrawals into funding check consumption
BEGIN;

CREATE TABLE IF NOT EXISTS public.withdrawal_funding_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id UUID NOT NULL REFERENCES public.owner_withdrawals(id),
  funding_check_id UUID NOT NULL REFERENCES public.funding_checks(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wfa_withdrawal_id
  ON public.withdrawal_funding_allocations(withdrawal_id);
CREATE INDEX IF NOT EXISTS idx_wfa_funding_check_id
  ON public.withdrawal_funding_allocations(funding_check_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.withdrawal_funding_allocations TO authenticated;
GRANT ALL ON public.withdrawal_funding_allocations TO service_role;
ALTER TABLE public.withdrawal_funding_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wfa_select ON public.withdrawal_funding_allocations;
DROP POLICY IF EXISTS wfa_insert ON public.withdrawal_funding_allocations;
DROP POLICY IF EXISTS wfa_update ON public.withdrawal_funding_allocations;
DROP POLICY IF EXISTS wfa_delete ON public.withdrawal_funding_allocations;

CREATE POLICY wfa_select ON public.withdrawal_funding_allocations FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), 'withdrawals.view'));
CREATE POLICY wfa_insert ON public.withdrawal_funding_allocations FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), 'withdrawals.create'));
CREATE POLICY wfa_update ON public.withdrawal_funding_allocations FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), 'withdrawals.update'));
CREATE POLICY wfa_delete ON public.withdrawal_funding_allocations FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), 'withdrawals.delete'));

-- Update funding check remaining balance to include approved withdrawal allocations
CREATE OR REPLACE FUNCTION public.check_remaining(_check_id UUID)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT fc.amount
  - COALESCE((
      SELECT SUM(a.amount)
      FROM public.expense_funding_allocations a
      JOIN public.expenses e ON e.id = a.expense_id AND e.deleted_at IS NULL
      WHERE a.funding_check_id = _check_id
    ), 0)
  - COALESCE((
      SELECT SUM(wfa.amount)
      FROM public.withdrawal_funding_allocations wfa
      JOIN public.owner_withdrawals w ON w.id = wfa.withdrawal_id
        AND w.status = 'approved'
        AND w.deleted_at IS NULL
      WHERE wfa.funding_check_id = _check_id
    ), 0)
  - COALESCE((
      SELECT SUM(pp.amount)
      FROM public.payable_payments pp
      WHERE pp.funding_check_id = _check_id
    ), 0)
FROM public.funding_checks fc WHERE fc.id = _check_id;
$$;

-- Update withdrawal approval flow to create funding allocations and enforce remaining balance validation
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
  v_check_exists UUID;
  v_remaining NUMERIC;
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

  IF v_w.funding_check_id IS NOT NULL THEN
    SELECT id INTO v_check_exists FROM public.funding_checks
      WHERE id = v_w.funding_check_id AND deleted_at IS NULL;
    IF v_check_exists IS NULL THEN RAISE EXCEPTION 'صك التمويل غير موجود أو تم حذفه'; END IF;

    v_remaining := public.check_remaining(v_w.funding_check_id);
    IF v_remaining < v_w.amount THEN
      RAISE EXCEPTION 'المبلغ يتجاوز رصيد الصك المتاح (%). الرصيد المتبقي: %', v_w.amount, v_remaining;
    END IF;
  END IF;

  IF v_w.cash_account_id IS NOT NULL THEN
    SELECT account_id, name INTO v_cash_account, v_cash_name FROM public.cash_accounts WHERE id = v_w.cash_account_id;
  ELSIF v_w.funding_check_id IS NOT NULL THEN
    SELECT ca.account_id, ca.name INTO v_cash_account, v_cash_name
    FROM public.funding_checks fc JOIN public.cash_accounts ca ON ca.id = fc.cash_account_id
    WHERE fc.id = v_w.funding_check_id;
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

  INSERT INTO public.journal_entries (entry_date, description, source_type, source_id, created_by)
  VALUES (v_w.withdrawal_date,
          'مسحوبة ' || v_w.withdrawal_no || ' — ' || v_w.person_name,
          'withdrawal', v_w.id, v_user_id)
  RETURNING id INTO v_entry_id;

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_entry_id, v_withdrawal_account, v_w.amount, 0, 'مسحوبة ' || v_w.person_name);

  INSERT INTO public.journal_lines (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_entry_id, v_cash_account, 0, v_w.amount, 'صرف من ' || COALESCE(v_cash_name, ''));

  IF v_w.funding_check_id IS NOT NULL THEN
    INSERT INTO public.withdrawal_funding_allocations (withdrawal_id, funding_check_id, amount, created_by)
    VALUES (v_w.id, v_w.funding_check_id, v_w.amount, v_user_id);
  END IF;

  UPDATE public.owner_withdrawals
  SET status = 'approved', approved_by = v_user_id, approved_at = now(),
      journal_entry_id = v_entry_id, updated_at = now()
  WHERE id = _id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'approve', 'withdrawal', _id, jsonb_build_object('amount', v_w.amount));

  RETURN v_entry_id;
END $$;

-- Backfill existing approved withdrawals into withdrawal_funding_allocations
INSERT INTO public.withdrawal_funding_allocations (withdrawal_id, funding_check_id, amount, created_by)
SELECT ow.id, ow.funding_check_id, ow.amount, ow.approved_by
FROM public.owner_withdrawals ow
WHERE ow.status = 'approved'
  AND ow.deleted_at IS NULL
  AND ow.funding_check_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.withdrawal_funding_allocations wfa WHERE wfa.withdrawal_id = ow.id
  )
ON CONFLICT (withdrawal_id) DO NOTHING;

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

    DELETE FROM public.withdrawal_funding_allocations WHERE withdrawal_id = _id;
  END IF;

  UPDATE public.owner_withdrawals
  SET status = 'cancelled', cancelled_by = v_user_id, cancelled_at = now(),
      cancel_reason = _reason, reversal_entry_id = v_reversal_id, updated_at = now()
  WHERE id = _id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_user_id, 'cancel', 'withdrawal', _id, jsonb_build_object('reason', _reason));
END $$;

COMMIT;

-- Verification results returned by Lovable Database SQL editor
SELECT COUNT(*) AS withdrawal_funding_allocations_count
FROM public.withdrawal_funding_allocations;

SELECT
  COUNT(*) FILTER (WHERE status = 'approved') AS approved_withdrawals,
  COUNT(*) FILTER (WHERE status = 'approved' AND funding_check_id IS NOT NULL) AS linked_approved_withdrawals,
  COUNT(*) FILTER (
    WHERE status = 'approved'
      AND funding_check_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.withdrawal_funding_allocations wfa
        WHERE wfa.withdrawal_id = owner_withdrawals.id
      )
  ) AS linked_approved_missing_allocations
FROM public.owner_withdrawals
WHERE deleted_at IS NULL;
