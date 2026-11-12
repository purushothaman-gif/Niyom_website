/*
  # DigiLocker at public signup

  Until now a DigiLocker session always belonged to an existing client (an RM
  started it, or the client did from the KYC wizard). Website signup verified
  the PAN with a Cashfree lookup instead, which proves the PAN exists but not
  that the visitor owns it.

  Signup can now start with DigiLocker, before any client row exists:

    - `client_id` becomes nullable. A signup session has no client until
      public-onboard-start creates one and links it.
    - `flow` says which kind of session a row is ('client' | 'signup').
    - `signup_token_hash` is the SHA-256 of a secret held only by the visitor's
      browser. It is how the anonymous visitor reads their own result and how
      public-onboard-start finds the verified identity — the PAN and name are
      taken from this row, never from the request.
    - `expires_at` bounds how long a verified signup session may be redeemed;
      `consumed_at` makes it single-use.
    - `ip` is the per-IP throttle key (each session costs a vendor credit).
    - `return_origin` is where the callback sends the browser back to.

  ## Visibility

  Unchanged: the own-read policy matches on client_id, so a signup row
  (client_id NULL) is invisible to every browser session; only the service
  role reads or writes it. Additive only — nothing existing changes meaning.
*/

ALTER TABLE digilocker_sessions ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE digilocker_sessions
  ADD COLUMN IF NOT EXISTS flow text NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS signup_token_hash text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ip text,
  ADD COLUMN IF NOT EXISTS return_origin text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'digilocker_sessions_flow_check') THEN
    ALTER TABLE digilocker_sessions
      ADD CONSTRAINT digilocker_sessions_flow_check CHECK (flow IN ('client', 'signup'));
  END IF;
  -- A session without a client is only ever a signup session.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'digilocker_sessions_client_or_signup') THEN
    ALTER TABLE digilocker_sessions
      ADD CONSTRAINT digilocker_sessions_client_or_signup CHECK (client_id IS NOT NULL OR flow = 'signup');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dl_signup_token
  ON digilocker_sessions(signup_token_hash) WHERE signup_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dl_signup_throttle
  ON digilocker_sessions(created_at DESC) WHERE flow = 'signup';
