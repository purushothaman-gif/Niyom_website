/*
  # CAS request tracking and consent

  Today a client is handed a five-step guide, sent to camsonline.com, and left to
  find their own way back. We never know a request was made, so we cannot chase
  it, cannot tell an RM it stalled, and cannot tell the client anything at all
  until they return of their own accord and upload a file.

  These two tables close that gap. `cas_requests` records the INTENT — that this
  client, at this moment, set out to import a statement covering this period —
  so the journey becomes trackable and recoverable. `cas_consents` records what
  they authorised, separately and revocably.

  ## What this deliberately does NOT do

  It does not request the statement from CAMS on the client's behalf. No such
  route exists for an AMFI-registered distributor: CAMS publishes no
  distributor-facing CAS API, and in September 2025 AMFI directed MF Central to
  stop supplying investor data to third-party apps. The Account Aggregator
  framework would allow it, but an FIU must be regulated by RBI/SEBI/IRDAI/
  PFRDA and an ARN does not qualify. So the CAMS form stays investor-initiated,
  and a row here means "the client told us they are requesting one", never "we
  requested one".

  ## Consent

  Four authorisations, recorded separately rather than bundled behind a single
  tick: requesting a statement, reading email for it, holding the file while it
  is parsed, and importing the holdings. A client may grant the first and refuse
  the second. Rows are append-only and revocation sets `revoked_at` rather than
  deleting, because the question a regulator or a client asks later is "what was
  I agreeing to at the time?", and a deleted row cannot answer it.
*/

/* ----------------------------------------------------------------- requests */

CREATE TABLE IF NOT EXISTS cas_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES nw_clients(id) ON DELETE CASCADE,

  /*
   * draft             created, client still on the wizard
   * awaiting_statement the client says they submitted the CAMS form
   * received          a statement arrived and is being processed
   * imported          reconciled and in the portfolio (see import_id)
   * failed            arrived but could not be used
   * cancelled         the client backed out
   * expired           nothing arrived within the window
   */
  status text NOT NULL DEFAULT 'draft',

  /* The parameters the client was told to enter, kept so we can show them
     again on return and so a mismatch is diagnosable. */
  requested_email text,
  statement_from date,
  statement_to date,
  statement_type text DEFAULT 'detailed',
  include_zero_balance boolean DEFAULT true,

  /*
   * When we stop waiting. CAMS delivers in roughly five minutes, so a window
   * measured in hours is generous; past it the client is nudged rather than
   * left wondering.
   */
  expected_by timestamptz,

  /* Set once the request produces an import. */
  import_id uuid REFERENCES cas_imports(id) ON DELETE SET NULL,

  failure_reason text,
  cancelled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  /* Employee id when staff walked the client through it; null when self-serve. */
  created_by uuid
);

COMMENT ON TABLE cas_requests IS
  'One row per attempt to import a statement. Records the client''s intent — NOT a request made to CAMS on their behalf, which no distributor may do.';
COMMENT ON COLUMN cas_requests.expected_by IS
  'When to stop waiting and nudge. CAMS delivers in ~5 minutes.';

/* ----------------------------------------------------------------- consents */

CREATE TABLE IF NOT EXISTS cas_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES nw_clients(id) ON DELETE CASCADE,
  request_id uuid REFERENCES cas_requests(id) ON DELETE SET NULL,

  /* cas_request | email_read | temp_storage | portfolio_import | arn_migration */
  consent_type text NOT NULL,
  granted boolean NOT NULL DEFAULT true,
  granted_at timestamptz DEFAULT now(),
  /* Set on withdrawal. The row is never deleted — see the header. */
  revoked_at timestamptz,

  /* Which wording they actually agreed to, so a later copy change cannot
     rewrite history. */
  policy_version text NOT NULL DEFAULT 'v1',
  ip text,
  user_agent text,
  evidence jsonb DEFAULT '{}'::jsonb,

  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE cas_consents IS
  'Append-only record of what a client authorised, per scope. Revocation sets revoked_at; rows are never deleted, because "what was I agreeing to?" must remain answerable.';

/* ------------------------------------------------------- link back to import */

/*
 * `source` and `status` on cas_imports are free text by design and carry no
 * CHECK constraint, so the new email-sourced values need no DDL — only the
 * comment, which is where their meaning is documented.
 */
ALTER TABLE cas_imports ADD COLUMN IF NOT EXISTS request_id uuid
  REFERENCES cas_requests(id) ON DELETE SET NULL;

COMMENT ON COLUMN cas_imports.source IS
  'client_upload | staff_upload | email_gmail | email_outlook | email_imap';
COMMENT ON COLUMN cas_imports.request_id IS
  'The cas_requests row this import fulfilled, when it came from a tracked request.';

/* ------------------------------------------------------------------ indexes */

CREATE INDEX IF NOT EXISTS idx_cas_requests_client ON cas_requests(client_id, created_at DESC);
/* Drives the "which requests are still waiting?" sweep. */
CREATE INDEX IF NOT EXISTS idx_cas_requests_open ON cas_requests(status, expected_by)
  WHERE status IN ('draft', 'awaiting_statement', 'received');
CREATE INDEX IF NOT EXISTS idx_cas_consents_client ON cas_consents(client_id, consent_type);
CREATE INDEX IF NOT EXISTS idx_cas_imports_request ON cas_imports(request_id);

/* ---------------------------------------------------------------------- RLS */

ALTER TABLE cas_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE cas_consents ENABLE ROW LEVEL SECURITY;

/*
  Same shape as the rest of the cas_* schema: a client reads their own and
  nothing else, and nothing is writable from a browser session — every write
  goes through the proxy with the service role, which is what lets us stamp IP
  and user agent onto a consent record that the client cannot forge.

  (select auth.uid()) rather than auth.uid() so the planner evaluates it once
  per query instead of once per row.
*/
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cas_requests','cas_consents']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_own_read', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR SELECT TO authenticated
      USING (client_id IN (
        SELECT id FROM nw_clients WHERE client_auth_user_id = (select auth.uid())
      ))
    $f$, t || '_own_read', t);
  END LOOP;
END $$;
