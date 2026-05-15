
-- Revoke broad execute from PUBLIC on all SECURITY DEFINER functions, then grant narrowly.
REVOKE EXECUTE ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_permissions() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_remaining(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_expense_atomic(uuid, uuid, uuid, numeric, date, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reverse_expense_atomic(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_permissions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_remaining(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_expense_atomic(uuid, uuid, uuid, numeric, date, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_expense_atomic(uuid, text) TO authenticated;
