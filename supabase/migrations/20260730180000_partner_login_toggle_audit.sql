/*
  # Partner login enable/disable — audited by construction

  ## Why
  20260730140000 gave nw_dsa_login_audit no INSERT policy on purpose: only the
  service role writes it, so nobody can forge audit rows (contrast
  nw_client_login_audit, whose INSERT policy is WITH CHECK (true)).

  That had an unintended consequence. Enabling a partner login goes through the
  create-partner-login edge function, which runs as the service role and audits
  itself. Disabling it was a plain client-side UPDATE from the CRM, which cannot
  write to the audit table — so ENABLING was recorded and DISABLING was not,
  which is backwards from what matters when access is disputed.

  A second problem surfaced in testing: after a disable, dsa_auth_user_id is
  still set, so create-partner-login correctly refuses with 409 "Partner login
  already exists" and the RM has no way to restore access from the UI.

  Both are fixed by routing the toggle through one SECURITY DEFINER RPC that
  writes the audit row in the same transaction as the flag.

  ## Objects
    nw_partner_set_login_enabled(uuid, boolean)  — the only sanctioned toggle
    nw_guard_dsa_login_toggle()                  — trigger enforcing that

  ## Security
    - The RPC re-checks the caller is an active employee who owns the DSA, or an
      admin: the same ownership rule create-partner-login applies.
    - It only flips access for a login that ALREADY exists. Issuing credentials
      still goes through the edge function, because only that path can create an
      auth user and set a password.
    - The guard trigger makes the audit structural rather than conventional: a
      direct UPDATE of dsa_login_enabled from a logged-in session is rejected,
      so the flag cannot move without a matching audit row. Service-role callers
      (auth.uid() IS NULL — i.e. create-partner-login, which audits itself) are
      exempt, as is any UPDATE that leaves the flag untouched.

  ## Safety
    Idempotent (CREATE OR REPLACE, DROP TRIGGER IF EXISTS). No DDL on tables, no
    data change. Existing rows and every other nw_dsa UPDATE path are unaffected.
*/

-- ---------------------------------------------------------------------------
-- 1. The sanctioned toggle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nw_partner_set_login_enabled(
  p_dsa_id  uuid,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_emp   uuid;
  v_admin boolean;
  v_dsa   nw_dsa%ROWTYPE;
BEGIN
  v_emp   := nw_current_employee_id();
  v_admin := nw_current_emp_is_admin();

  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'Employee access required';
  END IF;

  SELECT * INTO v_dsa FROM nw_dsa WHERE id = p_dsa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner not found';
  END IF;

  -- Same ownership rule as create-partner-login.
  IF NOT v_admin AND v_dsa.employee_id IS DISTINCT FROM v_emp THEN
    RAISE EXCEPTION 'You can only manage your own partners.';
  END IF;

  IF p_enabled THEN
    -- There must be a login to restore. Provisioning goes through the edge
    -- function, which is the only path that can issue a password.
    IF v_dsa.dsa_auth_user_id IS NULL THEN
      RAISE EXCEPTION 'This partner has no login yet. Use Enable Partner Login to issue credentials.';
    END IF;
    -- nw_current_dsa_id() also requires status = 'active', so restoring access
    -- on an inactive DSA would silently do nothing.
    IF v_dsa.status <> 'active' THEN
      RAISE EXCEPTION 'Reactivate the DSA before restoring portal access.';
    END IF;
  END IF;

  -- No-op guard: a double-click must not write a second audit row.
  IF v_dsa.dsa_login_enabled = p_enabled THEN
    RETURN;
  END IF;

  -- Tell the guard trigger this change came through the sanctioned path. Scoped
  -- to the row and local to the transaction.
  PERFORM set_config('nw.partner_login_toggle', p_dsa_id::text, true);

  UPDATE nw_dsa
     SET dsa_login_enabled = p_enabled,
         updated_at        = now()
   WHERE id = p_dsa_id;

  INSERT INTO nw_dsa_login_audit (dsa_id, action, actor, metadata)
  VALUES (
    p_dsa_id,
    CASE WHEN p_enabled THEN 'login_enabled' ELSE 'login_disabled' END,
    'employee',
    jsonb_build_object('by_employee_id', v_emp, 'via', 'crm_toggle')
  );

  PERFORM set_config('nw.partner_login_toggle', '', true);
END $fn$;

REVOKE ALL ON FUNCTION nw_partner_set_login_enabled(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nw_partner_set_login_enabled(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Make the audit structural: the flag cannot move any other way.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION nw_guard_dsa_login_toggle()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  -- Only interested in changes to the access flag itself.
  IF NEW.dsa_login_enabled IS NOT DISTINCT FROM OLD.dsa_login_enabled THEN
    RETURN NEW;
  END IF;

  -- Service-role callers (create-partner-login) have no auth.uid() and write
  -- their own audit row.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF current_setting('nw.partner_login_toggle', true) IS DISTINCT FROM OLD.id::text THEN
    RAISE EXCEPTION
      'Partner portal access must be changed via nw_partner_set_login_enabled() so it is audited.';
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_nw_guard_dsa_login_toggle ON nw_dsa;
CREATE TRIGGER trg_nw_guard_dsa_login_toggle
  BEFORE UPDATE ON nw_dsa
  FOR EACH ROW EXECUTE FUNCTION nw_guard_dsa_login_toggle();
