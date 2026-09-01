/*
  # Email Campaigns — close two RPC exposure gaps found by the advisor

  Both are the same root cause: this project GRANTs EXECUTE on new functions to
  `authenticated` by default, so `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon`
  — the phrasing used throughout the bm_/us_ migrations — does NOT take the
  privilege away from a logged-in user. Every RPC that carries its own
  `nw_current_emp_is_admin()` check was unaffected. The two that did not carry
  one were reachable by anybody with a session.

  1. mail_audience_rows was the serious one. It is the shared helper behind the
     audience preview and the materialiser, so by design it has no admin check
     of its own — its callers do. But it is SECURITY DEFINER and returns every
     client's name and email address, and it was callable at
     /rest/v1/rpc/mail_audience_rows by any authenticated role. Verified before
     this fix: a CLIENT logged into the portal read 1 row from nw_clients
     through RLS, and 103 rows through this function. That is the same shape as
     the PAN leak closed on 2026-08-09.

     It is revoked from authenticated entirely rather than given a check.
     Nothing outside the database should ever call it, and its two internal
     callers are SECURITY DEFINER functions that execute as the owner, so they
     are unaffected by the revoke.

  2. mail_log_event writes the approval and send audit trail. No data leak, but
     without a check any authenticated user could insert rows into it — and the
     trail's whole job is to say who approved a blast to every client. A forged
     entry there is worth more to an attacker than a read.

  Also pins search_path on the two functions that were missing it.
*/

-- 1. The audience helper: internal use only. ------------------------------
REVOKE ALL ON FUNCTION mail_audience_rows(text, jsonb) FROM PUBLIC, anon, authenticated;

-- 2. The audit trail must only be writable by the people it names. ---------
CREATE OR REPLACE FUNCTION mail_log_event(
  p_campaign_id uuid, p_event_type text, p_note text DEFAULT '', p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no text;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only administrators can write to the campaign audit trail.';
  END IF;
  SELECT campaign_no INTO v_no FROM mail_campaigns WHERE id = p_campaign_id;
  INSERT INTO mail_events (campaign_id, campaign_no, event_type, actor_employee_id, note, metadata)
  VALUES (p_campaign_id, coalesce(v_no,''), p_event_type, nw_current_employee_id(),
          coalesce(p_note,''), coalesce(p_metadata,'{}'::jsonb));
END; $$;

REVOKE ALL ON FUNCTION mail_log_event(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mail_log_event(uuid, text, text, jsonb) TO authenticated;

-- 3. search_path on the two remaining functions. --------------------------
-- mail_next_campaign_no stays executable by authenticated: it is a column
-- DEFAULT, which is evaluated as the INSERTing user, so revoking it would stop
-- an admin creating a campaign. It reveals nothing — the worst an unauthorised
-- caller achieves is consuming a sequence number.
CREATE OR REPLACE FUNCTION mail_next_campaign_no()
RETURNS text LANGUAGE sql SET search_path = public AS $$
  SELECT 'CMP-' || lpad(nextval('mail_campaign_no_seq')::text, 5, '0');
$$;
REVOKE ALL ON FUNCTION mail_next_campaign_no() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mail_next_campaign_no() TO authenticated;

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
  ) THEN
    NEW.status      := 'draft';
    NEW.approved_by := NULL;
    NEW.approved_at := NULL;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION mail_unapprove_on_edit() FROM PUBLIC, anon, authenticated;
