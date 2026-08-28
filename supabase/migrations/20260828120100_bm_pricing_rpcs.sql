-- Current client id (uuid twin of nw_current_client_code()).
CREATE OR REPLACE FUNCTION nw_current_client_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM nw_clients
  WHERE client_auth_user_id = (SELECT auth.uid()) AND client_login_enabled LIMIT 1;
$$;

-- Effective APPROVED markup %: individual override -> RM group -> company-wide group -> NULL (no fallback).
CREATE OR REPLACE FUNCTION bm_resolve_markup(p_audience text, p_client_id uuid, p_dsa_id uuid, p_employee_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m numeric;
BEGIN
  IF p_audience = 'client' AND p_client_id IS NOT NULL THEN
    SELECT markup_percent INTO m FROM bm_price_markup
     WHERE status='approved' AND audience='client' AND scope='individual' AND client_id = p_client_id LIMIT 1;
    IF m IS NOT NULL THEN RETURN m; END IF;
  ELSIF p_audience = 'partner' AND p_dsa_id IS NOT NULL THEN
    SELECT markup_percent INTO m FROM bm_price_markup
     WHERE status='approved' AND audience='partner' AND scope='individual' AND dsa_id = p_dsa_id LIMIT 1;
    IF m IS NOT NULL THEN RETURN m; END IF;
  END IF;
  IF p_employee_id IS NOT NULL THEN
    SELECT markup_percent INTO m FROM bm_price_markup
     WHERE status='approved' AND audience=p_audience AND scope='group' AND employee_id = p_employee_id LIMIT 1;
    IF m IS NOT NULL THEN RETURN m; END IF;
  END IF;
  SELECT markup_percent INTO m FROM bm_price_markup
   WHERE status='approved' AND audience=p_audience AND scope='group' AND employee_id IS NULL LIMIT 1;
  RETURN m;   -- NULL when nothing approved applies
END; $$;

-- Client-facing bond list. Marked-up price + safe factual fields only; no latest_price/landing_cost/margin.
CREATE OR REPLACE FUNCTION nw_client_bonds()
RETURNS TABLE (id uuid, isin text, bond_name text, issuer_name text, coupon_rate numeric,
  coupon_frequency text, maturity_date date, rating text, min_investment numeric,
  face_value numeric, client_price numeric, analytics jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid := nw_current_client_id(); v_emp uuid; v_m numeric;
BEGIN
  IF v_client IS NULL THEN RAISE EXCEPTION 'Client access required'; END IF;
  SELECT c.employee_id INTO v_emp FROM nw_clients c WHERE c.id = v_client;
  v_m := bm_resolve_markup('client', v_client, NULL, v_emp);
  IF v_m IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT b.id, b.isin, b.bond_name, i.name, b.coupon_rate, b.coupon_frequency, b.maturity_date,
           b.rating, b.min_investment, b.face_value,
           round(b.latest_price * (1 + v_m/100), 4), b.analytics
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    WHERE b.active_status='active' AND b.latest_price IS NOT NULL
    ORDER BY b.bond_name;
END; $$;

-- Partner-facing bond list. partner_base = employee-set price (their cost); partner_price adds their own <=5% spread.
CREATE OR REPLACE FUNCTION nw_partner_bonds()
RETURNS TABLE (id uuid, isin text, bond_name text, issuer_name text, coupon_rate numeric,
  coupon_frequency text, maturity_date date, rating text, min_investment numeric, face_value numeric,
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
    SELECT b.id, b.isin, b.bond_name, i.name, b.coupon_rate, b.coupon_frequency, b.maturity_date,
           b.rating, b.min_investment, b.face_value,
           round(b.latest_price * (1 + v_m/100), 4),
           v_self,
           round(round(b.latest_price * (1 + v_m/100), 4) * (1 + v_self/100), 4),
           b.analytics
    FROM bm_bonds b LEFT JOIN bm_issuers i ON i.id = b.issuer_id
    WHERE b.active_status='active' AND b.latest_price IS NOT NULL
    ORDER BY b.bond_name;
END; $$;

-- Partner sets their own spread (0..5%). No approval; hard cap enforced.
CREATE OR REPLACE FUNCTION nw_partner_set_bond_markup(p_percent numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dsa uuid := nw_current_dsa_id();
BEGIN
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;
  IF p_percent IS NULL OR p_percent < 0 OR p_percent > 5 THEN
    RAISE EXCEPTION 'Your markup must be between 0%% and 5%%.';
  END IF;
  INSERT INTO bm_partner_self_markup (dsa_id, markup_percent, updated_at)
  VALUES (v_dsa, p_percent, now())
  ON CONFLICT (dsa_id) DO UPDATE SET markup_percent = EXCLUDED.markup_percent, updated_at = now();
  RETURN p_percent;
END; $$;

-- Propose a markup (RM for their own client/partner/group; admin also company-wide). Supersedes any active row.
CREATE OR REPLACE FUNCTION bm_propose_markup(p_audience text, p_scope text, p_client_id uuid, p_dsa_id uuid, p_markup numeric, p_company_wide boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid := nw_current_employee_id(); v_admin boolean := nw_current_emp_is_admin(); v_owner uuid; v_id uuid;
BEGIN
  IF v_emp IS NULL THEN RAISE EXCEPTION 'Staff only'; END IF;
  IF p_audience NOT IN ('client','partner') OR p_scope NOT IN ('group','individual') THEN RAISE EXCEPTION 'Bad audience/scope'; END IF;
  IF p_markup IS NULL OR p_markup < 0 OR p_markup > 100 THEN RAISE EXCEPTION 'Markup must be 0..100'; END IF;

  IF p_scope = 'individual' THEN
    IF p_audience = 'client' THEN
      IF p_client_id IS NULL THEN RAISE EXCEPTION 'client_id required'; END IF;
      IF NOT (v_admin OR EXISTS (SELECT 1 FROM nw_clients c WHERE c.id = p_client_id AND c.employee_id = v_emp)) THEN RAISE EXCEPTION 'Not your client'; END IF;
      SELECT c.employee_id INTO v_owner FROM nw_clients c WHERE c.id = p_client_id;
      UPDATE bm_price_markup SET status='superseded', updated_at=now()
        WHERE status IN ('pending','approved') AND audience='client' AND scope='individual' AND client_id = p_client_id;
    ELSE
      IF p_dsa_id IS NULL THEN RAISE EXCEPTION 'dsa_id required'; END IF;
      IF NOT (v_admin OR nw_emp_owns_dsa(p_dsa_id)) THEN RAISE EXCEPTION 'Not your partner'; END IF;
      SELECT d.employee_id INTO v_owner FROM nw_dsa d WHERE d.id = p_dsa_id;
      UPDATE bm_price_markup SET status='superseded', updated_at=now()
        WHERE status IN ('pending','approved') AND audience='partner' AND scope='individual' AND dsa_id = p_dsa_id;
    END IF;
  ELSE  -- group
    IF p_company_wide THEN
      IF NOT v_admin THEN RAISE EXCEPTION 'Company-wide group markup is admin-only'; END IF;
      v_owner := NULL;
      UPDATE bm_price_markup SET status='superseded', updated_at=now()
        WHERE status IN ('pending','approved') AND audience=p_audience AND scope='group' AND employee_id IS NULL;
    ELSE
      v_owner := v_emp;
      UPDATE bm_price_markup SET status='superseded', updated_at=now()
        WHERE status IN ('pending','approved') AND audience=p_audience AND scope='group' AND employee_id = v_emp;
    END IF;
  END IF;

  INSERT INTO bm_price_markup (audience, scope, client_id, dsa_id, employee_id, markup_percent, status, proposed_by)
  VALUES (p_audience, p_scope,
          CASE WHEN p_scope='individual' THEN p_client_id END,
          CASE WHEN p_scope='individual' THEN p_dsa_id END,
          v_owner, p_markup, 'pending', v_emp)
  RETURNING id INTO v_id;
  INSERT INTO bm_price_markup_events (markup_id, event_type, actor, actor_id)
  VALUES (v_id, 'proposed', CASE WHEN v_admin THEN 'admin' ELSE 'employee' END, v_emp);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION bm_approve_markup(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid := nw_current_employee_id();
BEGIN
  IF NOT nw_current_emp_is_admin() THEN RAISE EXCEPTION 'Only administrators can approve pricing.'; END IF;
  UPDATE bm_price_markup SET status='approved', approved_by=v_emp, approved_at=now(), updated_at=now()
    WHERE id = p_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Markup is not pending'; END IF;
  INSERT INTO bm_price_markup_events (markup_id, event_type, actor, actor_id) VALUES (p_id, 'approved', 'admin', v_emp);
END; $$;

CREATE OR REPLACE FUNCTION bm_reject_markup(p_id uuid, p_reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid := nw_current_employee_id();
BEGIN
  IF NOT nw_current_emp_is_admin() THEN RAISE EXCEPTION 'Only administrators can reject pricing.'; END IF;
  UPDATE bm_price_markup SET status='rejected', rejected_at=now(), rejection_reason=coalesce(p_reason,''), updated_at=now()
    WHERE id = p_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Markup is not pending'; END IF;
  INSERT INTO bm_price_markup_events (markup_id, event_type, actor, actor_id, note) VALUES (p_id, 'rejected', 'admin', v_emp, coalesce(p_reason,''));
END; $$;

REVOKE ALL ON FUNCTION nw_current_client_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION bm_resolve_markup(text,uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_client_bonds() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_partner_bonds() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_partner_set_bond_markup(numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION bm_propose_markup(text,text,uuid,uuid,numeric,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION bm_approve_markup(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION bm_reject_markup(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nw_current_client_id() TO authenticated;
GRANT EXECUTE ON FUNCTION bm_resolve_markup(text,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION nw_client_bonds() TO authenticated;
GRANT EXECUTE ON FUNCTION nw_partner_bonds() TO authenticated;
GRANT EXECUTE ON FUNCTION nw_partner_set_bond_markup(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION bm_propose_markup(text,text,uuid,uuid,numeric,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION bm_approve_markup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION bm_reject_markup(uuid,text) TO authenticated;
