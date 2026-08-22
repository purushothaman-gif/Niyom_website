-- =============================================================================
-- NIYOM HR & PAYROLL -- 13: scheduled jobs
--
-- Pure SQL, no HTTP. This project's pg_cron -> Edge Function bridge is broken
-- (the app.settings.* GUCs it reads are unset), so every job here does its work
-- in the database, the way nw_lead_process_reminders() already does.
--
-- pg_cron fires in UTC; the schedules below are offset to land at the intended
-- IST time.
-- =============================================================================

-- Last working day of a month for a given schedule + holiday location.
CREATE OR REPLACE FUNCTION public.hr_last_working_day(
  p_year smallint, p_month smallint, p_schedule_id uuid DEFAULT NULL, p_location text DEFAULT 'Chennai'
) RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  d     date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  first date := make_date(p_year, p_month, 1);
BEGIN
  WHILE d >= first LOOP
    IF NOT hr_is_weekly_off(p_schedule_id, d) AND hr_is_holiday(p_location, d) IS NULL THEN
      RETURN d;
    END IF;
    d := d - 1;
  END LOOP;
  RETURN (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
END;
$$;

-- --- Nightly: rebuild yesterday, accrue leave on the 1st ---------------------

CREATE OR REPLACE FUNCTION public.hr_cron_nightly()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_yday    date := hr_today() - 1;
  v_days    integer := 0;
  v_accrued integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hr_attendance_settings WHERE id = 1) THEN
    RETURN jsonb_build_object('skipped', 'not configured');
  END IF;

  -- Yesterday is now final: anyone who never punched settles as absent, and a
  -- forgotten punch-out is flagged.
  v_days := hr_recompute_all_for_date(v_yday);

  -- Monthly accrual, on the 1st only. hr_accrue_leave is idempotent per month,
  -- so a retry or a double fire cannot credit twice.
  IF EXTRACT(DAY FROM hr_today()) = 1 THEN
    v_accrued := hr_accrue_leave(hr_today());
  END IF;

  RETURN jsonb_build_object('date', v_yday, 'recomputed', v_days, 'accrued', v_accrued);
END;
$$;

-- --- Evening: nudge anyone still punched in ---------------------------------

CREATE OR REPLACE FUNCTION public.hr_cron_punch_reminders()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n integer := 0; v_on boolean;
BEGIN
  SELECT notify_missing_punch INTO v_on FROM hr_settings WHERE id = 1;
  IF NOT COALESCE(v_on, true) THEN RETURN 0; END IF;

  INSERT INTO nw_alerts (employee_id, title, message, category, action_url)
  SELECT d.employee_id, 'Punch out reminder',
         'You are still punched in for today. Remember to punch out before you leave.',
         'hr', '/crm/my_hr'
  FROM hr_attendance_daily d
  WHERE d.work_date = hr_today()
    AND d.first_in_at IS NOT NULL
    AND d.last_out_at IS NULL
    -- Do not repeat the nudge within the same day.
    AND NOT EXISTS (
      SELECT 1 FROM nw_alerts a
      WHERE a.employee_id = d.employee_id
        AND a.category = 'hr'
        AND a.title = 'Punch out reminder'
        AND a.created_at > hr_today()::timestamptz);

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- --- Month end: open the run and tell the admins ----------------------------
-- Deliberately does NO arithmetic and releases NO money. It opens a draft and
-- raises "Payroll Ready -- review it"; a human computes, reviews and approves.

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
    EXTRACT(DAY FROM (make_date(v_year, v_month, 1) + interval '1 month - 1 day'))::smallint)
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

REVOKE ALL ON FUNCTION public.hr_cron_nightly()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_cron_punch_reminders()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_cron_payroll_autoprepare() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_last_working_day(smallint, smallint, uuid, text) TO authenticated;

-- --- Schedules (UTC; IST = UTC + 5:30) --------------------------------------

SELECT cron.schedule('hr-nightly-summary',    '30 19 * * *', $$SELECT hr_cron_nightly()$$);
SELECT cron.schedule('hr-punch-reminders',    '30 12 * * *', $$SELECT hr_cron_punch_reminders()$$);
SELECT cron.schedule('hr-payroll-autoprepare','30 03 * * *', $$SELECT hr_cron_payroll_autoprepare()$$);