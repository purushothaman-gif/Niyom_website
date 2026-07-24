/*
  # Automatic server-side bond yield refresh

  The daily price upload (bm_import_prices) updates latest_price + price_updated_at but does
  not recompute analytics; the browser-side recompute after import is best-effort (only runs
  while the import screen stays open). This adds a guaranteed server-side refresh so yields
  reconcile to the latest price with no manual step and no dependency on the tab.

  Reuses the existing pg_cron + pg_net pattern (see 20260716120100_schedule_nsdl_refresh.sql):
  every 10 min a SECURITY DEFINER function POSTs to the bond-enrich edge function in
  { recompute:true, stale:true } mode. The function recomputes ONLY bonds whose price is newer
  than their analytics (via bm_stale_bonds below), so it is normally zero work and just clears
  the backlog after an upload.

  Schedule: every 10 minutes. Off the 00:00 / 01:00 / 02:00 UTC slots used by the other jobs.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Stale-bond selector. Column-to-column comparison (price newer than analytics) can't be
-- expressed in a PostgREST filter, so it lives here. Returns full rows for the edge function
-- to recompute. Restricted to service_role — it returns internal columns (landing_cost etc.)
-- and must never be callable by staff/anon.
CREATE OR REPLACE FUNCTION bm_stale_bonds(p_limit int DEFAULT 100)
RETURNS SETOF bm_bonds
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM bm_bonds
  WHERE active_status = 'active'
    AND (analytics_computed_at IS NULL OR price_updated_at > analytics_computed_at)
  ORDER BY price_updated_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 500));
$$;

REVOKE ALL ON FUNCTION bm_stale_bonds(int) FROM PUBLIC;
DO $$ BEGIN
  EXECUTE 'REVOKE ALL ON FUNCTION bm_stale_bonds(int) FROM anon, authenticated';
EXCEPTION WHEN OTHERS THEN NULL; END $$;
GRANT EXECUTE ON FUNCTION bm_stale_bonds(int) TO service_role;

-- pg_cron trigger: POST to bond-enrich as the service role (which the function accepts as a
-- trusted cron caller, bypassing the staff gate).
CREATE OR REPLACE FUNCTION trigger_bond_yield_refresh()
RETURNS void AS $$
DECLARE
  function_url text;
BEGIN
  function_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/bond-enrich';

  PERFORM net.http_post(
    url := function_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"recompute":true,"stale":true}'::jsonb
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Replace any prior schedule of the same name.
DO $$
BEGIN
  PERFORM cron.unschedule('bond-yield-refresh');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

-- Every 10 minutes.
SELECT cron.schedule(
  'bond-yield-refresh',
  '*/10 * * * *',
  $$SELECT trigger_bond_yield_refresh()$$
);
