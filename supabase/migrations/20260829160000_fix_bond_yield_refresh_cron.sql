-- Fix the bond-yield-refresh cron. It built the edge-function URL + auth from
-- app.settings.* database settings that are unset in this project (setting them is
-- permission-denied for the available role), so net.http_post received a NULL url
-- and the job failed on every run (288/288 over 2 days). The stale-recompute sweep
-- only recomputes ALREADY-STORED analytics — no external calls, no data exposure,
-- idempotent — so bond-enrich now accepts it with the public anon key, and this
-- trigger calls it with a hardcoded URL + the anon key (public; ships in the app).
CREATE OR REPLACE FUNCTION public.trigger_bond_yield_refresh()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $fn$
BEGIN
  PERFORM net.http_post(
    url := 'https://jlmwazuwjnhoqqloyeoj.supabase.co/functions/v1/bond-enrich',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpsbXdhenV3am5ob3FxbG95ZW9qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MzYzMDcsImV4cCI6MjA4NjMxMjMwN30.TzgP4BJURpNOdYkKadS035aJCYwBnfoPLJ4IPIlKuHA'
    ),
    body := '{"recompute":true,"stale":true}'::jsonb
  );
END;
$fn$;
