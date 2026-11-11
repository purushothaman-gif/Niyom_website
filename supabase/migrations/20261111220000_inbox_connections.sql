/*
  # Email inbox connections (CASParser inbox import)

  A client connects their mailbox (Gmail / Outlook / Zoho) once, via OAuth, so
  CAS statements that CAMS, KFintech, CDSL or NSDL email them are pulled and
  imported automatically — no upload step at all.

  ## Why the vendor token never leaves the server

  `inbox_token` is a long-lived credential: CASParser's encrypted refresh token
  that grants ongoing read access to the client's mailbox. It must never reach a
  browser. So this table has RLS ENABLED WITH NO POLICY — the service role (the
  droplet proxy) is the only thing that can read or write it, and a client's
  connection status is served to the portal through the proxy, not by reading
  this table directly.

  ## The OAuth handshake

  `state` is the CSRF token we mint at connect time and that CASParser returns on
  the callback. The row starts 'pending' (state set, no token) and becomes
  'active' when the callback arrives and matches the state. That is how a browser
  redirect with no session is tied back to the right client.
*/

CREATE TABLE IF NOT EXISTS inbox_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES nw_clients(id) ON DELETE CASCADE,

  provider text NOT NULL DEFAULT 'gmail',            -- gmail | outlook | zoho
  status text NOT NULL DEFAULT 'pending',            -- pending | active | disconnected | error

  /* The CSRF/lookup token round-tripped through the OAuth callback. */
  state text,
  /* The connected mailbox address, learned on the callback. */
  email text,
  /* CASParser's encrypted refresh token. SERVICE ROLE ONLY — never to a client. */
  inbox_token text,

  connected_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_state ON inbox_connections(state) WHERE state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_client ON inbox_connections(client_id, created_at DESC);
/* At most one live connection per client — a reconnect replaces the old row. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_client_active
  ON inbox_connections(client_id) WHERE status = 'active';

ALTER TABLE inbox_connections ENABLE ROW LEVEL SECURITY;
/*
  No policy on purpose: only the service role (the proxy) touches this table.
  The portal learns its connection status from the proxy, which never returns
  the token. A browser session can neither read nor forge a connection.
*/
