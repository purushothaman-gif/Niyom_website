-- Fold the registrar-fed MF value/count into the partner client-list rollup, so
-- a sourced client's AUM reflects their real funds once MF runs on the platform
-- (the drill-down gets MF via nw_partner_client_mf; this is the list total).
CREATE OR REPLACE FUNCTION public.nw_partner_clients_excluding_mf()
 RETURNS TABLE(client_id uuid, client_code text, full_name text, city text, mobile_masked text, onboarding_status text, verification_status text, sourced_on date, invested_amount numeric, current_value numeric, holdings_count integer)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_dsa uuid;
BEGIN
  v_dsa := nw_current_dsa_id();
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;
  RETURN QUERY
  SELECT c.id, c.client_code, c.full_name, COALESCE(c.city, ''),
         CASE WHEN length(c.phone) >= 4 THEN 'XXXXXX' || right(c.phone, 4) ELSE '' END,
         COALESCE(c.onboarding_status, ''), COALESCE(c.verification_status, ''),
         c.created_at::date,
         (COALESCE(SUM(h.invested_amount), 0) + rmf.mf_value)::numeric,
         (COALESCE(SUM(h.current_value), 0) + rmf.mf_value)::numeric,
         (COUNT(h.id) + rmf.mf_count)::int
  FROM nw_clients c
  LEFT JOIN nw_holdings h ON h.client_id = c.id AND h.product_type <> 'mutual_fund'
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(COALESCE(mh.rta_value, mh.nav_value, 0)), 0) AS mf_value,
           COUNT(mh.id) AS mf_count
    FROM mf_rta_folios mf JOIN mf_rta_holdings mh ON mh.folio_id = mf.id
    WHERE mf.client_id = c.id
  ) rmf ON true
  WHERE c.dsa_id = v_dsa AND c.sourced_via = 'dsa'
  GROUP BY c.id, c.client_code, c.full_name, c.city, c.phone,
           c.onboarding_status, c.verification_status, c.created_at, rmf.mf_value, rmf.mf_count
  ORDER BY c.full_name;
END $function$;
