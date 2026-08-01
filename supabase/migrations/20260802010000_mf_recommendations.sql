/*
  # Niyom fund recommendations

  The client portal's Mutual Funds tab now opens on a discovery page rather than
  a flat scheme list. Everything else on that page is objective — trailing
  returns, categories, NAV, all computed from AMFI data — but a "Recommended by
  Niyom" shelf is an opinion, and an opinion shown to clients has to come from
  the people licensed to hold it, not from a rule I invented in code.

  So the shelf is table-driven and starts EMPTY: the portal hides the section
  until staff add a pick in MF Admin → Funds → Recommendations. No seed rows —
  seeding this would amount to the deployment picking funds for real clients.

  `amfi_code` is `mutual_funds.fund_code` (the AMFI scheme code). It is not a
  foreign key: `mutual_funds` is a curated cache that a refresh can rewrite, and
  a recommendation must not vanish because a refresh dropped a row. `fund_name`
  is snapshotted for the same reason — the pick stays legible even if the
  catalog row is gone.
*/

CREATE TABLE IF NOT EXISTS nw_mf_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* AMFI scheme code — joins to mutual_funds.fund_code for live returns/NAV. */
  amfi_code text NOT NULL UNIQUE,
  fund_name text NOT NULL,
  /* Short label on the card, e.g. "Core equity holding". */
  headline text,
  /* One line of why, in the client's language. Shown verbatim. */
  rationale text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE nw_mf_recommendations IS
  'Staff-curated fund picks shown as "Recommended by Niyom" in the client portal. Empty by default.';

CREATE INDEX IF NOT EXISTS idx_nw_mf_recommendations_active
  ON nw_mf_recommendations(is_active, sort_order);

ALTER TABLE nw_mf_recommendations ENABLE ROW LEVEL SECURITY;

/*
  Clients read the live shelf; staff who maintain it also need to see the picks
  they have parked. Both are the same SELECT, split on is_active.
  auth.uid() is wrapped in a scalar sub-select so it is evaluated once per query
  rather than once per row (the initplan fix applied across nw_* in Jul-2026).
*/
DROP POLICY IF EXISTS nw_mf_recos_read ON nw_mf_recommendations;
CREATE POLICY nw_mf_recos_read ON nw_mf_recommendations
  FOR SELECT TO authenticated
  USING (
    is_active
    OR EXISTS (
      SELECT 1 FROM nw_employees e
      WHERE e.auth_user_id = (SELECT auth.uid())
        AND e.status = 'active'
    )
  );

/*
  Writing is advice. Restricted to admins rather than every active employee for
  the same reason the shelf exists at all — one voice, accountable.
*/
DROP POLICY IF EXISTS nw_mf_recos_admin_write ON nw_mf_recommendations;
CREATE POLICY nw_mf_recos_admin_write ON nw_mf_recommendations
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nw_employees e
      WHERE e.auth_user_id = (SELECT auth.uid())
        AND e.status = 'active'
        AND e.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM nw_employees e
      WHERE e.auth_user_id = (SELECT auth.uid())
        AND e.status = 'active'
        AND e.role IN ('admin', 'super_admin')
    )
  );

/* Keep updated_at honest without asking every caller to remember it. */
CREATE OR REPLACE FUNCTION nw_mf_recommendations_touch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nw_mf_recommendations_touch ON nw_mf_recommendations;
CREATE TRIGGER trg_nw_mf_recommendations_touch
  BEFORE UPDATE ON nw_mf_recommendations
  FOR EACH ROW EXECUTE FUNCTION nw_mf_recommendations_touch();
