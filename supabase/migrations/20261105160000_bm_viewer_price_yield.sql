/*
  Confidentiality: every client/partner-facing yield is now computed at the price THAT viewer
  pays — never derived from the dealer base price (bm_bonds.latest_price).

  The leak: bm_bonds.analytics.ytm / macaulay_duration / modified_duration are computed by
  bond-enrich at the BASE price. bm_public_analytics() stripped clean/dirty price, current
  yield and accrued_check but left those three, and bm_adjust_ytm() (20261022120000) only
  shifted ytm by a first-order duration approximation:
      shown_ytm = base_ytm − 100·(factor−1) / base_modified_duration
  while returning base_modified_duration unchanged. With the cash-flow schedule (public
  coupon/maturity terms) a duration is a monotone function of yield, so the base duration
  alone pins base_ytm → base price → markup. Same for the public /bond-offer edge function
  resolve-bond-share, which additionally returned accrued_check.

  Fix:
    1. bm_public_analytics() also strips ytm, macaulay_duration, modified_duration.
    2. bm_viewer_analytics(bond_id, clean_per_100) re-solves YTM (XIRR, nominal at the coupon
       frequency) and Macaulay/modified duration from bm_cashflow_schedule at the VIEWER's
       clean price + accrued — the same maths as bond-enrich/analytics.ts — and returns the
       public analytics with those figures. Output depends only on the viewer's price, the
       public cash-flow schedule and accrued interest; nothing from latest_price.
       Internal: EXECUTE for service_role only (callers are SECURITY DEFINER RPCs and the
       resolve-bond-share edge function).
    3. nw_client_bond(s) / nw_partner_bond(s) use it at client_price / partner_price.
    4. bm_adjust_ytm() is dropped (no remaining callers).
*/

CREATE OR REPLACE FUNCTION bm_public_analytics(a jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN a IS NULL THEN NULL
              ELSE a - 'clean_price' - 'dirty_price' - 'current_yield' - 'accrued_check'
                     - 'ytm' - 'macaulay_duration' - 'modified_duration' END
$$;

CREATE OR REPLACE FUNCTION bm_viewer_analytics(p_bond_id uuid, p_clean numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  a jsonb; v_freq text; v_settle date; v_dirty float8; v_m int;
  t float8[]; amt float8[];
  y float8; f float8; df float8; dy float8; i int;
  lo float8; hi float8; flo float8; fhi float8; fm float8; mid float8;
  v_ok boolean := false; pv float8; pvw float8; v_ynom float8; v_mac numeric; v_mod numeric;
BEGIN
  SELECT b.analytics, b.coupon_frequency INTO a, v_freq FROM bm_bonds b WHERE b.id = p_bond_id;
  IF a IS NULL THEN RETURN NULL; END IF;
  a := bm_public_analytics(a);
  IF p_clean IS NULL OR p_clean <= 0 OR coalesce(a->>'settlement_date', '') = '' THEN RETURN a; END IF;

  v_settle := (a->>'settlement_date')::date;
  v_dirty  := p_clean::float8 + coalesce((a->>'accrued_per_100')::float8, 0);
  -- analytics.ts: m = zero-coupon ? 1 : perYear; coupons_per_year = zero ? null : perYear.
  -- Analytics written before coupons_per_year existed lack the key → fall back to the label.
  v_m := greatest(1, CASE
    WHEN a ? 'coupons_per_year' THEN coalesce(nullif(a->>'coupons_per_year', '')::int, 1)
    WHEN v_freq = 'monthly' THEN 12 WHEN v_freq = 'quarterly' THEN 4
    WHEN v_freq = 'half_yearly' THEN 2 ELSE 1 END);

  SELECT array_agg((c.cf_date - v_settle)::float8 / 365 ORDER BY c.seq),
         array_agg(c.total_per_100::float8 ORDER BY c.seq)
    INTO t, amt
    FROM bm_cashflow_schedule c
   WHERE c.bond_id = p_bond_id AND c.cf_date > v_settle;
  IF t IS NULL OR v_dirty <= 0 THEN RETURN a; END IF;

  -- Effective annual yield y: Σ amt / (1+y)^t = dirty. Newton first, bisection fallback
  -- (the same bracket as analytics.ts xirr()).
  y := 0.08;
  FOR i IN 1..60 LOOP
    SELECT sum(u.a / power(1 + y, u.t)) - v_dirty, sum(-u.t * u.a / power(1 + y, u.t + 1))
      INTO f, df FROM unnest(t, amt) AS u(t, a);
    EXIT WHEN df IS NULL OR df = 0;
    dy := f / df;
    y := y - dy;
    IF y <= -0.99 OR y > 10 OR y <> y THEN EXIT; END IF;
    IF abs(dy) < 1e-12 THEN v_ok := true; EXIT; END IF;
  END LOOP;

  IF NOT v_ok THEN
    lo := 1e-5; hi := 1;
    SELECT sum(u.a / power(1 + lo, u.t)) - v_dirty INTO flo FROM unnest(t, amt) AS u(t, a);
    SELECT sum(u.a / power(1 + hi, u.t)) - v_dirty INTO fhi FROM unnest(t, amt) AS u(t, a);
    i := 0;
    WHILE flo * fhi > 0 AND i < 80 AND hi <= 10 LOOP
      hi := hi * 1.4; i := i + 1;
      SELECT sum(u.a / power(1 + hi, u.t)) - v_dirty INTO fhi FROM unnest(t, amt) AS u(t, a);
    END LOOP;
    IF flo * fhi > 0 THEN RETURN a; END IF;           -- no root: show no yield (UI falls back to coupon)
    FOR i IN 1..200 LOOP
      mid := (lo + hi) / 2;
      SELECT sum(u.a / power(1 + mid, u.t)) - v_dirty INTO fm FROM unnest(t, amt) AS u(t, a);
      EXIT WHEN abs(fm) < 1e-9 OR hi - lo < 1e-13;
      IF flo * fm < 0 THEN hi := mid; ELSE lo := mid; flo := fm; END IF;
    END LOOP;
    y := (lo + hi) / 2;
  END IF;

  v_ynom := CASE WHEN v_m > 1 THEN v_m * (power(1 + y, 1.0 / v_m) - 1) ELSE y END;
  SELECT sum(u.a / power(1 + y, u.t)), sum(u.t * u.a / power(1 + y, u.t))
    INTO pv, pvw FROM unnest(t, amt) AS u(t, a);
  IF pv > 0 THEN
    v_mac := round((pvw / pv)::numeric, 4);
    v_mod := round(v_mac / (1 + v_ynom / v_m)::numeric, 4);
  END IF;

  RETURN a || jsonb_build_object(
    'ytm', round((v_ynom * 100)::numeric, 4),
    'macaulay_duration', v_mac,
    'modified_duration', v_mod);
END; $$;

REVOKE ALL ON FUNCTION bm_viewer_analytics(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION bm_viewer_analytics(uuid, numeric) FROM anon;
REVOKE ALL ON FUNCTION bm_viewer_analytics(uuid, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION bm_viewer_analytics(uuid, numeric) TO service_role;

-- ---- client list + detail: yield at client_price ----
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
           b.min_investment, b.face_value, p.price,
           bm_viewer_analytics(b.id, p.price)
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    CROSS JOIN LATERAL (SELECT round(b.latest_price * (1 + v_m/100), 4) AS price) p
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
           b.min_investment, b.face_value, p.price,
           bm_viewer_analytics(b.id, p.price)
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    CROSS JOIN LATERAL (SELECT round(b.latest_price * (1 + v_m/100), 4) AS price) p
    WHERE b.id = p_id AND b.active_status='active' AND b.verification_status='verified' AND b.latest_price IS NOT NULL;
END; $$;

-- ---- partner list + detail: yield at partner_price (what the partner's client pays) ----
CREATE OR REPLACE FUNCTION nw_partner_bonds()
RETURNS TABLE (id uuid, isin text, bond_name text, issuer_name text, coupon_rate numeric,
  coupon_type text, coupon_frequency text, maturity_date date, next_coupon_date date, issue_date date,
  rating text, rating_agency text, security_type text, seniority text, tax_status text, trustee text,
  day_count_convention text, principal_repayment_structure text, min_investment numeric, face_value numeric,
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
           pb.base AS partner_base,
           v_self,
           pp.price AS partner_price,
           bm_viewer_analytics(b.id, pp.price)
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    CROSS JOIN LATERAL (SELECT round(b.latest_price * (1 + v_m/100), 4) AS base) pb
    CROSS JOIN LATERAL (SELECT round(pb.base * (1 + v_self/100), 4) AS price) pp
    WHERE b.active_status='active' AND b.verification_status='verified' AND b.latest_price IS NOT NULL
    ORDER BY b.bond_name;
END; $$;

CREATE OR REPLACE FUNCTION nw_partner_bond(p_id uuid)
RETURNS TABLE (id uuid, isin text, bond_name text, issuer_name text, coupon_rate numeric,
  coupon_type text, coupon_frequency text, maturity_date date, next_coupon_date date, issue_date date,
  rating text, rating_agency text, security_type text, seniority text, tax_status text, trustee text,
  day_count_convention text, principal_repayment_structure text, min_investment numeric, face_value numeric,
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
           pb.base AS partner_base,
           v_self,
           pp.price AS partner_price,
           bm_viewer_analytics(b.id, pp.price)
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    CROSS JOIN LATERAL (SELECT round(b.latest_price * (1 + v_m/100), 4) AS base) pb
    CROSS JOIN LATERAL (SELECT round(pb.base * (1 + v_self/100), 4) AS price) pp
    WHERE b.id = p_id AND b.active_status='active' AND b.verification_status='verified' AND b.latest_price IS NOT NULL;
END; $$;

DROP FUNCTION IF EXISTS bm_adjust_ytm(jsonb, numeric);
