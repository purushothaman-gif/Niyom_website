-- Confidentiality fix: the analytics jsonb carries clean_price / dirty_price
-- (= the base latest_price) and current_yield (= coupon / clean_price), any of
-- which lets a client/partner back out Niyom's base price and thus the markup.
-- Strip those keys from every client/partner-facing projection. The UI reads only
-- ytm / years_to_maturity / accrued_per_100 / total_future_*, so nothing breaks.

CREATE OR REPLACE FUNCTION bm_public_analytics(a jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN a IS NULL THEN NULL
              ELSE a - 'clean_price' - 'dirty_price' - 'current_yield' END
$$;

-- ---- client list + detail ----
CREATE OR REPLACE FUNCTION nw_client_bonds()
RETURNS TABLE (id uuid, isin text, bond_name text, issuer_name text, coupon_rate numeric,
  coupon_type text, coupon_frequency text, maturity_date date, next_coupon_date date, issue_date date,
  rating text, rating_agency text, security_type text, tax_status text, trustee text,
  day_count_convention text, principal_repayment_structure text,
  min_investment numeric, face_value numeric, client_price numeric, analytics jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid := nw_current_client_id(); v_emp uuid; v_m numeric;
BEGIN
  IF v_client IS NULL THEN RAISE EXCEPTION 'Client access required'; END IF;
  SELECT c.employee_id INTO v_emp FROM nw_clients c WHERE c.id = v_client;
  v_m := bm_resolve_markup('client', v_client, NULL, v_emp);
  IF v_m IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT b.id, b.isin, b.bond_name, i.name, b.coupon_rate, b.coupon_type, b.coupon_frequency,
           b.maturity_date, b.next_coupon_date, b.issue_date, b.rating, b.rating_agency,
           b.security_type, b.tax_status, b.trustee, b.day_count_convention, b.principal_repayment_structure,
           b.min_investment, b.face_value, round(b.latest_price * (1 + v_m/100), 4), bm_public_analytics(b.analytics)
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    WHERE b.active_status='active' AND b.latest_price IS NOT NULL
    ORDER BY b.bond_name;
END; $$;

CREATE OR REPLACE FUNCTION nw_client_bond(p_id uuid)
RETURNS TABLE (id uuid, isin text, bond_name text, issuer_name text, coupon_rate numeric,
  coupon_type text, coupon_frequency text, maturity_date date, next_coupon_date date, issue_date date,
  rating text, rating_agency text, security_type text, tax_status text, trustee text,
  day_count_convention text, principal_repayment_structure text,
  min_investment numeric, face_value numeric, client_price numeric, analytics jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid := nw_current_client_id(); v_emp uuid; v_m numeric;
BEGIN
  IF v_client IS NULL THEN RAISE EXCEPTION 'Client access required'; END IF;
  SELECT c.employee_id INTO v_emp FROM nw_clients c WHERE c.id = v_client;
  v_m := bm_resolve_markup('client', v_client, NULL, v_emp);
  IF v_m IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT b.id, b.isin, b.bond_name, i.name, b.coupon_rate, b.coupon_type, b.coupon_frequency,
           b.maturity_date, b.next_coupon_date, b.issue_date, b.rating, b.rating_agency,
           b.security_type, b.tax_status, b.trustee, b.day_count_convention, b.principal_repayment_structure,
           b.min_investment, b.face_value, round(b.latest_price * (1 + v_m/100), 4), bm_public_analytics(b.analytics)
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    WHERE b.id = p_id AND b.active_status='active' AND b.latest_price IS NOT NULL;
END; $$;

-- ---- partner list + detail ----
CREATE OR REPLACE FUNCTION nw_partner_bonds()
RETURNS TABLE (id uuid, isin text, bond_name text, issuer_name text, coupon_rate numeric,
  coupon_type text, coupon_frequency text, maturity_date date, next_coupon_date date, issue_date date,
  rating text, rating_agency text, security_type text, seniority text, tax_status text, trustee text,
  day_count_convention text, principal_repayment_structure text,
  min_investment numeric, face_value numeric,
  partner_base numeric, self_markup_percent numeric, partner_price numeric, analytics jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dsa uuid := nw_current_dsa_id(); v_emp uuid; v_m numeric; v_self numeric;
BEGIN
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;
  SELECT d.employee_id INTO v_emp FROM nw_dsa d WHERE d.id = v_dsa;
  SELECT coalesce(s.markup_percent, 0) INTO v_self FROM bm_partner_self_markup s WHERE s.dsa_id = v_dsa;
  v_self := coalesce(v_self, 0);
  v_m := bm_resolve_markup('partner', NULL, v_dsa, v_emp);
  IF v_m IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT b.id, b.isin, b.bond_name, i.name, b.coupon_rate, b.coupon_type, b.coupon_frequency,
           b.maturity_date, b.next_coupon_date, b.issue_date, b.rating, b.rating_agency,
           b.security_type, b.seniority, b.tax_status, b.trustee, b.day_count_convention,
           b.principal_repayment_structure, b.min_investment, b.face_value,
           round(b.latest_price * (1 + v_m/100), 4) AS partner_base,
           v_self,
           round(round(b.latest_price * (1 + v_m/100), 4) * (1 + v_self/100), 4) AS partner_price,
           bm_public_analytics(b.analytics)
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    WHERE b.active_status='active' AND b.latest_price IS NOT NULL
    ORDER BY b.bond_name;
END; $$;

CREATE OR REPLACE FUNCTION nw_partner_bond(p_id uuid)
RETURNS TABLE (id uuid, isin text, bond_name text, issuer_name text, coupon_rate numeric,
  coupon_type text, coupon_frequency text, maturity_date date, next_coupon_date date, issue_date date,
  rating text, rating_agency text, security_type text, seniority text, tax_status text, trustee text,
  day_count_convention text, principal_repayment_structure text,
  min_investment numeric, face_value numeric,
  partner_base numeric, self_markup_percent numeric, partner_price numeric, analytics jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dsa uuid := nw_current_dsa_id(); v_emp uuid; v_m numeric; v_self numeric;
BEGIN
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;
  SELECT d.employee_id INTO v_emp FROM nw_dsa d WHERE d.id = v_dsa;
  SELECT coalesce(s.markup_percent, 0) INTO v_self FROM bm_partner_self_markup s WHERE s.dsa_id = v_dsa;
  v_self := coalesce(v_self, 0);
  v_m := bm_resolve_markup('partner', NULL, v_dsa, v_emp);
  IF v_m IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT b.id, b.isin, b.bond_name, i.name, b.coupon_rate, b.coupon_type, b.coupon_frequency,
           b.maturity_date, b.next_coupon_date, b.issue_date, b.rating, b.rating_agency,
           b.security_type, b.seniority, b.tax_status, b.trustee, b.day_count_convention,
           b.principal_repayment_structure, b.min_investment, b.face_value,
           round(b.latest_price * (1 + v_m/100), 4) AS partner_base,
           v_self,
           round(round(b.latest_price * (1 + v_m/100), 4) * (1 + v_self/100), 4) AS partner_price,
           bm_public_analytics(b.analytics)
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    WHERE b.id = p_id AND b.active_status='active' AND b.latest_price IS NOT NULL;
END; $$;
