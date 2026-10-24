/*
  # Trigger the render workflow from pg_cron instead of GitHub's scheduler

  ## Why

  GitHub's `schedule` event is not dispatched on time for this repository. Eight
  consecutive days measured 274-345 minutes of delay against a 03:20 UTC cron —
  roughly five hours, every day, consistently.

  The window the render worker has to hit is 65 minutes wide: generation
  finishes at 02:55 UTC and the publish gate is 04:00 UTC (09:30 IST). A
  five-hour queue cannot land inside a one-hour window no matter how the cron is
  written, so artwork would arrive four to five hours after employees could
  already see the content. The pipeline would report success while missing the
  only deadline that was actually specified.

  `workflow_dispatch` is not queued the way `schedule` is: it runs promptly. And
  pg_cron on this database is punctual — the generator has fired at 08:00 IST
  every day without fail. So the trigger moves to the mechanism that keeps time,
  and GitHub keeps doing the part it does well.

  ## The credential

  A fine-grained GitHub token with Actions: read and write on this one
  repository, held in Supabase Vault under `github_actions_token`. It is created
  out of band and deliberately not in version control, same as every other vault
  secret here.

  Worth stating plainly, given this project's history: this ADDS a credential,
  and uncontrolled secret copies are exactly what caused two long outages. The
  difference is that this one lives in exactly one place and is written by a
  script rather than pasted into a web form by hand — the step that failed both
  times.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

/*
  Dispatches are fire-and-forget: pg_net is asynchronous, so the function
  returns a request id rather than a result. Without somewhere to put that id, a
  rejected token would fail completely silently — which is precisely the failure
  mode that has already cost this project nine weeks.
*/
CREATE TABLE IF NOT EXISTS mkt_auto_dispatch_log (
  id           bigserial PRIMARY KEY,
  run_date     date NOT NULL,
  request_id   bigint,
  requested_at timestamptz NOT NULL DEFAULT now(),
  note         text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_mkt_auto_dispatch_log_requested
  ON mkt_auto_dispatch_log (requested_at DESC);

ALTER TABLE mkt_auto_dispatch_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mkt_auto_dispatch_log_admin_select ON mkt_auto_dispatch_log;
CREATE POLICY mkt_auto_dispatch_log_admin_select ON mkt_auto_dispatch_log
  FOR SELECT TO authenticated USING (nw_current_emp_is_admin());

CREATE OR REPLACE FUNCTION trigger_mkt_render_dispatch()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_token text;
  v_req   bigint;
  v_day   date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  -- Nothing to render on a day with no batch; do not spend a dispatch on it.
  IF NOT EXISTS (
    SELECT 1 FROM mkt_auto_slots s
    WHERE s.run_date = v_day
      AND s.content_id IS NOT NULL
      AND s.state IN ('generated', 'flagged')
  ) THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'github_actions_token';

  IF v_token IS NULL THEN
    RAISE EXCEPTION 'github_actions_token is not in the vault — the render workflow cannot be dispatched';
  END IF;

  /*
    The GitHub API rejects requests without a User-Agent, which pg_net does not
    set for us. X-GitHub-Api-Version pins the response shape. A successful
    dispatch answers 204 with no body.
  */
  SELECT net.http_post(
    url := 'https://api.github.com/repos/purushothaman-gif/Niyom_website/actions/workflows/mkt-render.yml/dispatches',
    headers := jsonb_build_object(
      'Accept', 'application/vnd.github+json',
      'Authorization', 'Bearer ' || v_token,
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'niyom-mkt-render-dispatch',
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object('ref', 'niyom-main'),
    timeout_milliseconds := 20000
  ) INTO v_req;

  INSERT INTO mkt_auto_dispatch_log (run_date, request_id) VALUES (v_day, v_req);
END;
$function$;

REVOKE ALL ON FUNCTION trigger_mkt_render_dispatch() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION trigger_mkt_render_dispatch() IS
  'Dispatches the GitHub render workflow using the vault-held fine-grained token. Called only by pg_cron.';

/* What the dispatch actually returned, once pg_net has the response. GitHub
   answers 204 on success; 401 means the token is wrong or expired, 403 means it
   lacks Actions: write, 404 means it cannot see the repository. */
CREATE OR REPLACE FUNCTION mkt_auto_dispatch_status(p_limit integer DEFAULT 10)
RETURNS TABLE (requested_at timestamptz, run_date date, status_code integer, response text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.requested_at, d.run_date, r.status_code, left(coalesce(r.content, ''), 300)
  FROM mkt_auto_dispatch_log d
  LEFT JOIN net._http_response r ON r.id = d.request_id
  ORDER BY d.requested_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION mkt_auto_dispatch_status(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mkt_auto_dispatch_status(integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schedule
--
-- 03:20 UTC = 08:50 IST, 25 minutes after generation finishes and 40 minutes
-- before the publish gate. The retry at 03:40 UTC covers a transient failure;
-- a second dispatch is harmless because the worker claims work and a run with
-- nothing to claim exits green.
-- ---------------------------------------------------------------------------

SELECT cron.unschedule('mkt-render-dispatch')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mkt-render-dispatch');

SELECT cron.unschedule('mkt-render-dispatch-retry')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mkt-render-dispatch-retry');

SELECT cron.schedule('mkt-render-dispatch', '20 3 * * *',
  $$SELECT trigger_mkt_render_dispatch()$$);

SELECT cron.schedule('mkt-render-dispatch-retry', '40 3 * * *',
  $$SELECT trigger_mkt_render_dispatch()$$);
