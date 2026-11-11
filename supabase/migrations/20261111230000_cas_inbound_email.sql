/*
  # Inbound email addresses (CASParser forward-to import)

  Each client gets a dedicated address (ie_xxx@import.casparser.in) to FORWARD
  their CAS statements to. CASParser validates the sender, stores the PDF, and
  webhooks us; we then pull the authoritative file list with our own key and
  import the demat ones. No OAuth, no provider consent screen — the lighter
  return-path, which also avoids showing CASParser's name on a Google consent.

  ## Security note

  CASParser does not sign its webhook. So the webhook POST is treated only as a
  TRIGGER: we never parse a URL from the POST body. We look the row up by the
  inbound_email_id it names and re-fetch the file list from CASParser with our
  API key (`last_cursor` makes that incremental and idempotent). A forged POST
  can at worst trigger a re-pull of the client's own already-stored files.

  ## Visibility

  The address is the client's own and not sensitive (it is what they forward
  to), so RLS allows a client to read their own row. Writes are service-role
  only — the webhook and the ensure route run on the droplet.
*/

CREATE TABLE IF NOT EXISTS cas_inbound_email (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES nw_clients(id) ON DELETE CASCADE,

  inbound_email_id text,                              -- CASParser's ie_… id
  address text,                                       -- ie_…@import.casparser.in
  reference text,
  status text NOT NULL DEFAULT 'active',              -- active | disabled

  last_received_at timestamptz,
  last_cursor text,                                   -- GET …/files `since` cursor
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_vendor ON cas_inbound_email(inbound_email_id) WHERE inbound_email_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_client_active ON cas_inbound_email(client_id) WHERE status = 'active';

ALTER TABLE cas_inbound_email ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cas_inbound_email_own_read ON cas_inbound_email;
CREATE POLICY cas_inbound_email_own_read ON cas_inbound_email FOR SELECT TO authenticated
  USING (client_id IN (SELECT id FROM nw_clients WHERE client_auth_user_id = (select auth.uid())));
