-- YTM must reflect the price the client/partner actually pays. The stored analytics.ytm
-- is computed at the BASE price (latest_price); when a markup raises the price, the real
-- yield falls, but the displayed YTM stayed put. Recompute it at the shown price using the
-- bond's modified duration (first-order, exact enough for ≤5% markups): a +X% price move
-- lowers YTM by ~X/ModDur percentage points. O(1) per bond, no XIRR in SQL. Figures stay
-- indicative. If modified_duration is missing/≤0, the base YTM is kept unchanged.

CREATE OR REPLACE FUNCTION bm_adjust_ytm(a jsonb, price_factor numeric) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN a IS NULL THEN NULL
    WHEN price_factor IS NULL OR price_factor <= 0 THEN a
    WHEN (a->>'modified_duration') IS NULL OR (a->>'modified_duration')::numeric <= 0
         OR (a->>'ytm') IS NULL THEN a
    ELSE jsonb_set(a, '{ytm}', to_jsonb(round(
      (a->>'ytm')::numeric - ((price_factor - 1) * 100) / (a->>'modified_duration')::numeric, 4)))
  END
$$;

-- ---- client list + detail (factor = 1 + approved client markup) ----
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
           b.min_investment, b.face_value, round(b.latest_price * (1 + v_m/100), 4),
           bm_adjust_ytm(bm_public_analytics(b.analytics), 1 + v_m/100)
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    WHERE b.active_status='active' AND b.verification_status='verified' AND b.latest_price IS NOT NULL
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
           b.min_investment, b.face_value, round(b.latest_price * (1 + v_m/100), 4),
           bm_adjust_ytm(bm_public_analytics(b.analytics), 1 + v_m/100)
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    WHERE b.id = p_id AND b.active_status='active' AND b.verification_status='verified' AND b.latest_price IS NOT NULL;
END; $$;

-- ---- partner list + detail (factor = (1 + RM rate) × (1 + self markup)) ----
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
           bm_adjust_ytm(bm_public_analytics(b.analytics), (1 + v_m/100) * (1 + v_self/100))
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    WHERE b.active_status='active' AND b.verification_status='verified' AND b.latest_price IS NOT NULL
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
           bm_adjust_ytm(bm_public_analytics(b.analytics), (1 + v_m/100) * (1 + v_self/100))
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    WHERE b.id = p_id AND b.active_status='active' AND b.verification_status='verified' AND b.latest_price IS NOT NULL;
END; $$;
