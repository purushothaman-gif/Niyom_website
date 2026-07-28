/*
  # Marketing Tool — schedule the content expiry sweep

  Runs mkt-expire-content every 10 minutes.

  ## What the schedule does and does not control
  Employee VISIBILITY ends exactly at expires_at — that is enforced by the RLS
  predicate on mkt_content (`expires_at > now()`), not by this job, so approved
  content stops being readable at the 48-hour mark to the second. This schedule
  governs only how quickly the rows and the storage objects are physically
  erased afterwards: never more than ~10 minutes later. Signed URLs are minted
  with a 120-second TTL, so any link handed out before expiry has also lapsed
  well within that window.

  ## Hardcoded URL — deliberate
  The app.settings.supabase_url / service_role_key GUCs this project once relied
  on are NOT configured on the hosted instance. Jobs using them silently posted
  to a null URL and never ran. The fix, established in
  20260726030000_schedule_commodity_price_refresh.sql and
  20260726160000_fix_nsdl_mf_cron_urls.sql, is to hardcode the (non-secret)
  project URL and pair it with a verify_jwt = false function. Please do not
  "restore" the GUC form.

  Anonymous invocation of that endpoint is harmless: the cron path only deletes
  content already past expires_at — work this schedule would do minutes later
  anyway. The admin single-delete path inside the same function independently
  requires an admin JWT.

  ## Safety
  Idempotent: extensions are IF NOT EXISTS, the function is CREATE OR REPLACE,
  and the job is unscheduled inside an exception-swallowing DO block before
  being rescheduled.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION trigger_mkt_expire_content()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://jlmwazuwjnhoqqloyeoj.supabase.co/functions/v1/mkt-expire-content',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{"source":"cron"}'::jsonb
  );
END;
$$;

-- Only pg_cron (running as the job owner) needs this.
REVOKE ALL ON FUNCTION trigger_mkt_expire_content() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('mkt-expire-content');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'mkt-expire-content',
  '*/10 * * * *',
  $$SELECT trigger_mkt_expire_content()$$
);
