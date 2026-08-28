-- Partner bond detail: widen nw_partner_bonds() with the same safe detail fields the
-- client detail page uses, and add a single-bond nw_partner_bond(id) for the detail view.
-- Still no cost/latest_price leak beyond partner_base (the RM-approved partner cost) which
-- the partner is entitled to see. Marketing-image fields (security_type, seniority, tax_status)
-- are included so the partner poster renders at full fidelity.

DROP FUNCTION IF EXISTS nw_partner_bonds();
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
           b.analytics
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
           b.analytics
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    WHERE b.id = p_id AND b.active_status='active' AND b.latest_price IS NOT NULL;
END; $$;

REVOKE ALL ON FUNCTION nw_partner_bond(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nw_partner_bond(uuid) TO authenticated;
