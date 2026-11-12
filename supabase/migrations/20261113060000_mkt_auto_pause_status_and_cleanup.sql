/*
  # Automated content: report the pause, and clear the plan it left behind

  The engine was retired on 2026-11-07 — all six of its cron jobs were
  unscheduled, while the data, the schema and the code were deliberately kept so
  the decision stays reversible.

  Two consequences needed tidying.

  ## 1. A paused system was displaying alarms

  The last plan_ahead(14) before retirement booked two weeks of future days.
  With no planner or generator left, those days can never advance past
  'planned', so the Auto Schedule strip rendered every one of them red —
  "Nothing live, needs attention" — for three weeks. An alarm that fires for a
  system somebody switched off on purpose is how people learn to ignore alarms.

  mkt_auto_automation_status() lets the UI say "paused" instead, and it reads
  the live cron schedule rather than a flag someone has to remember to set.
  That matters here specifically: nearly every outage this module suffered came
  from two copies of one fact drifting apart. A derived answer cannot drift.

  ## 2. The orphaned plan is deleted

  51 slots across 17 days, none of which will ever generate. Their categories
  are handed back to the rotation unconsumed, so a future restart begins with a
  clean cycle rather than 51 categories mysteriously already spent.

  Generated content, history, assets and analytics are untouched.
*/

-- ---------------------------------------------------------------------------
-- 1. Is the automation actually running?
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION mkt_auto_automation_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_jobs text[];
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  /* The jobs the engine needs to function. mkt-expire-content is deliberately
     excluded: the 48/72h sweep must keep running whether or not anything is
     being generated, so its presence says nothing about automation. */
  SELECT coalesce(array_agg(j.jobname ORDER BY j.jobname), '{}')
  INTO v_jobs
  FROM cron.job j
  WHERE j.active
    AND j.jobname IN ('mkt-auto-plan', 'mkt-auto-generate', 'mkt-auto-generate-late',
                      'mkt-render-dispatch', 'mkt-render-dispatch-retry',
                      'mkt-auto-health-check');

  RETURN jsonb_build_object(
    'enabled', array_length(v_jobs, 1) IS NOT NULL,
    'jobs', to_jsonb(v_jobs),
    'expected', to_jsonb(ARRAY['mkt-auto-plan', 'mkt-auto-generate', 'mkt-auto-generate-late',
                               'mkt-render-dispatch', 'mkt-render-dispatch-retry',
                               'mkt-auto-health-check'])
  );
END;
$$;

REVOKE ALL ON FUNCTION mkt_auto_automation_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mkt_auto_automation_status() TO authenticated, service_role;

COMMENT ON FUNCTION mkt_auto_automation_status() IS
  'Whether the daily content automation is scheduled, derived from cron.job rather than a stored flag.';

-- ---------------------------------------------------------------------------
-- 2. Clear the plan the retirement left behind
-- ---------------------------------------------------------------------------

/* Hand the categories back, so a restart does not begin with 51 of them
   already marked used by days that produced nothing. */
UPDATE mkt_auto_category_cycle c
SET consumed_at = NULL, run_date = NULL
WHERE c.run_date IN (
  SELECT DISTINCT s.run_date FROM mkt_auto_slots s
  WHERE s.state = 'planned' AND s.content_id IS NULL
);

DELETE FROM mkt_auto_slots s
WHERE s.state = 'planned' AND s.content_id IS NULL;

/* Batches with no slots left are empty shells; the strip would still draw a
   row for each. Only ever removes days that produced nothing. */
DELETE FROM mkt_auto_batches b
WHERE NOT EXISTS (SELECT 1 FROM mkt_auto_slots s WHERE s.run_date = b.run_date);
