/*
  # Fix employee-avatars uploads — the REAL root cause: missing SELECT policy

  Uploads kept failing with "new row violates row-level security policy" (403)
  through migrations 120000 / 130000 / 160000. Reproduced end-to-end with a
  throwaway authenticated employee + the Supabase JS client:

    - A raw Postgres INSERT into storage.objects as that authenticated user was
      ALLOWED (so the DB write policy was never the problem).
    - The storage API upload still returned the RLS error — because the bucket
      had no SELECT policy. The storage API's upload path needs SELECT on the
      bucket for the authenticated role; the working crm-documents bucket has
      one, employee-avatars did not.

  Fix: add the SELECT policy. With it present, admin-gated writes work too
  (verified: super_admin/admin uploads succeed, a plain employee is denied), so
  we also restore proper admin-only WRITE policies via nw_current_emp_is_admin()
  and keep authenticated READ (avatars render from a public bucket anyway).

  This migration reflects the final live policy set and supersedes the write
  policies from 120000 / 130000 / 160000.
*/

DROP POLICY IF EXISTS "Admins can upload employee avatars" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update employee avatars" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete employee avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload employee avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can update employee avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete employee avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read employee avatars" ON storage.objects;

-- READ: required by the storage API upload path (and avatars are effectively public).
CREATE POLICY "Authenticated can read employee avatars"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'employee-avatars');

-- WRITES: admins / super_admins only.
CREATE POLICY "Admins can upload employee avatars"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'employee-avatars' AND public.nw_current_emp_is_admin());

CREATE POLICY "Admins can update employee avatars"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'employee-avatars' AND public.nw_current_emp_is_admin())
  WITH CHECK (bucket_id = 'employee-avatars' AND public.nw_current_emp_is_admin());

CREATE POLICY "Admins can delete employee avatars"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'employee-avatars' AND public.nw_current_emp_is_admin());
