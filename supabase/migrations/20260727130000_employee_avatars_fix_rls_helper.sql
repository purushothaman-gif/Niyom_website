/*
  # Fix employee-avatars write RLS

  The original policies (20260727120000) used an inline
  `EXISTS (SELECT 1 FROM nw_employees WHERE auth_user_id = auth.uid() AND role IN (...))`
  in the WITH CHECK. That subquery evaluates against nw_employees' own RLS and
  failed inside the storage INSERT context, so uploads were rejected with
  "new row violates row-level security policy" even for super_admins.

  Switch to the SECURITY DEFINER helper `nw_current_emp_is_admin()` — the same
  pattern the dsa-debit-notes storage policies already use — which reads
  nw_employees as its owner (bypassing that table's RLS) and returns whether the
  caller is an active admin/super_admin.
*/

DROP POLICY IF EXISTS "Admins can upload employee avatars" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update employee avatars" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete employee avatars" ON storage.objects;

CREATE POLICY "Admins can upload employee avatars"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'employee-avatars' AND public.nw_current_emp_is_admin());

CREATE POLICY "Admins can update employee avatars"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'employee-avatars' AND public.nw_current_emp_is_admin())
  WITH CHECK (bucket_id = 'employee-avatars' AND public.nw_current_emp_is_admin());

CREATE POLICY "Admins can delete employee avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'employee-avatars' AND public.nw_current_emp_is_admin());
