
ALTER TABLE public.funding_checks
  ADD COLUMN IF NOT EXISTS amount_usd numeric,
  ADD COLUMN IF NOT EXISTS attachment_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('check-attachments', 'check-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "check-attachments read"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'check-attachments');

CREATE POLICY "check-attachments insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'check-attachments');

CREATE POLICY "check-attachments delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'check-attachments');
