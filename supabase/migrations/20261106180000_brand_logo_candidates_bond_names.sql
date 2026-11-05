-- Brand Logos page: also list bonds that have no bm_issuers link. ~250 bonds came
-- in through the {isin, bond_name, price} importer, so their issuer exists only
-- inside the bond name ("10.25% MUTHOOT MERCANTILE LIMITED 2029"). They're
-- returned raw as kind 'bond_name'; the page derives and de-duplicates the issuer
-- (src/components/brandMatch.ts) so there is one parser, not a SQL copy of it.
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
  UNION ALL
  SELECT 'bond_name', b.bond_name, count(*)
    FROM bm_bonds b
   WHERE b.issuer_id IS NULL AND coalesce(trim(b.bond_name), '') <> ''
   GROUP BY b.bond_name
$$;
REVOKE EXECUTE ON FUNCTION public.nw_brand_logo_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nw_brand_logo_candidates() TO authenticated;
