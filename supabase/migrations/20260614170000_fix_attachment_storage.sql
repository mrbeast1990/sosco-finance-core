INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-attachments',
  'expense-attachments',
  false,
  10485760,
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel', 'text/csv', 'application/csv'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'check-attachments',
  'check-attachments',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'attachments_select') THEN
    CREATE POLICY "attachments_select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'expense-attachments');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'attachments_insert') THEN
    CREATE POLICY "attachments_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'expense-attachments' AND public.can_write());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'check-attachments read') THEN
    CREATE POLICY "check-attachments read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'check-attachments');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'check-attachments insert') THEN
    CREATE POLICY "check-attachments insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'check-attachments');
  END IF;
END $$;
