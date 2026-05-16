-- 1) Add audit.view permission (idempotent)
INSERT INTO public.permissions (code, name, module)
VALUES ('audit.view', 'عرض مركز التدقيق', 'audit')
ON CONFLICT (code) DO NOTHING;

-- 2) Grant to admin + finance_manager
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE p.code = 'audit.view' AND r.code IN ('admin','finance_manager')
ON CONFLICT DO NOTHING;

-- 3) Extend audit_log SELECT policy: keep existing admin policy, add a permission-based one
DROP POLICY IF EXISTS audit_select_perm ON public.audit_log;
CREATE POLICY audit_select_perm
ON public.audit_log
FOR SELECT
TO authenticated
USING (public.has_permission(auth.uid(), 'audit.view'));