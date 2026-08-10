-- Schedule the rolling trailing-returns backfill for the scheme universe.
--
-- The URL is hardcoded and the secret comes from the vault, matching
-- trigger_nav_refresh. app.settings.* GUCs are NOT set on this project, so the
-- older current_setting() style silently produced a null URL and every job
-- failed quietly — see trigger_commodity_price_update for the same fix.
--
-- Every 15 minutes looks aggressive for data that changes daily, and would be
-- if the function swept the table. It does not: mf-returns-backfill skips any
-- scheme computed in the last FRESH_HOURS, so these runs do real work only
-- while the universe is behind (the initial ~5,000-scheme backfill, and the
-- daily catch-up after AMFI publishes). The rest return "queue empty" from a
-- single indexed query.

CREATE OR REPLACE FUNCTION public.trigger_mf_returns_backfill()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'nav_refresh_secret';

  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'nav_refresh_secret is not in the vault — the returns backfill cannot authenticate';
  END IF;

  PERFORM net.http_post(
    url := 'https://jlmwazuwjnhoqqloyeoj.supabase.co/functions/v1/mf-returns-backfill',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-nav-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
END;
$function$;

SELECT cron.unschedule('mf-returns-backfill')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mf-returns-backfill');

SELECT cron.schedule(
  'mf-returns-backfill',
  '*/15 * * * *',
  $$SELECT trigger_mf_returns_backfill()$$
);
