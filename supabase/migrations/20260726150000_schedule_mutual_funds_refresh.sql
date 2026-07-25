/*
  # Schedule automatic mutual-fund data refresh

  The public MF Research page reads the `mutual_funds` table (curated funds with
  NAV, returns, 52-week high/low), populated by the `update-mutual-funds` edge
  function from mfapi.in. Until now that function was only ever invoked by a
  manual "Update data" button on the page, so the data went stale whenever nobody
  clicked it. That button has been removed from the UI in favour of this cron job,
  so the dataset now refreshes on its own with no user action.

  Design notes (mirrors 20260726030000_schedule_commodity_price_refresh.sql):
  - `update-mutual-funds` is deployed with verify_jwt = false (see
    supabase/config.toml), so the refresh needs no Authorization token.
  - The edge-function URL is HARDCODED here rather than read from
    `current_setting('app.settings.supabase_url')`. Those app.settings.* GUCs are
    NOT configured on this hosted project, so every trigger that relied on them
    failed with a null URL. Hardcoding the (non-secret) project URL makes this job
    self-contained. Project ref: jlmwazuwjnhoqqloyeoj.

  Schedule: once daily at 02:00 UTC (07:30 IST). AMFI publishes each day's final
  NAV the previous night IST, so an early-morning IST run captures the latest
  values. One run/day is plenty (NAVs move once daily) and keeps the job light.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION trigger_mutual_funds_update()
RETURNS void AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://jlmwazuwjnhoqqloyeoj.supabase.co/functions/v1/update-mutual-funds',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Replace any prior schedule of the same name (idempotent re-runs).
DO $$
BEGIN
  PERFORM cron.unschedule('mutual-funds-refresh');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

-- Daily at 02:00 UTC.
SELECT cron.schedule(
  'mutual-funds-refresh',
  '0 2 * * *',
  $$SELECT trigger_mutual_funds_update()$$
);
