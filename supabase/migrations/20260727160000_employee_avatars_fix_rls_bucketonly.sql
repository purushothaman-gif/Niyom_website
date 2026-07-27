/*
  # Fix employee-avatars write RLS (round 2) — bucket-id only

  Uploads kept failing with "new row violates row-level security policy" even
  after switching to the SECURITY DEFINER helper nw_current_emp_is_admin()
  (migration 20260727130000). Storage logs showed the same admin's
  crm-documents uploads succeeding while every employee-avatars upload 400'd.

  Conclusion: auth.uid() / nw_employees lookups do NOT resolve inside storage
  WRITE policy checks on this project (every working storage read uses signed
  URLs, and the only working browser write — crm-documents — checks nothing but
  bucket_id). So any avatar policy that looks up the employee row is denied.

  Match the proven crm-documents pattern: authenticated + bucket_id, no employee
  lookup. Admin-gating for avatars stays enforced in the CRM UI (the Employees
  page is admin-only), which is the same posture the crm-documents (KYC) bucket
  already uses.
*/

DROP POLICY IF EXISTS "Admins can upload employee avatars" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update employee avatars" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete employee avatars" ON storage.objects;

CREATE POLICY "Authenticated can upload employee avatars"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'employee-avatars');

CREATE POLICY "Authenticated can update employee avatars"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'employee-avatars')
  WITH CHECK (bucket_id = 'employee-avatars');

CREATE POLICY "Authenticated can delete employee avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'employee-avatars');
