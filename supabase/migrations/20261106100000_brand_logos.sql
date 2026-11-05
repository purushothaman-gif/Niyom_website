-- Brand logos for mutual-fund AMCs and bond issuers.
--
-- Unlisted shares carry their own us_shares.logo_url. Funds and bonds have no
-- per-row home that reaches every surface: client/partner bonds come through the
-- markup-safe viewer RPCs (bm_viewer_analytics / bm_public_analytics — see the
-- price-leak invariant), and funds come from three catalogs (mutual_funds,
-- mf_scheme_cache, BSE master) joined by name only. So instead of widening those
-- RPCs, logos live in one small name-keyed lookup the front end loads once.
--
--   kind      'amc'          → keyed by fund house name ("HDFC Mutual Fund")
--             'bond_issuer'  → keyed by bm_issuers.name ("BAJAJ FINANCE LIMITED")
--   name_key  normalised name (lower-case, alphanumerics only) so casing and
--             punctuation drift ("ASK MUTUAL FUND" vs "Ask Mutual Fund") still hit.
--
-- A logo is public marketing material (shown on the unauthenticated /bond-offer
-- page), so reads are open to anon; writes are admin-only, same as share-logos.

CREATE TABLE IF NOT EXISTS public.nw_brand_logos (
  kind        text NOT NULL CHECK (kind IN ('amc', 'bond_issuer')),
  name        text NOT NULL,
  name_key    text GENERATED ALWAYS AS (regexp_replace(lower(name), '[^a-z0-9]', '', 'g')) STORED,
  logo_url    text NOT NULL,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, name_key)
);

ALTER TABLE public.nw_brand_logos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nw_brand_logos_read ON public.nw_brand_logos;
CREATE POLICY nw_brand_logos_read ON public.nw_brand_logos
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS nw_brand_logos_admin_write ON public.nw_brand_logos;
CREATE POLICY nw_brand_logos_admin_write ON public.nw_brand_logos
  FOR ALL TO authenticated
  USING ((SELECT public.nw_current_emp_is_admin()))
  WITH CHECK ((SELECT public.nw_current_emp_is_admin()));

GRANT SELECT ON public.nw_brand_logos TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.nw_brand_logos TO authenticated;

-- ---------------------------------------------------------------------------
-- Bucket. Public, with the SELECT policy the upload path needs (see
-- 20260727170000 / share-logos).
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-logos', 'brand-logos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can read brand logos" ON storage.objects;
CREATE POLICY "Authenticated can read brand logos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'brand-logos');

DROP POLICY IF EXISTS "Admins can upload brand logos" ON storage.objects;
CREATE POLICY "Admins can upload brand logos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'brand-logos' AND public.nw_current_emp_is_admin());

DROP POLICY IF EXISTS "Admins can update brand logos" ON storage.objects;
CREATE POLICY "Admins can update brand logos"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'brand-logos' AND public.nw_current_emp_is_admin())
  WITH CHECK (bucket_id = 'brand-logos' AND public.nw_current_emp_is_admin());

DROP POLICY IF EXISTS "Admins can delete brand logos" ON storage.objects;
CREATE POLICY "Admins can delete brand logos"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'brand-logos' AND public.nw_current_emp_is_admin());

-- ---------------------------------------------------------------------------
-- Every name that can carry a logo, for the CRM Brand Logos page. INVOKER, so
-- bm_issuers stays admin-only via its own RLS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nw_brand_logo_candidates()
RETURNS TABLE (kind text, name text, uses bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT 'amc', fund_house, count(*)
    FROM (SELECT fund_house FROM mf_scheme_cache
          UNION ALL SELECT fund_house FROM mutual_funds) f
   WHERE coalesce(trim(fund_house), '') <> ''
   GROUP BY fund_house
  UNION ALL
  SELECT 'bond_issuer', i.name, count(b.id)
    FROM bm_issuers i JOIN bm_bonds b ON b.issuer_id = i.id
   GROUP BY i.name
$$;
REVOKE EXECUTE ON FUNCTION public.nw_brand_logo_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nw_brand_logo_candidates() TO authenticated;
