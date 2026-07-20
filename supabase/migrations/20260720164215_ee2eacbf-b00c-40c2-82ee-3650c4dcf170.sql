
CREATE POLICY "expense-attachments insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-attachments');

CREATE POLICY "expense-attachments update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'expense-attachments')
  WITH CHECK (bucket_id = 'expense-attachments');

CREATE POLICY "expense-attachments delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'expense-attachments');
