/*
  # Website self-signup leads + admin alerts

  ## Why
  Public-website signups (name + mobile + email + email-OTP) should appear in the
  CRM as SELF-GENERATED leads so the admin can assign an RM, and the admin should
  be alerted when such a client (a) drops off after verifying OTP without finishing
  KYC, or (b) completes onboarding and is ready to be assigned.

  Employee-created clients are unaffected — this is scoped to leads whose
  lead_origin = 'website_signup'.

  Reuses the EXISTING notification system (nw_alerts + the CRM topbar bell).
*/

-- 1. New lead origin for public-website self-signups.
ALTER TABLE nw_leads DROP CONSTRAINT IF EXISTS nw_leads_lead_origin_check;
ALTER TABLE nw_leads ADD CONSTRAINT nw_leads_lead_origin_check
  CHECK (lead_origin IN ('admin_upload','admin_manual','employee_manual','website_signup'));

-- 2. Fan-out helper: insert one nw_alert per active admin/super_admin.
CREATE OR REPLACE FUNCTION nw_notify_admins(
  p_title text, p_message text, p_category text, p_lead_id uuid, p_action_url text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.nw_alerts (employee_id, title, message, category, lead_id, action_url)
  SELECT e.id, p_title, p_message, p_category, p_lead_id, p_action_url
  FROM public.nw_employees e
  WHERE e.role IN ('admin','super_admin') AND e.status = 'active';
END;
$$;
GRANT EXECUTE ON FUNCTION nw_notify_admins(text,text,text,uuid,text) TO authenticated, service_role;

-- 3. Drop detector: a website-signup lead whose client verified OTP
--    (onboarding_status='kyc_in_progress') but hasn't submitted KYC within 1 hour.
--    One 'lead_dropped' alert per admin per lead, deduped so it never repeats.
CREATE OR REPLACE FUNCTION nw_notify_dropped_signups()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.nw_alerts (employee_id, title, message, category, lead_id, action_url)
  SELECT e.id,
         'Lead dropped after OTP',
         c.full_name || ' (' || c.client_code || ') verified OTP but hasn''t completed KYC after 1 hour.',
         'lead_dropped',
         l.id,
         '/crm/leads'
  FROM public.nw_leads l
  JOIN public.nw_clients c ON c.id = l.converted_client_id
  CROSS JOIN public.nw_employees e
  WHERE l.lead_origin = 'website_signup'
    AND c.onboarding_status = 'kyc_in_progress'
    AND c.phone_verified = true
    AND c.created_at < now() - interval '1 hour'
    AND e.role IN ('admin','super_admin') AND e.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM public.nw_alerts a
      WHERE a.lead_id = l.id AND a.category = 'lead_dropped' AND a.employee_id = e.id
    );
END;
$$;
GRANT EXECUTE ON FUNCTION nw_notify_dropped_signups() TO service_role;

-- 4. Run the drop detector every 15 minutes (catches drops ~1h after signup).
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  PERFORM cron.unschedule('detect-dropped-signups');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('detect-dropped-signups', '*/15 * * * *', $$SELECT nw_notify_dropped_signups()$$);
