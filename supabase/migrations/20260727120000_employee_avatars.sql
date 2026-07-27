/*
  # Employee & admin profile pictures

  Adds an avatar to `nw_employees` (employees + admins share this table) and a
  storage bucket to hold the images. Uploaded from the CRM Employees page
  (admin-only) and shown wherever an employee is rendered (sidebar, header,
  Employees list, Dashboard standings), with an initials-badge fallback.

  ## Access model
  - Bucket is PUBLIC so avatars load in headers/sidebars without per-render
    signed URLs (same pattern as the DSA photo flow on crm-documents).
  - WRITE (INSERT/UPDATE/DELETE): admins / super_admins only, via RLS below.
  - READ: public (public bucket), no SELECT policy required.
*/

-- 1. Column on the employees/admins table
ALTER TABLE public.nw_employees
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- 2. Public bucket (id == name)
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-avatars', 'employee-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Write policies — admins only
CREATE POLICY "Admins can upload employee avatars"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'employee-avatars'
    AND EXISTS (
      SELECT 1 FROM public.nw_employees
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can update employee avatars"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'employee-avatars'
    AND EXISTS (
      SELECT 1 FROM public.nw_employees
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    bucket_id = 'employee-avatars'
    AND EXISTS (
      SELECT 1 FROM public.nw_employees
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  );

CREATE POLICY "Admins can delete employee avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'employee-avatars'
    AND EXISTS (
      SELECT 1 FROM public.nw_employees
      WHERE auth_user_id = auth.uid()
        AND role IN ('admin', 'super_admin')
    )
  );
