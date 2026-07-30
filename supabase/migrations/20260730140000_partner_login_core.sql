/*
  # Partner Login — core auth columns, identity helper and guards

  ## Purpose
  Gives DSAs (distribution partners) their own login, mirroring the client-portal
  blueprint. A partner authenticates as a normal Supabase `authenticated` user;
  everything that scopes them to their own data hangs off nw_current_dsa_id().

  Prerequisite: 20260730130000_dsa_policy_hygiene.sql MUST be applied first. It
  closes the dsa_debit_note_lines write hole and the blanket crm-documents upload
  policy, both of which a partner JWT would otherwise inherit.

  ## Tables
    nw_dsa                — 4 new columns + 2 indexes (mirrors the nw_clients trio)
    nw_dsa_login_audit    — NEW; service-role writes only

  ## Functions
    nw_current_dsa_id()               — SECURITY DEFINER identity helper
    nw_guard_dsa_self_update()        — trigger fn, blocks partner self-edits
    nw_partner_mark_password_changed() — the ONLY sanctioned partner write

  ## Security
    - Partners get NO UPDATE policy on nw_dsa at all. The guard trigger is
      defence in depth against a future policy being added carelessly.
    - nw_current_dsa_id() embeds the enabled + active checks, so disabling a
      partner (or deactivating the DSA) is an instant kill-switch — it takes
      effect on the partner's very next query, without waiting for JWT expiry.
    - nw_dsa_login_audit deliberately has NO INSERT policy. Contrast
      nw_client_login_audit, whose INSERT policy is WITH CHECK (true) and
      therefore lets any authenticated user forge audit rows. Do not copy that.
    - Every helper call in a policy is written as (SELECT fn()) so it is
      evaluated once per query (InitPlan) rather than once per row. The
      20260727130000 rewriter only wraps bare auth.* calls, so a bare
      nw_current_dsa_id() would NOT be caught by it.

  ## Safety
    Idempotent: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
    CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS.
    Purely additive — no existing column, row, policy or function is altered.
    All new nw_dsa columns default to a disabled state, so applying this
    migration grants nobody any new access until an RM explicitly enables a
    partner login.
*/

-- ---------------------------------------------------------------------------
-- 1. nw_dsa auth columns. Naming mirrors the nw_clients trio exactly
--    (client_auth_user_id / client_login_enabled / client_password_changed).
-- ---------------------------------------------------------------------------
ALTER TABLE nw_dsa
  ADD COLUMN IF NOT EXISTS dsa_auth_user_id     uuid        NULL,
  ADD COLUMN IF NOT EXISTS dsa_login_enabled    boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dsa_password_changed boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dsa_last_login_at    timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_nw_dsa_auth_user_id
  ON nw_dsa (dsa_auth_user_id) WHERE dsa_auth_user_id IS NOT NULL;

-- PAN is the login identifier, so it must be unambiguous among login-enabled
-- partners. Partial + upper() so it never blocks legacy rows or casing drift.
-- (nw_dsa.pan has no unique index of its own; all 10 live rows are distinct.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_nw_dsa_pan_login_unique
  ON nw_dsa (upper(pan)) WHERE dsa_login_enabled;

-- ---------------------------------------------------------------------------
-- 2. Audit trail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nw_dsa_login_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dsa_id     uuid REFERENCES nw_dsa(id) ON DELETE CASCADE,
  action     text NOT NULL,   -- login_success | login_failed | password_changed
                              -- | login_enabled | login_disabled | password_reset
  actor      text NOT NULL DEFAULT 'dsa' CHECK (actor IN ('dsa','employee','system')),
  metadata   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nw_dsa_login_audit_dsa
  ON nw_dsa_login_audit (dsa_id, created_at DESC);

ALTER TABLE nw_dsa_login_audit ENABLE ROW LEVEL SECURITY;

-- Read: the owning RM or an admin. No INSERT/UPDATE/DELETE policy exists, so
-- only the service role (edge functions) can write, and nobody can rewrite it.
DROP POLICY IF EXISTS "Employees read partner login audit" ON nw_dsa_login_audit;
CREATE POLICY "Employees read partner login audit"
  ON nw_dsa_login_audit FOR SELECT TO authenticated
  USING (nw_emp_owns_dsa(dsa_id) OR (SELECT nw_current_emp_is_admin()));

-- ---------------------------------------------------------------------------
-- 3. Identity helper — the single definition of "who is the current partner".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nw_current_dsa_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id
  FROM nw_dsa d
  WHERE d.dsa_auth_user_id = (SELECT auth.uid())
    AND d.dsa_login_enabled
    AND d.status = 'active'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION nw_current_dsa_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nw_current_dsa_id() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Guard trigger — a partner may never edit their own DSA record.
--    Field-diff (not a blanket raise) so the sanctioned password-changed RPC
--    below still works. bank_account / bank_ifsc are what payouts are wired to;
--    self-service editing of payment instructions by the party receiving the
--    payment is a fraud vector, which is why partners get no UPDATE path.
--    Employees and service-role callers (auth.uid() IS NULL) are unaffected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nw_guard_dsa_self_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND OLD.dsa_auth_user_id IS NOT NULL
     AND auth.uid() = OLD.dsa_auth_user_id
     AND (
          NEW.dsa_code            IS DISTINCT FROM OLD.dsa_code
       OR NEW.employee_id         IS DISTINCT FROM OLD.employee_id
       OR NEW.pan                 IS DISTINCT FROM OLD.pan
       OR NEW.email               IS DISTINCT FROM OLD.email
       OR NEW.mobile              IS DISTINCT FROM OLD.mobile
       OR NEW.full_name           IS DISTINCT FROM OLD.full_name
       OR NEW.address             IS DISTINCT FROM OLD.address
       OR NEW.bank_name           IS DISTINCT FROM OLD.bank_name
       OR NEW.bank_account        IS DISTINCT FROM OLD.bank_account
       OR NEW.bank_ifsc           IS DISTINCT FROM OLD.bank_ifsc
       OR NEW.status              IS DISTINCT FROM OLD.status
       OR NEW.notes               IS DISTINCT FROM OLD.notes
       OR NEW.dsa_login_enabled   IS DISTINCT FROM OLD.dsa_login_enabled
       OR NEW.dsa_auth_user_id    IS DISTINCT FROM OLD.dsa_auth_user_id
     )
  THEN
    RAISE EXCEPTION 'Partners may not modify their own DSA record.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nw_guard_dsa_self_update ON nw_dsa;
CREATE TRIGGER trg_nw_guard_dsa_self_update
  BEFORE UPDATE ON nw_dsa
  FOR EACH ROW EXECUTE FUNCTION nw_guard_dsa_self_update();

-- ---------------------------------------------------------------------------
-- 5. The one write a partner is allowed to make: clearing the forced
--    password-change flag after they have set their own password.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nw_partner_mark_password_changed()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dsa uuid;
BEGIN
  v_dsa := nw_current_dsa_id();
  IF v_dsa IS NULL THEN
    RAISE EXCEPTION 'Partner access required';
  END IF;

  UPDATE nw_dsa
     SET dsa_password_changed = true,
         updated_at           = now()
   WHERE id = v_dsa;

  INSERT INTO nw_dsa_login_audit (dsa_id, action, actor)
  VALUES (v_dsa, 'password_changed', 'dsa');
END;
$$;
REVOKE ALL ON FUNCTION nw_partner_mark_password_changed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nw_partner_mark_password_changed() TO authenticated;
