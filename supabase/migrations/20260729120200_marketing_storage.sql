/*
  # Marketing Tool — content asset storage

  Private bucket holding every rendered asset: posters (one PNG per platform
  aspect ratio), carousel slides and videos. Paths are

      content/<content_id>/<variant>.<ext>

  ## Access model
  - PRIVATE bucket. Employees never get a public URL; the UI fetches short-lived
    signed URLs (createSignedUrl, 120s) exactly like crm-documents/deal-documents.
  - WRITE (INSERT/UPDATE/DELETE): admins only, via nw_current_emp_is_admin().
  - READ: any active employee. A blanket SELECT is required anyway — the storage
    API's upload path itself needs SELECT on the bucket for the authenticated
    role (this is the root cause that broke employee-avatars uploads through
    three migrations; see 20260727170000). Read access is not a leak here:
    object paths are uuid-based and undiscoverable, and the listing an employee
    works from is mkt_content_assets, which is RLS-restricted to approved,
    unexpired content.
  - Expiry/admin deletion removes objects via the service role in the
    mkt-expire-content edge function, so no client-side delete is relied upon.

  ## Safety
  Idempotent: bucket insert is ON CONFLICT DO NOTHING, every policy is dropped
  before being created. No other bucket or policy is touched.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('marketing-content', 'marketing-content', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Employees can read marketing content assets"  ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload marketing content assets"   ON storage.objects;
DROP POLICY IF EXISTS "Admins can update marketing content assets"   ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete marketing content assets"   ON storage.objects;

-- READ: required by the storage API upload path and by signed-URL creation.
CREATE POLICY "Employees can read marketing content assets"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'marketing-content'
    AND public.nw_current_employee_id() IS NOT NULL
  );

CREATE POLICY "Admins can upload marketing content assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'marketing-content' AND public.nw_current_emp_is_admin());

CREATE POLICY "Admins can update marketing content assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'marketing-content' AND public.nw_current_emp_is_admin())
  WITH CHECK (bucket_id = 'marketing-content' AND public.nw_current_emp_is_admin());

CREATE POLICY "Admins can delete marketing content assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'marketing-content' AND public.nw_current_emp_is_admin());
