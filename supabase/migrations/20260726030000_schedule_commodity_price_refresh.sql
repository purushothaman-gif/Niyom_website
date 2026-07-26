/*
  # Schedule daily gold/silver price refresh

  The Learning page shows gold (per 10g) and silver (per kg) rates from the
  `commodity_prices` table, populated by the `update-commodity-prices` edge
  function (live source: metalpriceapi.com). That function existed and worked but
  was NEVER scheduled — it had only ever been invoked manually, so the rates froze
  at the last manual run (2026-07-24). This adds the missing pg_cron job.

  Design notes:
  - The function is deployed with verify_jwt = false (see supabase/config.toml), so
    the live-refresh path needs no Authorization token. The manual-write path stays
    guarded in-function by the service-role key.
  - The edge-function URL is HARDCODED here rather than read from
    `current_setting('app.settings.supabase_url')`. Those app.settings.* GUCs are
    NOT configured on this hosted project, so every trigger that relied on them
    (bond-yield-refresh, update-unlisted-shares-prices, nsdl-refresh-cache,
    mf-universe-refresh, hrm-auto-clockout) has been failing with a null URL.
    Hardcoding the (non-secret) project URL makes this job self-contained. The
    project ref is jlmwazuwjnhoqqloyeoj.

  Schedule: once daily at 01:30 UTC (07:00 IST). One reading per day gives the
  widget a clean day-over-day change and keeps well within the metalpriceapi free
  tier. Running at 01:30 UTC also stamps price_date with the current IST date
  (IST = UTC+5:30, so 01:30 UTC is already 07:00 the same calendar day in India).
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION trigger_commodity_price_update()
RETURNS void AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://jlmwazuwjnhoqqloyeoj.supabase.co/functions/v1/update-commodity-prices',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Replace any prior schedule of the same name (idempotent re-runs).
DO $$
BEGIN
  PERFORM cron.unschedule('commodity-price-refresh');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

-- Daily at 01:30 UTC.
SELECT cron.schedule(
  'commodity-price-refresh',
  '30 1 * * *',
  $$SELECT trigger_commodity_price_update()$$
);
