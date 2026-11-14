-- Mobile app releases, distributed from inside the CRM.
--
-- The Android app is a direct-download APK (no Play Store yet). An admin
-- uploads each new APK on CRM → My Workspace → Mobile App; every active
-- employee can download it there, and the CRM shows an "update available"
-- pop-up to an employee whose installed app (reported by the app's WebView as
-- window.__NIYOM_APP__ / its user agent) is older than the latest release.
--
-- Employees first. `audience` is here so partners and clients can be added
-- later without a schema change; today only 'employee' rows are readable.
--
-- The file lives in a PRIVATE bucket and is handed out as a short-lived signed
-- URL, so the download needs a CRM sign-in. `download_url` is an alternative
-- to an uploaded file (e.g. while the storage upload limit is below the APK
-- size); exactly one of the two must be set.

CREATE TABLE IF NOT EXISTS public.nw_app_releases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform      text NOT NULL DEFAULT 'android' CHECK (platform IN ('android')),
  audience      text NOT NULL DEFAULT 'employee' CHECK (audience IN ('employee', 'partner', 'client')),
  version_name  text NOT NULL CHECK (version_name ~ '^\d+\.\d+\.\d+$'),
  notes         text,
  is_mandatory  boolean NOT NULL DEFAULT false,
  storage_path  text,
  download_url  text CHECK (download_url IS NULL OR download_url ~ '^https://'),
  file_size     bigint,
  is_active     boolean NOT NULL DEFAULT true,
  published_by  uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nw_app_releases_one_source CHECK ((storage_path IS NULL) <> (download_url IS NULL)),
  CONSTRAINT nw_app_releases_unique_version UNIQUE (platform, audience, version_name)
);

CREATE INDEX IF NOT EXISTS nw_app_releases_published_by_idx ON public.nw_app_releases (published_by);
CREATE INDEX IF NOT EXISTS nw_app_releases_latest_idx
  ON public.nw_app_releases (platform, audience, published_at DESC) WHERE is_active;

-- Any ACTIVE employee (transfer_admin included — harmless, it is an app file).
CREATE OR REPLACE FUNCTION public.nw_current_emp_is_active()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM nw_employees
     WHERE auth_user_id = auth.uid() AND status = 'active'
  );
$$;
REVOKE EXECUTE ON FUNCTION public.nw_current_emp_is_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nw_current_emp_is_active() TO authenticated;

ALTER TABLE public.nw_app_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nw_app_releases_employee_read ON public.nw_app_releases;
CREATE POLICY nw_app_releases_employee_read ON public.nw_app_releases
  FOR SELECT TO authenticated
  USING (
    (SELECT public.nw_current_emp_is_admin())
    OR (audience = 'employee' AND is_active AND (SELECT public.nw_current_emp_is_active()))
  );

DROP POLICY IF EXISTS nw_app_releases_admin_insert ON public.nw_app_releases;
CREATE POLICY nw_app_releases_admin_insert ON public.nw_app_releases
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.nw_current_emp_is_admin()));

DROP POLICY IF EXISTS nw_app_releases_admin_update ON public.nw_app_releases;
CREATE POLICY nw_app_releases_admin_update ON public.nw_app_releases
  FOR UPDATE TO authenticated
  USING ((SELECT public.nw_current_emp_is_admin()))
  WITH CHECK ((SELECT public.nw_current_emp_is_admin()));

DROP POLICY IF EXISTS nw_app_releases_admin_delete ON public.nw_app_releases;
CREATE POLICY nw_app_releases_admin_delete ON public.nw_app_releases
  FOR DELETE TO authenticated USING ((SELECT public.nw_current_emp_is_admin()));

REVOKE ALL ON public.nw_app_releases FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nw_app_releases TO authenticated;

-- ---------------------------------------------------------------------------
-- Private bucket for the APK files. 300 MB per file (the bucket cap is still
-- bounded by the project-wide upload limit in Storage settings).
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('app-releases', 'app-releases', false, 314572800,
        ARRAY['application/vnd.android.package-archive', 'application/octet-stream'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Employees can read app releases" ON storage.objects;
CREATE POLICY "Employees can read app releases"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'app-releases' AND (SELECT public.nw_current_emp_is_active()));

DROP POLICY IF EXISTS "Admins can upload app releases" ON storage.objects;
CREATE POLICY "Admins can upload app releases"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'app-releases' AND (SELECT public.nw_current_emp_is_admin()));

DROP POLICY IF EXISTS "Admins can update app releases" ON storage.objects;
CREATE POLICY "Admins can update app releases"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'app-releases' AND (SELECT public.nw_current_emp_is_admin()))
  WITH CHECK (bucket_id = 'app-releases' AND (SELECT public.nw_current_emp_is_admin()));

DROP POLICY IF EXISTS "Admins can delete app releases" ON storage.objects;
CREATE POLICY "Admins can delete app releases"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'app-releases' AND (SELECT public.nw_current_emp_is_admin()));
