/*
  # Unlisted Shares — markups, approvals and the client/partner projections

  A straight mirror of the bond pricing model (20260828120000 / 20260828120100),
  in the us_* namespace:

    employee proposes a % → admin approves → the client or partner sees
    base × (1 + %) and NOTHING ELSE. No default, no fallback: if no approved
    rate resolves, the list is empty rather than priced at cost.

  Why a SEPARATE markup table rather than reusing bm_price_markup: the spread a
  desk takes on unlisted equity has no relationship to the spread it takes on a
  bond, and one shared row would have silently repriced both products the moment
  either was changed. The resolution ORDER is identical, so anyone who knows the
  bond flow already knows this one.

  Partner spread is capped at 5%, same as bonds, enforced here and again at
  every server-side re-derivation.
*/

-- ---------------------------------------------------------------------------
-- Employee-proposed / admin-approved markups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS us_price_markup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience text NOT NULL CHECK (audience IN ('client','partner')),
  scope text NOT NULL CHECK (scope IN ('group','individual')),
  client_id uuid REFERENCES nw_clients(id) ON DELETE CASCADE,
  dsa_id uuid REFERENCES nw_dsa(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES nw_employees(id) ON DELETE SET NULL,   -- owning RM; NULL = company-wide
  markup_percent numeric NOT NULL CHECK (markup_percent >= 0 AND markup_percent <= 100),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
  proposed_by uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT us_markup_shape CHECK (
    (scope='individual' AND (
        (audience='client'  AND client_id IS NOT NULL AND dsa_id IS NULL) OR
        (audience='partner' AND dsa_id   IS NOT NULL AND client_id IS NULL)))
    OR (scope='group' AND client_id IS NULL AND dsa_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS us_markup_uq_client     ON us_price_markup (client_id)             WHERE client_id IS NOT NULL AND status IN ('pending','approved');
CREATE UNIQUE INDEX IF NOT EXISTS us_markup_uq_dsa        ON us_price_markup (dsa_id)                WHERE dsa_id   IS NOT NULL AND status IN ('pending','approved');
CREATE UNIQUE INDEX IF NOT EXISTS us_markup_uq_emp_group  ON us_price_markup (audience, employee_id) WHERE scope='group' AND employee_id IS NOT NULL AND status IN ('pending','approved');
CREATE UNIQUE INDEX IF NOT EXISTS us_markup_uq_comp_group ON us_price_markup (audience)              WHERE scope='group' AND employee_id IS NULL AND status IN ('pending','approved');

CREATE OR REPLACE FUNCTION us_lock_approved_markup() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' AND (NEW.markup_percent IS DISTINCT FROM OLD.markup_percent OR NEW.status = 'pending') THEN
    RAISE EXCEPTION 'Approved markup is locked; create a new proposal to change it.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS us_price_markup_lock ON us_price_markup;
CREATE TRIGGER us_price_markup_lock BEFORE UPDATE ON us_price_markup
  FOR EACH ROW EXECUTE FUNCTION us_lock_approved_markup();

CREATE TABLE IF NOT EXISTS us_price_markup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  markup_id uuid NOT NULL REFERENCES us_price_markup(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('proposed','approved','rejected','superseded')),
  actor text NOT NULL CHECK (actor IN ('employee','admin','system')),
  actor_id uuid,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The partner's own spread on top of their cost. Separate table so the
-- nw_dsa self-update guard is not involved.
CREATE TABLE IF NOT EXISTS us_partner_self_markup (
  dsa_id uuid PRIMARY KEY REFERENCES nw_dsa(id) ON DELETE CASCADE,
  markup_percent numeric NOT NULL DEFAULT 0 CHECK (markup_percent >= 0 AND markup_percent <= 5),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE us_price_markup        ENABLE ROW LEVEL SECURITY;
ALTER TABLE us_price_markup_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE us_partner_self_markup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS us_markup_admin_all ON us_price_markup;
CREATE POLICY us_markup_admin_all ON us_price_markup FOR ALL TO authenticated
  USING (nw_current_emp_is_admin()) WITH CHECK (nw_current_emp_is_admin());

DROP POLICY IF EXISTS us_markup_rm_read ON us_price_markup;
CREATE POLICY us_markup_rm_read ON us_price_markup FOR SELECT TO authenticated
  USING (
       (audience='client'  AND client_id IS NOT NULL AND EXISTS (SELECT 1 FROM nw_clients c WHERE c.id = client_id AND c.employee_id = (SELECT nw_current_employee_id())))
    OR (audience='partner' AND dsa_id   IS NOT NULL AND (SELECT nw_emp_owns_dsa(dsa_id)))
    OR (scope='group' AND employee_id = (SELECT nw_current_employee_id()))
  );

DROP POLICY IF EXISTS us_markup_events_read ON us_price_markup_events;
CREATE POLICY us_markup_events_read ON us_price_markup_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM us_price_markup m WHERE m.id = markup_id));

DROP POLICY IF EXISTS us_psm_admin_all ON us_partner_self_markup;
CREATE POLICY us_psm_admin_all ON us_partner_self_markup FOR ALL TO authenticated
  USING (nw_current_emp_is_admin()) WITH CHECK (nw_current_emp_is_admin());

DROP POLICY IF EXISTS us_psm_rm_read ON us_partner_self_markup;
CREATE POLICY us_psm_rm_read ON us_partner_self_markup FOR SELECT TO authenticated
  USING ((SELECT nw_emp_owns_dsa(dsa_id)));

-- ---------------------------------------------------------------------------
-- Resolution: individual override -> RM group -> company-wide group -> NULL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION us_resolve_markup(p_audience text, p_client_id uuid, p_dsa_id uuid, p_employee_id uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m numeric;
BEGIN
  IF p_audience = 'client' AND p_client_id IS NOT NULL THEN
    SELECT markup_percent INTO m FROM us_price_markup
     WHERE status='approved' AND audience='client' AND scope='individual' AND client_id = p_client_id LIMIT 1;
    IF m IS NOT NULL THEN RETURN m; END IF;
  ELSIF p_audience = 'partner' AND p_dsa_id IS NOT NULL THEN
    SELECT markup_percent INTO m FROM us_price_markup
     WHERE status='approved' AND audience='partner' AND scope='individual' AND dsa_id = p_dsa_id LIMIT 1;
    IF m IS NOT NULL THEN RETURN m; END IF;
  END IF;
  IF p_employee_id IS NOT NULL THEN
    SELECT markup_percent INTO m FROM us_price_markup
     WHERE status='approved' AND audience=p_audience AND scope='group' AND employee_id = p_employee_id LIMIT 1;
    IF m IS NOT NULL THEN RETURN m; END IF;
  END IF;
  SELECT markup_percent INTO m FROM us_price_markup
   WHERE status='approved' AND audience=p_audience AND scope='group' AND employee_id IS NULL LIMIT 1;
  RETURN m;   -- NULL when nothing approved applies
END; $$;

-- ---------------------------------------------------------------------------
-- Client projection. Marked-up price per share + safe factual fields only.
-- latest_price / price_date / the markup itself never appear here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nw_client_unlisted_shares()
RETURNS TABLE (id uuid, isin text, company_name text, short_name text, sector text, about text,
  logo_url text, website text, face_value numeric, lot_size integer, min_qty integer,
  client_price numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid := nw_current_client_id(); v_emp uuid; v_m numeric;
BEGIN
  IF v_client IS NULL THEN RAISE EXCEPTION 'Client access required'; END IF;
  SELECT c.employee_id INTO v_emp FROM nw_clients c WHERE c.id = v_client;
  v_m := us_resolve_markup('client', v_client, NULL, v_emp);
  IF v_m IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT s.id, s.isin, s.company_name, s.short_name, s.sector, s.about,
           s.logo_url, s.website, s.face_value, s.lot_size, s.min_qty,
           round(s.latest_price * (1 + v_m/100), 2)
    FROM us_shares s
    WHERE s.active_status='active' AND s.latest_price IS NOT NULL
    ORDER BY s.display_order, s.company_name;
END; $$;

CREATE OR REPLACE FUNCTION nw_client_unlisted_share(p_id uuid)
RETURNS TABLE (id uuid, isin text, company_name text, short_name text, sector text, about text,
  logo_url text, website text, face_value numeric, lot_size integer, min_qty integer,
  client_price numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid := nw_current_client_id(); v_emp uuid; v_m numeric;
BEGIN
  IF v_client IS NULL THEN RAISE EXCEPTION 'Client access required'; END IF;
  SELECT c.employee_id INTO v_emp FROM nw_clients c WHERE c.id = v_client;
  v_m := us_resolve_markup('client', v_client, NULL, v_emp);
  IF v_m IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT s.id, s.isin, s.company_name, s.short_name, s.sector, s.about,
           s.logo_url, s.website, s.face_value, s.lot_size, s.min_qty,
           round(s.latest_price * (1 + v_m/100), 2)
    FROM us_shares s
    WHERE s.id = p_id AND s.active_status='active' AND s.latest_price IS NOT NULL;
END; $$;

-- ---------------------------------------------------------------------------
-- Partner projection. partner_base is the partner's COST (the RM-set, admin-
-- approved price); partner_price adds the partner's own <=5% spread.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nw_partner_unlisted_shares()
RETURNS TABLE (id uuid, isin text, company_name text, short_name text, sector text, about text,
  logo_url text, website text, face_value numeric, lot_size integer, min_qty integer,
  partner_base numeric, self_markup_percent numeric, partner_price numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dsa uuid := nw_current_dsa_id(); v_emp uuid; v_m numeric; v_self numeric;
BEGIN
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;
  SELECT d.employee_id INTO v_emp FROM nw_dsa d WHERE d.id = v_dsa;
  SELECT coalesce(x.markup_percent, 0) INTO v_self FROM us_partner_self_markup x WHERE x.dsa_id = v_dsa;
  v_self := coalesce(v_self, 0);
  v_m := us_resolve_markup('partner', NULL, v_dsa, v_emp);
  IF v_m IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT s.id, s.isin, s.company_name, s.short_name, s.sector, s.about,
           s.logo_url, s.website, s.face_value, s.lot_size, s.min_qty,
           round(s.latest_price * (1 + v_m/100), 2),
           v_self,
           round(round(s.latest_price * (1 + v_m/100), 2) * (1 + v_self/100), 2)
    FROM us_shares s
    WHERE s.active_status='active' AND s.latest_price IS NOT NULL
    ORDER BY s.display_order, s.company_name;
END; $$;

CREATE OR REPLACE FUNCTION nw_partner_unlisted_share(p_id uuid)
RETURNS TABLE (id uuid, isin text, company_name text, short_name text, sector text, about text,
  logo_url text, website text, face_value numeric, lot_size integer, min_qty integer,
  partner_base numeric, self_markup_percent numeric, partner_price numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dsa uuid := nw_current_dsa_id(); v_emp uuid; v_m numeric; v_self numeric;
BEGIN
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;
  SELECT d.employee_id INTO v_emp FROM nw_dsa d WHERE d.id = v_dsa;
  SELECT coalesce(x.markup_percent, 0) INTO v_self FROM us_partner_self_markup x WHERE x.dsa_id = v_dsa;
  v_self := coalesce(v_self, 0);
  v_m := us_resolve_markup('partner', NULL, v_dsa, v_emp);
  IF v_m IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT s.id, s.isin, s.company_name, s.short_name, s.sector, s.about,
           s.logo_url, s.website, s.face_value, s.lot_size, s.min_qty,
           round(s.latest_price * (1 + v_m/100), 2),
           v_self,
           round(round(s.latest_price * (1 + v_m/100), 2) * (1 + v_self/100), 2)
    FROM us_shares s
    WHERE s.id = p_id AND s.active_status='active' AND s.latest_price IS NOT NULL;
END; $$;

-- Partner sets their own spread (0..5%). No approval; hard cap enforced.
CREATE OR REPLACE FUNCTION nw_partner_set_share_markup(p_percent numeric)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dsa uuid := nw_current_dsa_id();
BEGIN
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;
  IF p_percent IS NULL OR p_percent < 0 OR p_percent > 5 THEN
    RAISE EXCEPTION 'Your markup must be between 0%% and 5%%.';
  END IF;
  INSERT INTO us_partner_self_markup (dsa_id, markup_percent, updated_at)
  VALUES (v_dsa, p_percent, now())
  ON CONFLICT (dsa_id) DO UPDATE SET markup_percent = EXCLUDED.markup_percent, updated_at = now();
  RETURN p_percent;
END; $$;

-- ---------------------------------------------------------------------------
-- Propose / approve / reject
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION us_propose_markup(p_audience text, p_scope text, p_client_id uuid, p_dsa_id uuid, p_markup numeric, p_company_wide boolean DEFAULT false)
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
      UPDATE us_price_markup SET status='superseded', updated_at=now()
        WHERE status IN ('pending','approved') AND audience='client' AND scope='individual' AND client_id = p_client_id;
    ELSE
      IF p_dsa_id IS NULL THEN RAISE EXCEPTION 'dsa_id required'; END IF;
      IF NOT (v_admin OR nw_emp_owns_dsa(p_dsa_id)) THEN RAISE EXCEPTION 'Not your partner'; END IF;
      SELECT d.employee_id INTO v_owner FROM nw_dsa d WHERE d.id = p_dsa_id;
      UPDATE us_price_markup SET status='superseded', updated_at=now()
        WHERE status IN ('pending','approved') AND audience='partner' AND scope='individual' AND dsa_id = p_dsa_id;
    END IF;
  ELSE
    IF p_company_wide THEN
      IF NOT v_admin THEN RAISE EXCEPTION 'Company-wide group markup is admin-only'; END IF;
      v_owner := NULL;
      UPDATE us_price_markup SET status='superseded', updated_at=now()
        WHERE status IN ('pending','approved') AND audience=p_audience AND scope='group' AND employee_id IS NULL;
    ELSE
      v_owner := v_emp;
      UPDATE us_price_markup SET status='superseded', updated_at=now()
        WHERE status IN ('pending','approved') AND audience=p_audience AND scope='group' AND employee_id = v_emp;
    END IF;
  END IF;

  INSERT INTO us_price_markup (audience, scope, client_id, dsa_id, employee_id, markup_percent, status, proposed_by)
  VALUES (p_audience, p_scope,
          CASE WHEN p_scope='individual' THEN p_client_id END,
          CASE WHEN p_scope='individual' THEN p_dsa_id END,
          v_owner, p_markup, 'pending', v_emp)
  RETURNING id INTO v_id;
  INSERT INTO us_price_markup_events (markup_id, event_type, actor, actor_id)
  VALUES (v_id, 'proposed', CASE WHEN v_admin THEN 'admin' ELSE 'employee' END, v_emp);
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION us_approve_markup(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid := nw_current_employee_id();
BEGIN
  IF NOT nw_current_emp_is_admin() THEN RAISE EXCEPTION 'Only administrators can approve pricing.'; END IF;
  UPDATE us_price_markup SET status='approved', approved_by=v_emp, approved_at=now(), updated_at=now()
    WHERE id = p_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Markup is not pending'; END IF;
  INSERT INTO us_price_markup_events (markup_id, event_type, actor, actor_id) VALUES (p_id, 'approved', 'admin', v_emp);
END; $$;

CREATE OR REPLACE FUNCTION us_reject_markup(p_id uuid, p_reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_emp uuid := nw_current_employee_id();
BEGIN
  IF NOT nw_current_emp_is_admin() THEN RAISE EXCEPTION 'Only administrators can reject pricing.'; END IF;
  UPDATE us_price_markup SET status='rejected', rejected_at=now(), rejection_reason=coalesce(p_reason,''), updated_at=now()
    WHERE id = p_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Markup is not pending'; END IF;
  INSERT INTO us_price_markup_events (markup_id, event_type, actor, actor_id, note) VALUES (p_id, 'rejected', 'admin', v_emp, coalesce(p_reason,''));
END; $$;

REVOKE ALL ON FUNCTION us_resolve_markup(text,uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_client_unlisted_shares() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_client_unlisted_share(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_partner_unlisted_shares() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_partner_unlisted_share(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_partner_set_share_markup(numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION us_propose_markup(text,text,uuid,uuid,numeric,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION us_approve_markup(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION us_reject_markup(uuid,text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION us_resolve_markup(text,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION nw_client_unlisted_shares() TO authenticated;
GRANT EXECUTE ON FUNCTION nw_client_unlisted_share(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION nw_partner_unlisted_shares() TO authenticated;
GRANT EXECUTE ON FUNCTION nw_partner_unlisted_share(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION nw_partner_set_share_markup(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION us_propose_markup(text,text,uuid,uuid,numeric,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION us_approve_markup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION us_reject_markup(uuid,text) TO authenticated;
