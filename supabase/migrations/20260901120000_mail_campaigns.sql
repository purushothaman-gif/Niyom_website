/*
  # Email Campaigns — one-click bulk mail to all clients or all partners

  Everything email in this codebase up to now is TRANSACTIONAL: one event, one
  recipient, one send (deal confirmation, OTP, payment link). There has never
  been a way to tell every client about an NFO or every partner about a new
  product, which in practice meant exporting a list into someone's personal mail
  client — unauditable, unbranded, and with no opt-out.

  Three things drive the shape of this schema:

  1. A HALF-SENT BLAST IS THE WORST OUTCOME. So the audience is materialised
     into a real outbox table (mail_campaign_recipients) before the first mail
     goes out, and workers CLAIM rows with FOR UPDATE SKIP LOCKED. Two
     concurrent senders — a retry, a double-clicked button, two admins — cannot
     take the same row, and a dropped connection leaves a resumable queue rather
     than an unknown state. UNIQUE (campaign_id, lower(email)) is the backstop:
     even a bug cannot deliver two copies to one address.

  2. OPT-OUT IS NOT OPTIONAL. Niyom is an AMFI-registered MFD sending commercial
     mail; mail_suppressions is keyed on the EMAIL, not on a client or partner
     id, because one human who says stop means stop — whether they are a client,
     a partner, or both.

  3. THESE TABLES ARE THE ENTIRE CLIENT EMAIL LIST. That is precisely the shape
     of the surface behind the 2026-08 PAN leak. So unlike the bond and share
     masters there is no staff-read tier here: admin only, with the recipient
     and suppression tables admin-SELECT and every write coming from a
     service-role edge function (the append-only posture nw_deal_email_log
     already uses).

  The mail body is stored as a STRUCTURED BLOCK LIST (jsonb), not HTML. There is
  no rich-text editor anywhere in this codebase and email clients reject modern
  layout anyway, so blocks are rendered to table-based inline-styled HTML by one
  shared renderer. Storing HTML would have meant trusting admin-authored markup
  into every client's inbox — see the debit-note XSS finding closed 2026-08-09.
*/

-- ---------------------------------------------------------------------------
-- Human-readable campaign reference (CMP-00001), same shape as mkt_next_content_no.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS mail_campaign_no_seq;

CREATE OR REPLACE FUNCTION mail_next_campaign_no()
RETURNS text LANGUAGE sql AS $$
  SELECT 'CMP-' || lpad(nextval('mail_campaign_no_seq')::text, 5, '0');
$$;

-- ---------------------------------------------------------------------------
-- Campaigns
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mail_campaigns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_no        text UNIQUE NOT NULL DEFAULT mail_next_campaign_no(),

  audience           text NOT NULL CHECK (audience IN ('client','partner')),
  subject            text NOT NULL DEFAULT '',
  preheader          text NOT NULL DEFAULT '',
  blocks             jsonb NOT NULL DEFAULT '[]'::jsonb,
  filters            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Portal call-to-action. Defaults on, resolved by audience at render time
  -- (/client-login vs /partner-login); the label is editable per campaign.
  cta_portal_enabled boolean NOT NULL DEFAULT true,
  cta_portal_label   text NOT NULL DEFAULT '',

  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','approved','sending','sent','cancelled','failed')),

  -- The self-review gate's teeth. content_hash is a digest of everything that
  -- affects the rendered mail; a test send stamps test_sent_hash with the hash
  -- it actually sent. Approve and Send both require the two to match, so you
  -- cannot preview version A and blast version B.
  content_hash       text NOT NULL DEFAULT '',
  test_sent_at       timestamptz,
  test_sent_hash     text,

  -- Compliance lint findings at approval time. Non-empty means the admin had to
  -- acknowledge them explicitly, and we keep the record of who did.
  compliance_flags   jsonb NOT NULL DEFAULT '[]'::jsonb,
  compliance_ack_by  uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  compliance_ack_at  timestamptz,

  generation_meta    jsonb NOT NULL DEFAULT '{}'::jsonb,

  recipient_count    integer NOT NULL DEFAULT 0,
  sent_count         integer NOT NULL DEFAULT 0,
  failed_count       integer NOT NULL DEFAULT 0,

  approved_by        uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  approved_at        timestamptz,
  send_started_at    timestamptz,
  send_completed_at  timestamptz,

  created_by         uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mail_campaigns_status_idx  ON mail_campaigns (status, created_at DESC);
CREATE INDEX IF NOT EXISTS mail_campaigns_created_idx ON mail_campaigns (created_at DESC);

-- ---------------------------------------------------------------------------
-- The outbox. One row per person, snapshotted when the send starts so that a
-- client added mid-send is not half-included, and so "who did this campaign
-- actually reach" is answerable a year later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mail_campaign_recipients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id         uuid NOT NULL REFERENCES mail_campaigns(id) ON DELETE CASCADE,
  audience            text NOT NULL CHECK (audience IN ('client','partner')),

  client_id           uuid REFERENCES nw_clients(id) ON DELETE SET NULL,
  dsa_id              uuid REFERENCES nw_dsa(id) ON DELETE SET NULL,

  email               text NOT NULL,
  full_name           text NOT NULL DEFAULT '',
  merge               jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Per-recipient 256-bit random token behind the unsubscribe link. Random
  -- rather than derived so the link cannot be guessed from an address and so
  -- an opt-out is always traceable to the campaign that caused it.
  unsub_token         text NOT NULL UNIQUE,

  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','sending','sent','failed','skipped')),
  attempts            integer NOT NULL DEFAULT 0,
  provider_message_id text,
  error               text NOT NULL DEFAULT '',
  sent_at             timestamptz,
  claimed_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Nobody gets two copies. Structural, not a matter of the sender behaving.
CREATE UNIQUE INDEX IF NOT EXISTS mail_recipients_campaign_email_uk
  ON mail_campaign_recipients (campaign_id, lower(email));
CREATE INDEX IF NOT EXISTS mail_recipients_claim_idx
  ON mail_campaign_recipients (campaign_id, status);

-- ---------------------------------------------------------------------------
-- Opt-out list. Keyed on the email address alone.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mail_suppressions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL,
  reason            text NOT NULL DEFAULT 'unsubscribe'
                      CHECK (reason IN ('unsubscribe','bounce','complaint','manual')),
  source_campaign_id uuid REFERENCES mail_campaigns(id) ON DELETE SET NULL,
  note              text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_suppressions_email_uk ON mail_suppressions (lower(email));

-- ---------------------------------------------------------------------------
-- Reusable image library for campaign bodies.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mail_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_path text NOT NULL UNIQUE,
  public_url   text NOT NULL,
  file_name    text NOT NULL DEFAULT '',
  byte_size    integer NOT NULL DEFAULT 0,
  uploaded_by  uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mail_assets_created_idx ON mail_assets (created_at DESC);

-- ---------------------------------------------------------------------------
-- Append-only audit. campaign_no is denormalised so the trail stays readable
-- if a campaign is ever deleted (same reasoning as mkt_approval_events).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mail_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id        uuid REFERENCES mail_campaigns(id) ON DELETE SET NULL,
  campaign_no        text NOT NULL DEFAULT '',
  event_type         text NOT NULL CHECK (event_type IN (
                       'created','generated','edited','test_sent','compliance_ack',
                       'approved','cancelled','send_started','send_completed')),
  actor_employee_id  uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  note               text NOT NULL DEFAULT '',
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mail_events_campaign_idx ON mail_events (campaign_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Editing an approved campaign un-approves it. Without this, an admin could
-- approve a reviewed draft, edit the body, and send something no one reviewed.
-- Only fields that change the rendered mail count as an edit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mail_unapprove_on_edit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'approved' AND (
       NEW.subject            IS DISTINCT FROM OLD.subject
    OR NEW.preheader          IS DISTINCT FROM OLD.preheader
    OR NEW.blocks             IS DISTINCT FROM OLD.blocks
    OR NEW.cta_portal_enabled IS DISTINCT FROM OLD.cta_portal_enabled
    OR NEW.cta_portal_label   IS DISTINCT FROM OLD.cta_portal_label
    OR NEW.audience           IS DISTINCT FROM OLD.audience
  ) THEN
    NEW.status      := 'draft';
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS mail_campaigns_unapprove ON mail_campaigns;
CREATE TRIGGER mail_campaigns_unapprove BEFORE UPDATE ON mail_campaigns
  FOR EACH ROW EXECUTE FUNCTION mail_unapprove_on_edit();

DROP TRIGGER IF EXISTS mail_campaigns_touch ON mail_campaigns;
CREATE TRIGGER mail_campaigns_touch BEFORE UPDATE ON mail_campaigns
  FOR EACH ROW EXECUTE FUNCTION bm_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS. Admin only, everywhere. The recipient and suppression tables are read
-- only even for admins — every write goes through a SECURITY DEFINER RPC or a
-- service-role edge function, so counts and statuses cannot drift by hand.
-- ---------------------------------------------------------------------------
ALTER TABLE mail_campaigns           ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_suppressions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_assets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE mail_events              ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mail_campaigns_admin_all ON mail_campaigns;
CREATE POLICY mail_campaigns_admin_all ON mail_campaigns FOR ALL TO authenticated
  USING (nw_current_emp_is_admin()) WITH CHECK (nw_current_emp_is_admin());

DROP POLICY IF EXISTS mail_recipients_admin_read ON mail_campaign_recipients;
CREATE POLICY mail_recipients_admin_read ON mail_campaign_recipients FOR SELECT TO authenticated
  USING (nw_current_emp_is_admin());

DROP POLICY IF EXISTS mail_suppressions_admin_read ON mail_suppressions;
CREATE POLICY mail_suppressions_admin_read ON mail_suppressions FOR SELECT TO authenticated
  USING (nw_current_emp_is_admin());

DROP POLICY IF EXISTS mail_assets_admin_all ON mail_assets;
CREATE POLICY mail_assets_admin_all ON mail_assets FOR ALL TO authenticated
  USING (nw_current_emp_is_admin()) WITH CHECK (nw_current_emp_is_admin());

DROP POLICY IF EXISTS mail_events_admin_read ON mail_events;
CREATE POLICY mail_events_admin_read ON mail_events FOR SELECT TO authenticated
  USING (nw_current_emp_is_admin());

-- ---------------------------------------------------------------------------
-- Audience resolution.
--
-- ONE function answers both "how many will this reach?" and "who exactly gets
-- it?". If the preview counted with different logic than the send used, the
-- number an admin approved would not be the number that received the mail —
-- so the preview and the materialiser both call this and nothing else.
--
-- Note the column drift between the two audiences: clients carry
-- verification_status/client_login_enabled, partners carry status/
-- dsa_login_enabled, and the "name" and "code" columns differ too. It is
-- flattened here so nothing downstream has to branch on audience.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mail_audience_rows(p_audience text, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  client_id uuid, dsa_id uuid, email text, full_name text, code text, suppressed boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, NULL::uuid, lower(trim(c.email)), c.full_name, c.client_code,
         EXISTS (SELECT 1 FROM mail_suppressions s WHERE lower(s.email) = lower(trim(c.email)))
    FROM nw_clients c
   WHERE p_audience = 'client'
     AND c.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     AND (p_filters->>'verification_status' IS NULL OR c.verification_status = p_filters->>'verification_status')
     AND (p_filters->>'employee_id'         IS NULL OR c.employee_id = (p_filters->>'employee_id')::uuid)
     AND (p_filters->>'city'                IS NULL OR lower(coalesce(c.city,'')) = lower(p_filters->>'city'))
     AND (p_filters->>'login_enabled'       IS NULL OR coalesce(c.client_login_enabled,false) = (p_filters->>'login_enabled')::boolean)
  UNION ALL
  SELECT NULL::uuid, d.id, lower(trim(d.email)), d.full_name, d.dsa_code,
         EXISTS (SELECT 1 FROM mail_suppressions s WHERE lower(s.email) = lower(trim(d.email)))
    FROM nw_dsa d
   WHERE p_audience = 'partner'
     AND d.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     AND d.status = coalesce(p_filters->>'status', 'active')
     AND (p_filters->>'employee_id'   IS NULL OR d.employee_id = (p_filters->>'employee_id')::uuid)
     AND (p_filters->>'login_enabled' IS NULL OR coalesce(d.dsa_login_enabled,false) = (p_filters->>'login_enabled')::boolean);
$$;

REVOKE ALL ON FUNCTION mail_audience_rows(text, jsonb) FROM PUBLIC, anon;

-- What the composer shows before anything is sent. Deliberately returns counts
-- only — no addresses — so a shoulder-surfed screen is not a client list.
CREATE OR REPLACE FUNCTION mail_preview_audience(p_audience text, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_total int; v_suppressed int; v_sendable int;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only administrators can view campaign audiences.';
  END IF;
  IF p_audience NOT IN ('client','partner') THEN
    RAISE EXCEPTION 'Audience must be client or partner.';
  END IF;

  SELECT count(DISTINCT email),
         count(DISTINCT email) FILTER (WHERE suppressed),
         count(DISTINCT email) FILTER (WHERE NOT suppressed)
    INTO v_total, v_suppressed, v_sendable
    FROM mail_audience_rows(p_audience, coalesce(p_filters, '{}'::jsonb));

  RETURN jsonb_build_object(
    'total', coalesce(v_total,0),
    'suppressed', coalesce(v_suppressed,0),
    'sendable', coalesce(v_sendable,0)
  );
END; $$;

REVOKE ALL ON FUNCTION mail_preview_audience(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mail_preview_audience(text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- Freeze the audience into the outbox. Idempotent: re-running after a partial
-- send adds nothing, because the (campaign_id, lower(email)) unique index
-- absorbs every row already there. That is what makes "Resume" safe.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mail_materialise_recipients(p_campaign_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c mail_campaigns%ROWTYPE; v_count int;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only administrators can prepare a campaign for sending.';
  END IF;

  SELECT * INTO v_c FROM mail_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown campaign.'; END IF;
  IF v_c.status NOT IN ('approved','sending') THEN
    RAISE EXCEPTION 'A campaign must be approved before its recipients can be prepared (this one is %).', v_c.status;
  END IF;

  -- DISTINCT ON collapses duplicate addresses (joint holders sharing a mailbox,
  -- a partner who is also a client) to one row before insert, so the unique
  -- index is a backstop rather than the thing doing the work.
  INSERT INTO mail_campaign_recipients (campaign_id, audience, client_id, dsa_id, email, full_name, merge, unsub_token)
  SELECT p_campaign_id, v_c.audience, a.client_id, a.dsa_id, a.email, a.full_name,
         jsonb_build_object(
           'full_name',  a.full_name,
           'first_name', split_part(trim(a.full_name), ' ', 1),
           'code',       coalesce(a.code,'')
         ),
         encode(extensions.gen_random_bytes(32), 'hex')
    FROM (
      SELECT DISTINCT ON (email) * FROM mail_audience_rows(v_c.audience, v_c.filters)
       WHERE NOT suppressed ORDER BY email, full_name
    ) a
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO v_count FROM mail_campaign_recipients WHERE campaign_id = p_campaign_id;
  UPDATE mail_campaigns SET recipient_count = v_count WHERE id = p_campaign_id;
  RETURN v_count;
END; $$;

REVOKE ALL ON FUNCTION mail_materialise_recipients(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mail_materialise_recipients(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Claim a chunk of the outbox.
--
-- THIS is the anti-double-send mechanism. FOR UPDATE SKIP LOCKED means two
-- senders running at once — a retried invocation, an impatient second click,
-- two admins on the same campaign — take disjoint sets rather than the same
-- rows. A claimed row leaves 'queued' in the same transaction it is handed out,
-- so it can never be handed out twice.
--
-- attempts is bumped on claim, not on failure, so a row that kills the worker
-- mid-send is still counted as tried and cannot spin forever.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mail_claim_recipients(p_campaign_id uuid, p_limit integer DEFAULT 100)
RETURNS TABLE (id uuid, email text, full_name text, merge jsonb, unsub_token text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only administrators can send a campaign.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM mail_campaigns c WHERE c.id = p_campaign_id AND c.status = 'sending') THEN
    RAISE EXCEPTION 'This campaign is not currently sending.';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    SELECT r.id FROM mail_campaign_recipients r
     WHERE r.campaign_id = p_campaign_id
       AND r.status = 'queued'
       AND r.attempts < 3
     ORDER BY r.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT greatest(1, least(coalesce(p_limit,100), 100))
  )
  UPDATE mail_campaign_recipients r
     SET status = 'sending', attempts = r.attempts + 1, claimed_at = now()
    FROM claimed
   WHERE r.id = claimed.id
  RETURNING r.id, r.email, r.full_name, r.merge, r.unsub_token;
END; $$;

REVOKE ALL ON FUNCTION mail_claim_recipients(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mail_claim_recipients(uuid, integer) TO authenticated;

-- Record one delivery outcome and keep the campaign's running totals honest.
-- A row that failed but has attempts left goes back to 'queued' so Resume
-- retries it; one that has exhausted its attempts stays 'failed'.
CREATE OR REPLACE FUNCTION mail_mark_recipient(
  p_id uuid, p_status text, p_message_id text DEFAULT NULL, p_error text DEFAULT ''
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_campaign uuid; v_attempts int; v_final text;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only administrators can send a campaign.';
  END IF;
  IF p_status NOT IN ('sent','failed','skipped') THEN
    RAISE EXCEPTION 'Invalid recipient status %.', p_status;
  END IF;

  SELECT campaign_id, attempts INTO v_campaign, v_attempts
    FROM mail_campaign_recipients WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_final := CASE WHEN p_status = 'failed' AND v_attempts < 3 THEN 'queued' ELSE p_status END;

  UPDATE mail_campaign_recipients
     SET status = v_final,
         provider_message_id = coalesce(p_message_id, provider_message_id),
         error = coalesce(p_error, ''),
         sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END
   WHERE id = p_id;

  UPDATE mail_campaigns c
     SET sent_count   = (SELECT count(*) FROM mail_campaign_recipients r WHERE r.campaign_id = v_campaign AND r.status = 'sent'),
         failed_count = (SELECT count(*) FROM mail_campaign_recipients r WHERE r.campaign_id = v_campaign AND r.status = 'failed')
   WHERE c.id = v_campaign;
END; $$;

REVOKE ALL ON FUNCTION mail_mark_recipient(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mail_mark_recipient(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Lifecycle: log, test-send stamp, approve/cancel, send start/finish.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mail_log_event(
  p_campaign_id uuid, p_event_type text, p_note text DEFAULT '', p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no text;
BEGIN
  SELECT campaign_no INTO v_no FROM mail_campaigns WHERE id = p_campaign_id;
  INSERT INTO mail_events (campaign_id, campaign_no, event_type, actor_employee_id, note, metadata)
  VALUES (p_campaign_id, coalesce(v_no,''), p_event_type, nw_current_employee_id(), coalesce(p_note,''), coalesce(p_metadata,'{}'::jsonb));
END; $$;

REVOKE ALL ON FUNCTION mail_log_event(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mail_log_event(uuid, text, text, jsonb) TO authenticated;

-- Stamp a successful test send with the hash of exactly what was sent. The
-- approve gate compares this against the campaign's current content_hash, so
-- editing after testing silently invalidates the test rather than passing it.
CREATE OR REPLACE FUNCTION mail_record_test_send(p_campaign_id uuid, p_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only administrators can send test emails.';
  END IF;
  UPDATE mail_campaigns SET test_sent_at = now(), test_sent_hash = p_hash WHERE id = p_campaign_id;
  PERFORM mail_log_event(p_campaign_id, 'test_sent', '', jsonb_build_object('hash', p_hash));
END; $$;

REVOKE ALL ON FUNCTION mail_record_test_send(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mail_record_test_send(uuid, text) TO authenticated;

-- Approve / cancel.
--
-- Approval is a SELF-review gate: the same admin may approve their own draft,
-- but only after actually receiving it. Requiring a test send that matches the
-- current content is the whole safety mechanism standing between a typo and
-- every client's inbox, so it is enforced here rather than in the UI — the UI
-- disables the button, this makes the button impossible to bypass.
CREATE OR REPLACE FUNCTION mail_set_campaign_status(
  p_campaign_id uuid, p_action text, p_note text DEFAULT '', p_ack_compliance boolean DEFAULT false
) RETURNS mail_campaigns LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c mail_campaigns%ROWTYPE; v_actor uuid := nw_current_employee_id();
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only administrators can approve or cancel a campaign.';
  END IF;

  SELECT * INTO v_c FROM mail_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown campaign.'; END IF;

  IF p_action = 'approve' THEN
    IF v_c.status <> 'draft' THEN
      RAISE EXCEPTION 'Only a draft can be approved (this one is %).', v_c.status;
    END IF;
    IF coalesce(trim(v_c.subject),'') = '' THEN
      RAISE EXCEPTION 'Add a subject line before approving.';
    END IF;
    IF jsonb_array_length(v_c.blocks) = 0 THEN
      RAISE EXCEPTION 'Add some content before approving.';
    END IF;
    IF v_c.test_sent_hash IS NULL THEN
      RAISE EXCEPTION 'Send yourself a test email before approving this campaign.';
    END IF;
    IF v_c.test_sent_hash IS DISTINCT FROM v_c.content_hash THEN
      RAISE EXCEPTION 'This campaign has changed since your test email. Send a fresh test before approving.';
    END IF;
    IF jsonb_array_length(v_c.compliance_flags) > 0 AND NOT p_ack_compliance THEN
      RAISE EXCEPTION 'This campaign has unresolved compliance flags. Review and acknowledge them before approving.';
    END IF;

    UPDATE mail_campaigns
       SET status = 'approved', approved_by = v_actor, approved_at = now(),
           compliance_ack_by = CASE WHEN jsonb_array_length(compliance_flags) > 0 THEN v_actor ELSE compliance_ack_by END,
           compliance_ack_at = CASE WHEN jsonb_array_length(compliance_flags) > 0 THEN now()    ELSE compliance_ack_at END
     WHERE id = p_campaign_id RETURNING * INTO v_c;

    IF jsonb_array_length(v_c.compliance_flags) > 0 THEN
      PERFORM mail_log_event(p_campaign_id, 'compliance_ack', p_note, v_c.compliance_flags);
    END IF;
    PERFORM mail_log_event(p_campaign_id, 'approved', p_note);

  ELSIF p_action = 'cancel' THEN
    IF v_c.status = 'sent' THEN
      RAISE EXCEPTION 'This campaign has already been sent and cannot be cancelled.';
    END IF;
    UPDATE mail_campaigns SET status = 'cancelled' WHERE id = p_campaign_id RETURNING * INTO v_c;
    PERFORM mail_log_event(p_campaign_id, 'cancelled', p_note);

  ELSE
    RAISE EXCEPTION 'Unknown action %.', p_action;
  END IF;

  RETURN v_c;
END; $$;

REVOKE ALL ON FUNCTION mail_set_campaign_status(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mail_set_campaign_status(uuid, text, text, boolean) TO authenticated;

-- Move an approved campaign into 'sending'. Re-entrant: calling it on a
-- campaign already sending is how Resume works after a dropped connection.
CREATE OR REPLACE FUNCTION mail_begin_send(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_c mail_campaigns%ROWTYPE; v_total int;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only administrators can send a campaign.';
  END IF;

  SELECT * INTO v_c FROM mail_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown campaign.'; END IF;

  IF v_c.status = 'sent' THEN
    RAISE EXCEPTION 'This campaign has already been sent.';
  END IF;
  IF v_c.status NOT IN ('approved','sending') THEN
    RAISE EXCEPTION 'Approve this campaign before sending it (it is %).', v_c.status;
  END IF;
  -- Belt and braces: the approve gate already checked this, but the body could
  -- in principle have been rewritten between approval and send.
  IF v_c.test_sent_hash IS DISTINCT FROM v_c.content_hash THEN
    RAISE EXCEPTION 'This campaign has changed since it was tested and approved. Re-test and re-approve before sending.';
  END IF;

  IF v_c.status = 'approved' THEN
    UPDATE mail_campaigns SET status = 'sending', send_started_at = now() WHERE id = p_campaign_id;
    PERFORM mail_log_event(p_campaign_id, 'send_started');
  END IF;

  SELECT mail_materialise_recipients(p_campaign_id) INTO v_total;

  RETURN jsonb_build_object(
    'recipient_count', v_total,
    'remaining', (SELECT count(*) FROM mail_campaign_recipients
                   WHERE campaign_id = p_campaign_id AND status IN ('queued','sending') AND attempts < 3)
  );
END; $$;

REVOKE ALL ON FUNCTION mail_begin_send(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mail_begin_send(uuid) TO authenticated;

-- Close out a send once nothing is left to claim. Returns the work still
-- outstanding so the caller knows whether to come back for another pass.
CREATE OR REPLACE FUNCTION mail_finish_send(p_campaign_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_remaining int; v_sent int; v_failed int;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only administrators can send a campaign.';
  END IF;

  -- A row stuck in 'sending' from a worker that died mid-batch is returned to
  -- the queue after a grace period, so Resume picks it up instead of it
  -- silently never being delivered.
  UPDATE mail_campaign_recipients
     SET status = 'queued'
   WHERE campaign_id = p_campaign_id AND status = 'sending'
     AND claimed_at < now() - interval '10 minutes' AND attempts < 3;

  SELECT count(*) FILTER (WHERE status IN ('queued','sending') AND attempts < 3),
         count(*) FILTER (WHERE status = 'sent'),
         count(*) FILTER (WHERE status = 'failed')
    INTO v_remaining, v_sent, v_failed
    FROM mail_campaign_recipients WHERE campaign_id = p_campaign_id;

  IF v_remaining = 0 THEN
    UPDATE mail_campaigns
       SET status = 'sent', send_completed_at = now(), sent_count = v_sent, failed_count = v_failed
     WHERE id = p_campaign_id AND status = 'sending';
    IF FOUND THEN
      PERFORM mail_log_event(p_campaign_id, 'send_completed', '',
                             jsonb_build_object('sent', v_sent, 'failed', v_failed));
    END IF;
  END IF;

  RETURN jsonb_build_object('remaining', v_remaining, 'sent', v_sent, 'failed', v_failed);
END; $$;

REVOKE ALL ON FUNCTION mail_finish_send(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mail_finish_send(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Unsubscribe.
--
-- Called ONLY by the mail-unsubscribe edge function under the service role —
-- deliberately never granted to authenticated or anon, so the public surface is
-- the function's own token check and nothing else. It returns a plain boolean
-- and never the address: an unknown token and a known one are indistinguishable
-- to the caller, which is what stops this becoming an address-enumeration
-- oracle (cf. the PAN to email oracle closed 2026-08-09).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mail_unsubscribe_by_token(p_token text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text; v_campaign uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 32 THEN RETURN false; END IF;

  SELECT email, campaign_id INTO v_email, v_campaign
    FROM mail_campaign_recipients WHERE unsub_token = p_token;
  IF NOT FOUND THEN RETURN false; END IF;

  INSERT INTO mail_suppressions (email, reason, source_campaign_id)
  VALUES (lower(v_email), 'unsubscribe', v_campaign)
  ON CONFLICT DO NOTHING;

  RETURN true;
END; $$;

REVOKE ALL ON FUNCTION mail_unsubscribe_by_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mail_unsubscribe_by_token(text) TO service_role;

-- ---------------------------------------------------------------------------
-- Campaign image bucket. PUBLIC by necessity: a mail client fetches images
-- anonymously months after delivery, so a signed URL would render every past
-- campaign broken the moment it expired. The SELECT policy is not decorative —
-- the storage upload path needs it (see 20260831120000 and employee-avatars).
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('campaign-images', 'campaign-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can read campaign images" ON storage.objects;
CREATE POLICY "Authenticated can read campaign images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'campaign-images');

DROP POLICY IF EXISTS "Admins can upload campaign images" ON storage.objects;
CREATE POLICY "Admins can upload campaign images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'campaign-images' AND public.nw_current_emp_is_admin());

DROP POLICY IF EXISTS "Admins can update campaign images" ON storage.objects;
CREATE POLICY "Admins can update campaign images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'campaign-images' AND public.nw_current_emp_is_admin())
  WITH CHECK (bucket_id = 'campaign-images' AND public.nw_current_emp_is_admin());

DROP POLICY IF EXISTS "Admins can delete campaign images" ON storage.objects;
CREATE POLICY "Admins can delete campaign images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'campaign-images' AND public.nw_current_emp_is_admin());
