INSERT INTO public.permissions (code, name, module)
VALUES
  ('dashboard.view', 'عرض لوحة التحكم', 'dashboard'),
  ('attachments.upload', 'رفع المرفقات', 'attachments')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code = 'admin' AND p.code IN ('dashboard.view','attachments.upload')
ON CONFLICT DO NOTHING;