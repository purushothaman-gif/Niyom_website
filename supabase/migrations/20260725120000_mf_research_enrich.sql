/*
  # MF Research — enrich fund detail + AMFI universe search cache

  Powers the upgraded public MF Research page:

  1. Adds richer metric columns to `mutual_funds` so the curated table + fund
     detail view can show current NAV, a full spread of return periods and the
     fund house. These are populated by the `update-mutual-funds` function from
     mfapi.in NAV history (AUM / expense ratio / manager remain unavailable from
     that free feed and are intentionally left out).

  2. Adds `mf_scheme_cache`, a local mirror of the AMFI Direct-Growth scheme
     universe, so the page can search *every* fund without hitting mfapi.in from
     the browser. Mirrors the `nsdl_securities` cache convention
     (20260716120000): public SELECT, service-role writes, trigram search index,
     daily refresh via pg_cron + pg_net.

  Only additive schema changes; idempotent.
*/

-- ---------------------------------------------------------------------------
-- 1. Richer metric columns on mutual_funds (additive; launch_date + fund_manager
--    already exist from the original schema).
-- ---------------------------------------------------------------------------
ALTER TABLE mutual_funds ADD COLUMN IF NOT EXISTS return_ytd   numeric DEFAULT 0;
ALTER TABLE mutual_funds ADD COLUMN IF NOT EXISTS return_6m    numeric DEFAULT 0;
ALTER TABLE mutual_funds ADD COLUMN IF NOT EXISTS return_si    numeric DEFAULT 0;
ALTER TABLE mutual_funds ADD COLUMN IF NOT EXISTS current_nav  numeric DEFAULT 0;
ALTER TABLE mutual_funds ADD COLUMN IF NOT EXISTS nav_date     date;
ALTER TABLE mutual_funds ADD COLUMN IF NOT EXISTS fund_house   text;

-- ---------------------------------------------------------------------------
-- 2. AMFI scheme universe cache (Direct-Growth plans), for the universe search.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS mf_scheme_cache (
  scheme_code    text PRIMARY KEY,
  scheme_name    text NOT NULL DEFAULT '',
  fund_house     text NOT NULL DEFAULT '',
  category       text NOT NULL DEFAULT '',
  search_name    text NOT NULL DEFAULT '',
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Fast case-insensitive substring search on the scheme name.
CREATE INDEX IF NOT EXISTS idx_mf_scheme_cache_search_trgm
  ON mf_scheme_cache USING gin (search_name gin_trgm_ops);

ALTER TABLE mf_scheme_cache ENABLE ROW LEVEL SECURITY;

-- Public (anon + authenticated) may read the shared scheme universe — the MF
-- Research page is a public marketing page, like `mutual_funds` itself.
DROP POLICY IF EXISTS "Public can read mf scheme cache" ON mf_scheme_cache;
CREATE POLICY "Public can read mf scheme cache"
  ON mf_scheme_cache FOR SELECT
  TO anon, authenticated
  USING (true);

-- Only the service role (edge functions / cron) writes the cache.
DROP POLICY IF EXISTS "Service role can manage mf scheme cache" ON mf_scheme_cache;
CREATE POLICY "Service role can manage mf scheme cache"
  ON mf_scheme_cache FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 3. Daily refresh of the scheme universe (mirrors 20260716120100_schedule_nsdl_refresh).
--    02:00 UTC (~07:30 IST) — off the slots used by other update jobs.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION trigger_mf_universe_refresh()
RETURNS void AS $$
DECLARE
  function_url text;
BEGIN
  function_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/mf-universe';

  PERFORM net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('action', 'refresh')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Replace any prior schedule of the same name.
DO $$
BEGIN
  PERFORM cron.unschedule('mf-universe-refresh');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

SELECT cron.schedule(
  'mf-universe-refresh',
  '0 2 * * *',
  $$SELECT trigger_mf_universe_refresh()$$
);
