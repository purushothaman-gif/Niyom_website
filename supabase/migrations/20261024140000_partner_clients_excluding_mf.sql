-- Partner client list without mutual funds.
--
-- Mutual funds are moving to the external MF platform, which becomes the MF
-- record. Once the portal's MF switch (VITE_MF_SSO) is on, the partner portal
-- must not total our older mutual fund rows beside it. nw_partner_clients sums
-- every nw_holdings row server-side, so the client cannot filter it; this twin
-- leaves mutual_fund rows out of the sums and the count.
--
-- Additive on purpose: the live portal keeps calling nw_partner_clients until
-- the switch flips, and a new name avoids a PostgREST overload ambiguity with
-- the zero-argument original.

CREATE OR REPLACE FUNCTION public.nw_partner_clients_excluding_mf()
 RETURNS TABLE(client_id uuid, client_code text, full_name text, city text, mobile_masked text, onboarding_status text, verification_status text, sourced_on date, invested_amount numeric, current_value numeric, holdings_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
         COALESCE(SUM(h.invested_amount), 0)::numeric,
         COALESCE(SUM(h.current_value), 0)::numeric,
         COUNT(h.id)::int
  FROM nw_clients c
  LEFT JOIN nw_holdings h ON h.client_id = c.id AND h.product_type <> 'mutual_fund'
  WHERE c.dsa_id = v_dsa AND c.sourced_via = 'dsa'
  GROUP BY c.id, c.client_code, c.full_name, c.city, c.phone,
           c.onboarding_status, c.verification_status, c.created_at
  ORDER BY c.full_name;
END $function$;

-- Same exposure as nw_partner_clients: partners call it with their own session.
REVOKE ALL ON FUNCTION public.nw_partner_clients_excluding_mf() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nw_partner_clients_excluding_mf() TO authenticated;
