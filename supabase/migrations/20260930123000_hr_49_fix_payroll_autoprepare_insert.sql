-- =============================================================================
-- hr_cron_payroll_autoprepare could never insert a run.
--
-- Its INSERT names nine columns and supplies eight values -- prepared_at has
-- no expression -- so Postgres refused the statement outright: "INSERT has
-- more target columns than expressions". The job failed on 2026-09-30 at
-- 03:30, the first time it actually reached the INSERT.
--
-- It had succeeded on every previous run only because it returns early on any
-- day that is not the pay-schedule trigger day, and on a trigger day when the
-- run already exists. A cron job reporting success for a month because it did
-- nothing is indistinguishable, from the outside, from one that worked.
--
-- prepared_at is set to now() and prepared_by left NULL, which is what an
-- automatically prepared run is: nobody prepared it.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hr_cron_payroll_autoprepare()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  sched     record;
  v_today   date := hr_today();
  v_year    smallint := EXTRACT(YEAR  FROM hr_today())::smallint;
  v_month   smallint := EXTRACT(MONTH FROM hr_today())::smallint;
  v_trigger date;
  v_run_id  uuid;
  v_count   integer;
  v_on      boolean;
BEGIN
  SELECT notify_payroll_ready INTO v_on FROM hr_settings WHERE id = 1;
  IF NOT COALESCE(v_on, true) THEN RETURN jsonb_build_object('skipped', 'notifications off'); END IF;

  SELECT * INTO sched FROM hr_pay_schedules WHERE is_default AND active LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('skipped', 'no default pay schedule'); END IF;

  v_trigger := CASE sched.last_working_day_rule
    WHEN 'last_calendar_day' THEN (make_date(v_year, v_month, 1) + interval '1 month - 1 day')::date
    WHEN 'fixed_day'         THEN make_date(v_year, v_month, LEAST(
                                    COALESCE(sched.last_working_fixed_day, 28),
                                    EXTRACT(DAY FROM (make_date(v_year, v_month, 1) + interval '1 month - 1 day'))::int))
    ELSE hr_last_working_day(v_year, v_month, NULL, 'Chennai')
  END;

  IF v_today <> v_trigger THEN
    RETURN jsonb_build_object('skipped', 'not the trigger day', 'trigger', v_trigger);
  END IF;

  SELECT id INTO v_run_id FROM hr_payroll_runs
   WHERE period_year = v_year AND period_month = v_month
     AND pay_schedule_id IS NOT DISTINCT FROM sched.id;

  IF FOUND THEN
    RETURN jsonb_build_object('skipped', 'run already exists', 'run_id', v_run_id);
  END IF;

  INSERT INTO hr_payroll_runs (
    period_year, period_month, pay_schedule_id, period_start, period_end,
    status, lop_divisor_mode, calendar_days, prepared_at)
  VALUES (
    v_year, v_month, sched.id,
    make_date(v_year, v_month, 1),
    (make_date(v_year, v_month, 1) + interval '1 month - 1 day')::date,
    'draft', sched.lop_divisor_mode,
    EXTRACT(DAY FROM (make_date(v_year, v_month, 1) + interval '1 month - 1 day'))::smallint,
    -- The missing value. Nobody prepared this run, so prepared_by stays NULL.
    now())
  RETURNING id INTO v_run_id;

  SELECT count(*) INTO v_count FROM nw_employees WHERE status = 'active';

  INSERT INTO hr_payroll_events (run_id, event, actor_name, reason)
  VALUES (v_run_id, 'opened', 'system', 'Automatically prepared on the last working day.');

  PERFORM nw_notify_admins(
    'Payroll ready to review',
    to_char(make_date(v_year, v_month, 1), 'FMMonth YYYY') || ' payroll has been prepared for '
      || v_count || ' employees. Review and approve it before salaries are released.',
    'hr', NULL, '/crm/hr_payroll');

  RETURN jsonb_build_object('ok', true, 'run_id', v_run_id, 'employees', v_count);
END;
$$;
