/*
  # Fix nsdl-refresh-cache & mf-universe-refresh crons (null-GUC url bug)

  Both trigger fns read current_setting('app.settings.supabase_url'/'service_role_key'),
  which are unset on this hosted project → every run failed with
  `null value in column "url" of relation "http_request_queue"`.

  Both target edge functions are verify_jwt=false (public: pg_cron / the public MF
  page reach them without a session), so the fix mirrors the commodity job:
  hardcode the non-secret project URL and drop the Authorization header entirely.
  Project ref: jlmwazuwjnhoqqloyeoj.

  These stay scheduled crons (no event-driven alternative): nsdl-search only fills
  cache misses (never refreshes hits), and the MF page only searches the cache
  (never repopulates it) — so the cron is the sole refresh mechanism for each.
*/

CREATE OR REPLACE FUNCTION public.trigger_nsdl_refresh()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://jlmwazuwjnhoqqloyeoj.supabase.co/functions/v1/nsdl-refresh-cache',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_mf_universe_refresh()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://jlmwazuwjnhoqqloyeoj.supabase.co/functions/v1/mf-universe',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('action', 'refresh')
  );
END;
$$;
