/*
  # Email Campaigns for every employee, sent from the right mailbox

  Until now campaigns were admin-only and always went out from
  support@niyomwealth.com to the whole client or partner list. This opens the
  module to relationship managers without widening what anyone can reach:

  - SENDER. Fixed by trigger at creation, never by the browser: a campaign an
    admin creates is a COMPANY campaign (support@niyomwealth.com); one an
    employee creates is an EMPLOYEE campaign, sent from that employee's own
    @niyomwealth.com address with replies to them. Neither can be changed
    afterwards.

  - REACH. An employee campaign can only ever reach the sender's own book —
    clients with nw_clients.employee_id = sender, partners with
    nw_dsa.employee_id = sender. That is enforced where the list is built
    (mail_effective_filters, used by the materialiser, and the preview), so no
    filter a browser sends can widen it.

  - SELECTION. "All" or hand-picked recipients: filters.ids holds the chosen
    client / partner ids, still intersected with the sender's scope.

  - APPROVAL stays the self-review gate it was: the author approves their own
    campaign only after receiving a test of the exact version, with compliance
    flags acknowledged. Admins can see and manage every campaign.

  Every RPC that used to require nw_current_emp_is_admin() now requires
  mail_can_manage(campaign): an admin, or the employee who owns it.
*/

-- ---------------------------------------------------------------------------
-- 1. Sender columns
-- ---------------------------------------------------------------------------
ALTER TABLE mail_campaigns
  ADD COLUMN IF NOT EXISTS sender_kind text NOT NULL DEFAULT 'company'
    CHECK (sender_kind IN ('company', 'employee')),
  ADD COLUMN IF NOT EXISTS sender_employee_id uuid REFERENCES nw_employees(id) ON DELETE SET NULL,
  -- The topic / requirements the draft was generated from, kept for reference.
  ADD COLUMN IF NOT EXISTS brief jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS mail_campaigns_created_by_idx ON mail_campaigns (created_by);
CREATE INDEX IF NOT EXISTS mail_campaigns_sender_idx ON mail_campaigns (sender_employee_id);

-- ---------------------------------------------------------------------------
-- 2. Who may author, who may manage a given campaign
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mail_can_author()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM nw_employees
     WHERE auth_user_id = auth.uid() AND status = 'active'
       AND role IN ('employee', 'admin', 'super_admin')
  );
$$;

CREATE OR REPLACE FUNCTION mail_can_manage(p_campaign_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT nw_current_emp_is_admin()
      OR (mail_can_author() AND EXISTS (
            SELECT 1 FROM mail_campaigns c
             WHERE c.id = p_campaign_id
               AND c.sender_kind = 'employee'
               AND c.created_by = nw_current_employee_id()));
$$;

-- The filters a campaign is actually sent with: an employee campaign is always
-- pinned to its sender's book.
CREATE OR REPLACE FUNCTION mail_effective_filters(c mail_campaigns)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE WHEN c.sender_kind = 'employee'
              THEN coalesce(c.filters, '{}'::jsonb) || jsonb_build_object('employee_id', c.sender_employee_id)
              ELSE coalesce(c.filters, '{}'::jsonb) END;
$$;

REVOKE ALL ON FUNCTION mail_can_author() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION mail_can_manage(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION mail_effective_filters(mail_campaigns) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mail_can_author() TO authenticated;
GRANT EXECUTE ON FUNCTION mail_can_manage(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sender is set by the database, and workflow columns are not writable by
--    a direct employee UPDATE (they change only through the RPCs, which run as
--    the function owner, so current_user is not 'authenticated' there).
-- ---------------------------------------------------------------------------
-- NOT security definer: the guard relies on current_user to tell a direct
-- client UPDATE ('authenticated') from one made inside an RPC (the owner).
CREATE OR REPLACE FUNCTION mail_campaign_sender_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_me uuid := nw_current_employee_id();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_me IS NOT NULL THEN
      NEW.created_by := v_me;
      IF nw_current_emp_is_admin() THEN
        NEW.sender_kind := 'company';
        NEW.sender_employee_id := NULL;
      ELSE
        NEW.sender_kind := 'employee';
        NEW.sender_employee_id := v_me;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  NEW.created_by         := OLD.created_by;
  NEW.sender_kind        := OLD.sender_kind;
  NEW.sender_employee_id := OLD.sender_employee_id;

  IF current_user = 'authenticated' AND NOT nw_current_emp_is_admin() THEN
    NEW.status            := OLD.status;
    NEW.approved_by       := OLD.approved_by;
    NEW.approved_at       := OLD.approved_at;
    NEW.test_sent_at      := OLD.test_sent_at;
    NEW.test_sent_hash    := OLD.test_sent_hash;
    NEW.compliance_ack_by := OLD.compliance_ack_by;
    NEW.compliance_ack_at := OLD.compliance_ack_at;
    NEW.recipient_count   := OLD.recipient_count;
    NEW.sent_count        := OLD.sent_count;
    NEW.failed_count      := OLD.failed_count;
    NEW.send_started_at   := OLD.send_started_at;
    NEW.send_completed_at := OLD.send_completed_at;
    -- A campaign that has started sending is a record; nothing changes it.
    IF OLD.status IN ('sending', 'sent') THEN
      RAISE EXCEPTION 'This campaign has already been sent and can no longer be edited.';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION mail_campaign_sender_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mail_campaign_sender_guard ON mail_campaigns;
CREATE TRIGGER mail_campaign_sender_guard
  BEFORE INSERT OR UPDATE ON mail_campaigns
  FOR EACH ROW EXECUTE FUNCTION mail_campaign_sender_guard();

-- Changing who receives an approved campaign un-approves it, like content does.
CREATE OR REPLACE FUNCTION mail_unapprove_on_edit() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND (
       NEW.subject            IS DISTINCT FROM OLD.subject
    OR NEW.preheader          IS DISTINCT FROM OLD.preheader
    OR NEW.blocks             IS DISTINCT FROM OLD.blocks
    OR NEW.cta_portal_enabled IS DISTINCT FROM OLD.cta_portal_enabled
    OR NEW.cta_portal_label   IS DISTINCT FROM OLD.cta_portal_label
    OR NEW.audience           IS DISTINCT FROM OLD.audience
    OR NEW.filters            IS DISTINCT FROM OLD.filters
  ) THEN
    NEW.status      := 'draft';
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION mail_unapprove_on_edit() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS for owners (admin policies stay as they are)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS mail_campaigns_owner_select ON mail_campaigns;
CREATE POLICY mail_campaigns_owner_select ON mail_campaigns FOR SELECT TO authenticated
  USING (sender_kind = 'employee' AND created_by = (SELECT nw_current_employee_id()));

DROP POLICY IF EXISTS mail_campaigns_owner_insert ON mail_campaigns;
CREATE POLICY mail_campaigns_owner_insert ON mail_campaigns FOR INSERT TO authenticated
  WITH CHECK ((SELECT mail_can_author()) AND created_by = (SELECT nw_current_employee_id()));

DROP POLICY IF EXISTS mail_campaigns_owner_update ON mail_campaigns;
CREATE POLICY mail_campaigns_owner_update ON mail_campaigns FOR UPDATE TO authenticated
  USING (sender_kind = 'employee' AND created_by = (SELECT nw_current_employee_id()))
  WITH CHECK (sender_kind = 'employee' AND created_by = (SELECT nw_current_employee_id()));

DROP POLICY IF EXISTS mail_campaigns_owner_delete ON mail_campaigns;
CREATE POLICY mail_campaigns_owner_delete ON mail_campaigns FOR DELETE TO authenticated
  USING (sender_kind = 'employee' AND status = 'draft' AND created_by = (SELECT nw_current_employee_id()));

DROP POLICY IF EXISTS mail_recipients_owner_read ON mail_campaign_recipients;
CREATE POLICY mail_recipients_owner_read ON mail_campaign_recipients FOR SELECT TO authenticated
  USING (campaign_id IN (SELECT id FROM mail_campaigns
                          WHERE sender_kind = 'employee' AND created_by = (SELECT nw_current_employee_id())));

DROP POLICY IF EXISTS mail_events_owner_read ON mail_events;
CREATE POLICY mail_events_owner_read ON mail_events FOR SELECT TO authenticated
  USING (campaign_id IN (SELECT id FROM mail_campaigns
                          WHERE sender_kind = 'employee' AND created_by = (SELECT nw_current_employee_id())));

-- The image library is shared: anyone who can write a campaign can reuse an
-- uploaded image. Uploading stays admin-only.
DROP POLICY IF EXISTS mail_assets_author_read ON mail_assets;
CREATE POLICY mail_assets_author_read ON mail_assets FOR SELECT TO authenticated
  USING ((SELECT mail_can_author()));

-- ---------------------------------------------------------------------------
-- 5. Audience: hand-picked recipients (filters.ids)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mail_audience_rows(p_audience text, p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (client_id uuid, dsa_id uuid, email text, full_name text, code text, suppressed boolean)
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
     AND (jsonb_typeof(p_filters->'ids') IS DISTINCT FROM 'array'
          OR c.id::text IN (SELECT jsonb_array_elements_text(p_filters->'ids')))
  UNION ALL
  SELECT NULL::uuid, d.id, lower(trim(d.email)), d.full_name, d.dsa_code,
         EXISTS (SELECT 1 FROM mail_suppressions s WHERE lower(s.email) = lower(trim(d.email)))
    FROM nw_dsa d
   WHERE p_audience = 'partner'
     AND d.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     AND d.status = coalesce(p_filters->>'status', 'active')
     AND (p_filters->>'employee_id'   IS NULL OR d.employee_id = (p_filters->>'employee_id')::uuid)
     AND (p_filters->>'login_enabled' IS NULL OR coalesce(d.dsa_login_enabled,false) = (p_filters->>'login_enabled')::boolean)
     AND (jsonb_typeof(p_filters->'ids') IS DISTINCT FROM 'array'
          OR d.id::text IN (SELECT jsonb_array_elements_text(p_filters->'ids')));
$$;
REVOKE ALL ON FUNCTION mail_audience_rows(text, jsonb) FROM PUBLIC, anon, authenticated;

-- The people a campaign author can pick from: an admin sees everyone, an
-- employee only their own book. Returns addresses the caller could already
-- read through nw_clients / nw_dsa RLS.
CREATE OR REPLACE FUNCTION mail_audience_members(p_audience text, p_search text DEFAULT '')
RETURNS TABLE (id uuid, full_name text, code text, email text, suppressed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_filters jsonb := '{}'::jsonb; v_q text := lower(btrim(coalesce(p_search, '')));
BEGIN
  IF NOT mail_can_author() THEN
    RAISE EXCEPTION 'You do not have access to email campaigns.';
  END IF;
  IF p_audience NOT IN ('client', 'partner') THEN
    RAISE EXCEPTION 'Audience must be client or partner.';
  END IF;
  IF NOT nw_current_emp_is_admin() THEN
    v_filters := jsonb_build_object('employee_id', nw_current_employee_id());
  END IF;

  RETURN QUERY
  SELECT coalesce(a.client_id, a.dsa_id), a.full_name, a.code, a.email, a.suppressed
    FROM mail_audience_rows(p_audience, v_filters) a
   WHERE v_q = '' OR lower(a.full_name) LIKE '%' || v_q || '%'
      OR lower(coalesce(a.code, '')) LIKE '%' || v_q || '%' OR a.email LIKE '%' || v_q || '%'
   ORDER BY a.full_name
   LIMIT 1000;
END; $$;
REVOKE ALL ON FUNCTION mail_audience_members(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mail_audience_members(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. The lifecycle RPCs, re-guarded on mail_can_manage(campaign).
--    Bodies are otherwise the live definitions, unchanged — except that the
--    materialiser builds the list from mail_effective_filters(), and the
--    preview pins an employee to their own book.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mail_log_event(p_campaign_id uuid, p_event_type text, p_note text DEFAULT ''::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_no text;
BEGIN
  IF NOT mail_can_manage(p_campaign_id) THEN
    RAISE EXCEPTION 'Only administrators can write to the campaign audit trail.';
  END IF;
  SELECT campaign_no INTO v_no FROM mail_campaigns WHERE id = p_campaign_id;
  INSERT INTO mail_events (campaign_id, campaign_no, event_type, actor_employee_id, note, metadata)
  VALUES (p_campaign_id, coalesce(v_no,''), p_event_type, nw_current_employee_id(),
          coalesce(p_note,''), coalesce(p_metadata,'{}'::jsonb));
END; $function$;

CREATE OR REPLACE FUNCTION public.mail_record_test_send(p_campaign_id uuid, p_hash text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT mail_can_manage(p_campaign_id) THEN
    RAISE EXCEPTION 'Only administrators can send test emails.';
  END IF;
  UPDATE mail_campaigns SET test_sent_at = now(), test_sent_hash = p_hash WHERE id = p_campaign_id;
  PERFORM mail_log_event(p_campaign_id, 'test_sent', '', jsonb_build_object('hash', p_hash));
END; $function$;

CREATE OR REPLACE FUNCTION public.mail_set_campaign_status(p_campaign_id uuid, p_action text, p_note text DEFAULT ''::text, p_ack_compliance boolean DEFAULT false)
 RETURNS mail_campaigns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_c mail_campaigns%ROWTYPE; v_actor uuid := nw_current_employee_id();
BEGIN
  IF NOT mail_can_manage(p_campaign_id) THEN
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
END; $function$;

CREATE OR REPLACE FUNCTION public.mail_begin_send(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_c mail_campaigns%ROWTYPE; v_total int;
BEGIN
  IF NOT mail_can_manage(p_campaign_id) THEN
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
END; $function$;

CREATE OR REPLACE FUNCTION public.mail_finish_send(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_remaining int; v_sent int; v_failed int;
BEGIN
  IF NOT mail_can_manage(p_campaign_id) THEN
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
END; $function$;

CREATE OR REPLACE FUNCTION public.mail_claim_recipients(p_campaign_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, email text, full_name text, merge jsonb, unsub_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT mail_can_manage(p_campaign_id) THEN
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
END; $function$;

CREATE OR REPLACE FUNCTION public.mail_materialise_recipients(p_campaign_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_c mail_campaigns%ROWTYPE; v_count int;
BEGIN
  IF NOT mail_can_manage(p_campaign_id) THEN
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
      SELECT DISTINCT ON (email) * FROM mail_audience_rows(v_c.audience, mail_effective_filters(v_c))
       WHERE NOT suppressed ORDER BY email, full_name
    ) a
  ON CONFLICT DO NOTHING;

  SELECT count(*) INTO v_count FROM mail_campaign_recipients WHERE campaign_id = p_campaign_id;
  UPDATE mail_campaigns SET recipient_count = v_count WHERE id = p_campaign_id;
  RETURN v_count;
END; $function$;

CREATE OR REPLACE FUNCTION public.mail_mark_recipient(p_id uuid, p_status text, p_message_id text DEFAULT NULL::text, p_error text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_campaign uuid; v_attempts int; v_final text;
BEGIN
  IF NOT mail_can_manage((SELECT r.campaign_id FROM mail_campaign_recipients r WHERE r.id = p_id)) THEN
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
END; $function$;

CREATE OR REPLACE FUNCTION public.mail_preview_audience(p_audience text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_total int; v_suppressed int; v_sendable int;
BEGIN
  IF NOT mail_can_author() THEN
    RAISE EXCEPTION 'You do not have access to email campaigns.';
  END IF;
  -- An employee only ever sees their own book, whatever filters were sent.
  IF NOT nw_current_emp_is_admin() THEN
    p_filters := coalesce(p_filters, '{}'::jsonb) || jsonb_build_object('employee_id', nw_current_employee_id());
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
END; $function$;

