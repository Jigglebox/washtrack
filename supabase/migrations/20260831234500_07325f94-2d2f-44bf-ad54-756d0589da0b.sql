CREATE POLICY "Managers can upload ticket photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ticket-photos'
    AND public.has_role_or_higher(auth.uid(), 'manager'::app_role)
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "View own or all ticket photos for finance and above"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'ticket-photos'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role_or_higher(auth.uid(), 'finance'::app_role)
    )
  );