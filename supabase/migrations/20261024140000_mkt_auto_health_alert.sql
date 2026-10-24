/*
  # Tell someone when the daily batch does not land

  ## Why this did not exist and should have

  Three separate faults have taken this pipeline down since August: a GitHub
  secret that was never set, the same secret set to a wrong value, and the
  Anthropic account running out of credit. Between them they cost about eleven
  weeks. Every one of them presented to the user identically — "it stopped
  working" — and each was found only because someone eventually complained
  about a mail.

  The information was always in the database. Nothing read it. The Auto
  Schedule screen shows a red batch, but a screen nobody opens on a good day is
  not a monitor.

  So: one check, after the publish gate, that says which part broke in words an
  admin can act on. It costs one query a day.
*/

/* One alert per run date. A check that re-alerts every time it runs trains
   people to filter it, which is the same as not having it. */
CREATE TABLE IF NOT EXISTS mkt_auto_health_alerts (
  run_date   date PRIMARY KEY,
  live_count integer NOT NULL,
  reason     text NOT NULL,
  alerted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE mkt_auto_health_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mkt_auto_health_alerts_admin_select ON mkt_auto_health_alerts;
CREATE POLICY mkt_auto_health_alerts_admin_select ON mkt_auto_health_alerts
  FOR SELECT TO authenticated USING (nw_current_emp_is_admin());

/*
  Check today's batch and alert if it is not fully live.

  The reason is DERIVED from the slot states rather than reported generically,
  because "the batch failed" is what every one of the three outages already
  looked like. What an admin needs is the next action: top up, fix a secret,
  review a flagged post.
*/
CREATE OR REPLACE FUNCTION mkt_auto_health_check(p_run_date date DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day     date := coalesce(p_run_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_total   integer;
  v_live    integer;
  v_planned integer;
  v_failed  integer;
  v_flagged integer;
  v_norender integer;
  v_err     text;
  v_reason  text;
  v_action  text;
BEGIN
  -- Days with no batch are not a fault: weekends, 2nd/4th/5th Saturdays and
  -- blocked dates are all supposed to be empty.
  IF NOT mkt_auto_is_run_day(v_day)
     OR EXISTS (SELECT 1 FROM mkt_auto_skip_days s WHERE s.run_date = v_day) THEN
    RETURN 'not a run day';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE s.state = 'approved'),
         count(*) FILTER (WHERE s.state = 'planned'),
         count(*) FILTER (WHERE s.state = 'failed'),
         count(*) FILTER (WHERE s.state = 'flagged'),
         count(*) FILTER (WHERE s.state IN ('generated', 'rendered')),
         max(s.error) FILTER (WHERE coalesce(s.error, '') <> '')
  INTO v_total, v_live, v_planned, v_failed, v_flagged, v_norender, v_err
  FROM mkt_auto_slots s WHERE s.run_date = v_day;

  IF v_total = 0 THEN
    v_reason := 'no slots were planned for today';
    v_action := 'The 07:50 IST planner did not run. Check the mkt-auto-plan cron job.';
  ELSIF v_live = v_total THEN
    RETURN 'healthy';                       -- the normal case, silent by design
  ELSIF v_err ILIKE '%credit%' OR v_err ILIKE '%billing%' THEN
    v_reason := 'the Anthropic account is out of credit';
    v_action := 'Top up at console.anthropic.com. The next scheduled run generates normally.';
  ELSIF v_err ILIKE '%API key%' OR v_err ILIKE '%rejected%' THEN
    v_reason := 'the Anthropic API key was rejected';
    v_action := 'Set a fresh ANTHROPIC_API_KEY secret from console.anthropic.com.';
  ELSIF v_planned = v_total THEN
    v_reason := 'nothing was generated';
    v_action := 'The 08:00 IST generator did not run or could not reach Anthropic. '
             || 'Check the mkt-auto-generate cron and the function logs.';
  ELSIF v_norender > 0 THEN
    v_reason := format('%s of %s pieces have no artwork', v_norender, v_total);
    v_action := 'The GitHub render workflow did not complete. '
             || 'Check: select * from mkt_auto_dispatch_status(3);  (204 = GitHub accepted the dispatch)';
  ELSIF v_flagged > 0 THEN
    v_reason := format('%s of %s pieces were held back by the compliance check', v_flagged, v_total);
    v_action := 'Open Marketing Tools -> Content Creation and clear the flagged drafts.';
  ELSE
    v_reason := format('only %s of %s pieces went live', v_live, v_total);
    v_action := 'Open Marketing Tools -> Auto Schedule for the per-slot detail.';
  END IF;

  -- Already told them about today.
  IF EXISTS (SELECT 1 FROM mkt_auto_health_alerts h WHERE h.run_date = v_day) THEN
    RETURN 'already alerted: ' || v_reason;
  END IF;

  PERFORM mkt_auto_alert_admins(
    format('Daily content incomplete — %s of 3 live', v_live),
    format('%s: %s. %s', to_char(v_day, 'DD Mon'), v_reason, v_action));

  INSERT INTO mkt_auto_health_alerts (run_date, live_count, reason)
  VALUES (v_day, v_live, v_reason);

  RETURN 'alerted: ' || v_reason;
END;
$$;

REVOKE ALL ON FUNCTION mkt_auto_health_check(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mkt_auto_health_check(date) TO authenticated, service_role;

/* 04:10 UTC = 09:40 IST: ten minutes after the publish gate, by which point a
   healthy batch is live and anything still missing genuinely is missing. */
SELECT cron.unschedule('mkt-auto-health-check')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mkt-auto-health-check');

SELECT cron.schedule('mkt-auto-health-check', '10 4 * * *',
  $$SELECT mkt_auto_health_check()$$);
