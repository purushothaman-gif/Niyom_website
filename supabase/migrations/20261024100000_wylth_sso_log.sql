-- Wylth investor SSO — audit log of every login-link request.
--
-- The wylth-sso-login edge function writes one row per attempt with the
-- service role. By Wylth's security guidelines the PAN, the encrypted payload
-- and the returned redirect_url are credentials: none of them is stored here.
-- The (client_id, created_at) index also backs the "alert the RM at most once
-- per 24h when the client isn't mapped at Wylth" dedupe.

CREATE TABLE IF NOT EXISTS nw_wylth_sso_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  caller_type text NOT NULL CHECK (caller_type IN ('client', 'partner', 'employee')),
  caller_auth_id uuid,
  client_id uuid REFERENCES nw_clients(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('ok', 'not_mapped', 'kyc_incomplete', 'not_available', 'error')),
  wylth_message text,
  latency_ms integer
);
CREATE INDEX IF NOT EXISTS nw_wylth_sso_log_client_idx ON nw_wylth_sso_log (client_id, created_at DESC);

ALTER TABLE nw_wylth_sso_log ENABLE ROW LEVEL SECURITY;

-- Admins may read it from the CRM; nobody writes except the service role.
-- REVOKE FROM PUBLIC/anon alone does not touch `authenticated`, so name it.
REVOKE ALL ON nw_wylth_sso_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON nw_wylth_sso_log TO authenticated;

DROP POLICY IF EXISTS nw_wylth_sso_log_admin_read ON nw_wylth_sso_log;
CREATE POLICY nw_wylth_sso_log_admin_read ON nw_wylth_sso_log FOR SELECT TO authenticated
  USING ((SELECT nw_current_emp_is_admin()));
