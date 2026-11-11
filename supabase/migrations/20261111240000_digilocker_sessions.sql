/*
  # DigiLocker verification sessions (CASParser KYC DigiLocker)

  An ACTIVE consent flow (unlike the passive KRA PAN-status lookup): the client
  signs in to DigiLocker and shares their government documents, and we capture
  the verified identity (name, DOB, PAN, masked Aadhaar).

  ## Flow and why state round-trips

  An RM starts a session for a client; the client opens the authorization link,
  signs in to DigiLocker and consents; DigiLocker redirects to our callback with
  the session id and the `state` we minted. The callback has no app session, so
  `state` (and the vendor session id) is how the result is tied back to the
  right client. The row starts 'pending' and becomes 'verified' or 'failed'.

  ## Visibility

  The verified identity is sensitive, so RLS allows a client to read only their
  own row, and staff read through the proxy with the service role. Writes are
  service-role only — a browser can neither read another client's identity nor
  forge a verification.
*/

CREATE TABLE IF NOT EXISTS digilocker_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES nw_clients(id) ON DELETE CASCADE,

  session_id text,                                   -- CASParser's DigiLocker session id
  state text,                                        -- CSRF/lookup token round-tripped on the callback
  status text NOT NULL DEFAULT 'pending',            -- pending | verified | failed | expired

  /* Captured on success. */
  dl_name text,
  dl_dob date,
  dl_pan text,
  dl_aadhaar_masked text,
  /* True when the DigiLocker name matches the name on the client's record. */
  name_match boolean,
  result jsonb,                                      -- the full response, verbatim
  error text,

  verified_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dl_session ON digilocker_sessions(session_id) WHERE session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dl_state ON digilocker_sessions(state) WHERE state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dl_client ON digilocker_sessions(client_id, created_at DESC);

ALTER TABLE digilocker_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS digilocker_sessions_own_read ON digilocker_sessions;
CREATE POLICY digilocker_sessions_own_read ON digilocker_sessions FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM nw_clients WHERE client_auth_user_id = (select auth.uid())));
