-- Per-client / per-partner bond markup proposals (employee-proposed, admin-approved).
-- No default/fallback: a price is shown to a client/partner only when an APPROVED rate resolves.
CREATE TABLE IF NOT EXISTS bm_price_markup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience text NOT NULL CHECK (audience IN ('client','partner')),
  scope text NOT NULL CHECK (scope IN ('group','individual')),
  client_id uuid REFERENCES nw_clients(id) ON DELETE CASCADE,
  dsa_id uuid REFERENCES nw_dsa(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES nw_employees(id) ON DELETE SET NULL,   -- owning RM; NULL = company-wide group
  markup_percent numeric NOT NULL CHECK (markup_percent >= 0 AND markup_percent <= 100),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
  proposed_by uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bm_markup_shape CHECK (
    (scope='individual' AND (
        (audience='client'  AND client_id IS NOT NULL AND dsa_id IS NULL) OR
        (audience='partner' AND dsa_id   IS NOT NULL AND client_id IS NULL)))
    OR (scope='group' AND client_id IS NULL AND dsa_id IS NULL)
  )
);

-- At most ONE active (pending|approved) markup per target.
CREATE UNIQUE INDEX IF NOT EXISTS bm_markup_uq_client     ON bm_price_markup (client_id)             WHERE client_id IS NOT NULL AND status IN ('pending','approved');
CREATE UNIQUE INDEX IF NOT EXISTS bm_markup_uq_dsa        ON bm_price_markup (dsa_id)                WHERE dsa_id   IS NOT NULL AND status IN ('pending','approved');
CREATE UNIQUE INDEX IF NOT EXISTS bm_markup_uq_emp_group  ON bm_price_markup (audience, employee_id) WHERE scope='group' AND employee_id IS NOT NULL AND status IN ('pending','approved');
CREATE UNIQUE INDEX IF NOT EXISTS bm_markup_uq_comp_group ON bm_price_markup (audience)              WHERE scope='group' AND employee_id IS NULL AND status IN ('pending','approved');

-- Lock: an approved markup is immutable (change = a new proposal). Superseding is allowed.
CREATE OR REPLACE FUNCTION bm_lock_approved_markup() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' AND (NEW.markup_percent IS DISTINCT FROM OLD.markup_percent OR NEW.status = 'pending') THEN
    RAISE EXCEPTION 'Approved markup is locked; create a new proposal to change it.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS bm_price_markup_lock ON bm_price_markup;
CREATE TRIGGER bm_price_markup_lock BEFORE UPDATE ON bm_price_markup FOR EACH ROW EXECUTE FUNCTION bm_lock_approved_markup();

CREATE TABLE IF NOT EXISTS bm_price_markup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  markup_id uuid NOT NULL REFERENCES bm_price_markup(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('proposed','approved','rejected','superseded')),
  actor text NOT NULL CHECK (actor IN ('employee','admin','system')),
  actor_id uuid,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Partner self-markup (their own spread, hard-capped at 5%). Separate table so the
-- nw_dsa self-update guard is not involved.
CREATE TABLE IF NOT EXISTS bm_partner_self_markup (
  dsa_id uuid PRIMARY KEY REFERENCES nw_dsa(id) ON DELETE CASCADE,
  markup_percent numeric NOT NULL DEFAULT 0 CHECK (markup_percent >= 0 AND markup_percent <= 5),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bm_price_markup        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bm_price_markup_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bm_partner_self_markup ENABLE ROW LEVEL SECURITY;

-- Admin: full. RM: read rows they own. Writes go through SECURITY DEFINER RPCs (bypass RLS).
CREATE POLICY bm_markup_admin_all ON bm_price_markup FOR ALL TO authenticated
  USING (nw_current_emp_is_admin()) WITH CHECK (nw_current_emp_is_admin());
CREATE POLICY bm_markup_rm_read ON bm_price_markup FOR SELECT TO authenticated
  USING (
       (audience='client'  AND client_id IS NOT NULL AND EXISTS (SELECT 1 FROM nw_clients c WHERE c.id = client_id AND c.employee_id = (SELECT nw_current_employee_id())))
    OR (audience='partner' AND dsa_id   IS NOT NULL AND (SELECT nw_emp_owns_dsa(dsa_id)))
    OR (scope='group' AND employee_id = (SELECT nw_current_employee_id()))
  );

CREATE POLICY bm_markup_events_read ON bm_price_markup_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM bm_price_markup m WHERE m.id = markup_id));

CREATE POLICY bm_psm_admin_all ON bm_partner_self_markup FOR ALL TO authenticated
  USING (nw_current_emp_is_admin()) WITH CHECK (nw_current_emp_is_admin());
CREATE POLICY bm_psm_rm_read ON bm_partner_self_markup FOR SELECT TO authenticated
  USING ((SELECT nw_emp_owns_dsa(dsa_id)));
