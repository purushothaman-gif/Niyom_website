-- =============================================================================
-- Permission: short leave of an hour or two, with a monthly paid allowance.
--
-- WHY NOT A LEAVE TYPE. Leave here is day-shaped -- hr_leave_days.portion is
-- CHECKed to 0.50 or 1.00, and balances accrue yearly in days. Permission is
-- hour-shaped with a MONTHLY allowance, and forcing it through the leave
-- tables would mean either lying about portions or widening the leave balance
-- semantics for a thing that is not leave. It gets its own table and its own
-- allowance, and leaves the leave module alone.
--
-- HOW IT REACHES PAY. An approved, paid permission credits its minutes toward
-- the day's full-day threshold, so someone who worked seven hours with an hour
-- of permission still settles as PRESENT instead of half_day. The credit is
-- used ONLY for that threshold:
--
--   * worked_minutes still records the hours actually worked, so the register
--     stays truthful about what happened;
--   * overtime is measured against the real figure, so an hour of permission
--     can never manufacture an hour of overtime.
--
-- THE ALLOWANCE ENFORCES ITSELF. Approving within the monthly allowance marks
-- the request paid and credits it; beyond the allowance it is approved UNPAID
-- and credits nothing, so the short day falls through to half_day or absent on
-- its own. There is no separate deduction to keep in step, and an admin can
-- still force paid with a reason.
--
-- 120 minutes a month is the common standard here; it is a setting, not a
-- constant, because it is a policy question.
-- =============================================================================

ALTER TABLE public.hr_attendance_settings
  ADD COLUMN IF NOT EXISTS permission_monthly_minutes smallint NOT NULL DEFAULT 120
    CHECK (permission_monthly_minutes BETWEEN 0 AND 2400),
  ADD COLUMN IF NOT EXISTS permission_max_per_request_minutes smallint NOT NULL DEFAULT 240
    CHECK (permission_max_per_request_minutes BETWEEN 30 AND 480),
  -- Off = the allowance is advisory: excess is still approved and still paid,
  -- just reported. On = excess is approved unpaid and docks the day.
  ADD COLUMN IF NOT EXISTS permission_enforce_allowance boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.hr_attendance_settings.permission_monthly_minutes IS
  'Paid short-leave allowance per calendar month, in minutes. 120 = two hours.';

CREATE TABLE IF NOT EXISTS public.hr_permission_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,
  work_date     date NOT NULL,
  -- Minutes, not a day portion. 60 / 120 / 240 are what the screen offers,
  -- but the column holds any sane value so a policy change needs no migration.
  minutes       smallint NOT NULL CHECK (minutes BETWEEN 15 AND 480),
  start_time    time,
  reason        text NOT NULL CHECK (length(btrim(reason)) >= 3),

  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  -- NULL until decided. Set by the allowance at approval, overridable.
  paid          boolean,

  applied_at    timestamptz NOT NULL DEFAULT now(),
  approver_id   uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  decided_at    timestamptz,
  decision_note text NOT NULL DEFAULT '',
  cancelled_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One live request per person per day. Two half-hours on one day is a thing
-- people would do by accident far more often than on purpose.
CREATE UNIQUE INDEX IF NOT EXISTS hr_permission_one_live_per_day
  ON public.hr_permission_requests (employee_id, work_date)
  WHERE status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS hr_permission_month_idx
  ON public.hr_permission_requests (employee_id, work_date);

DROP TRIGGER IF EXISTS hr_permission_touch ON public.hr_permission_requests;
CREATE TRIGGER hr_permission_touch BEFORE UPDATE ON public.hr_permission_requests
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

COMMENT ON TABLE public.hr_permission_requests IS
  'Short leave (an hour or two) against a monthly paid allowance. Approved and paid requests credit their minutes toward the day''s full-day threshold; worked_minutes and overtime still reflect the hours actually worked.';

ALTER TABLE public.hr_permission_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_permission_read ON public.hr_permission_requests
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT nw_current_employee_id()) OR (SELECT hr_can_view('attendance')));

-- An employee may RAISE their own, and nothing more: no status, no paid flag,
-- no editing after the fact. Deciding is hr_review_permission's job.
CREATE POLICY hr_permission_insert_self ON public.hr_permission_requests
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = (SELECT nw_current_employee_id())
              AND status = 'pending' AND paid IS NULL);

CREATE POLICY hr_permission_write ON public.hr_permission_requests
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('attendance'))) WITH CHECK ((SELECT hr_can_edit('attendance')));


-- --- How much of the month's allowance is already spent ----------------------

CREATE OR REPLACE FUNCTION public.hr_permission_used_minutes(
  p_employee_id uuid, p_date date, p_exclude uuid DEFAULT NULL
) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT COALESCE(SUM(minutes), 0)::integer
  FROM hr_permission_requests
  WHERE employee_id = p_employee_id
    AND status = 'approved'
    AND COALESCE(paid, false)
    AND work_date >= date_trunc('month', p_date)::date
    AND work_date <  (date_trunc('month', p_date) + interval '1 month')::date
    AND (p_exclude IS NULL OR id <> p_exclude);
$$;

-- --- What the employee's screen needs to show before they ask ---------------

CREATE OR REPLACE FUNCTION public.hr_permission_summary(p_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_emp   uuid := nw_current_employee_id();
  v_date  date := COALESCE(p_date, hr_today());
  s       record;
  v_used  integer;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record for this login.' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO s FROM hr_attendance_settings WHERE id = 1;
  v_used := hr_permission_used_minutes(v_emp, v_date);

  RETURN jsonb_build_object(
    'month',            to_char(v_date, 'FMMonth YYYY'),
    'allowance_minutes', COALESCE(s.permission_monthly_minutes, 120),
    'used_minutes',      v_used,
    'remaining_minutes', GREATEST(0, COALESCE(s.permission_monthly_minutes, 120) - v_used),
    'max_per_request',   COALESCE(s.permission_max_per_request_minutes, 240),
    'enforced',          COALESCE(s.permission_enforce_allowance, true),
    'pending',          (SELECT count(*) FROM hr_permission_requests
                          WHERE employee_id = v_emp AND status = 'pending'));
END;
$$;


-- --- Raise one ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hr_request_permission(
  p_work_date date, p_minutes integer, p_start_time time, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_emp  uuid := nw_current_employee_id();
  s      record;
  prof   record;
  v_id   uuid;
  v_used integer;
BEGIN
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'No employee record for this login.' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO s FROM hr_attendance_settings WHERE id = 1;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Give a reason for the permission.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_minutes IS NULL OR p_minutes < 15 THEN
    RAISE EXCEPTION 'Choose how long you need.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_minutes > COALESCE(s.permission_max_per_request_minutes, 240) THEN
    RAISE EXCEPTION 'The longest permission allowed is % minutes. For more than that, apply for leave.',
      s.permission_max_per_request_minutes USING ERRCODE = 'check_violation';
  END IF;

  -- A day nobody is expected to work needs no permission to miss.
  SELECT e.joining_date, pr.exit_date, COALESCE(pr.holiday_location,'Chennai') AS holiday_location,
         pr.work_schedule_id
    INTO prof
  FROM nw_employees e LEFT JOIN hr_employee_profiles pr ON pr.employee_id = e.id
  WHERE e.id = v_emp;

  IF hr_is_holiday(prof.holiday_location, p_work_date) IS NOT NULL THEN
    RAISE EXCEPTION 'That day is a holiday.' USING ERRCODE = 'check_violation';
  END IF;
  IF hr_is_weekly_off(prof.work_schedule_id, p_work_date) THEN
    RAISE EXCEPTION 'That day is a weekly off.' USING ERRCODE = 'check_violation';
  END IF;
  IF prof.joining_date IS NOT NULL AND p_work_date < prof.joining_date THEN
    RAISE EXCEPTION 'That date is before you joined.' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM hr_permission_requests
              WHERE employee_id = v_emp AND work_date = p_work_date
                AND status IN ('pending', 'approved')) THEN
    RAISE EXCEPTION 'You already have a permission request for that day.' USING ERRCODE = 'unique_violation';
  END IF;

  -- The day is locked by a finalised payroll: approving it later could not
  -- change anything, so taking the request would be misleading.
  IF EXISTS (SELECT 1 FROM hr_attendance_daily
              WHERE employee_id = v_emp AND work_date = p_work_date AND locked) THEN
    RAISE EXCEPTION 'That day has already been paid and can no longer be changed.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO hr_permission_requests (employee_id, work_date, minutes, start_time, reason)
  VALUES (v_emp, p_work_date, p_minutes, p_start_time, btrim(p_reason))
  RETURNING id INTO v_id;

  v_used := hr_permission_used_minutes(v_emp, p_work_date);

  PERFORM hr_audit('attendance', v_id, 'permission_requested', '{}'::jsonb,
                   jsonb_build_object('work_date', p_work_date, 'minutes', p_minutes));

  RETURN jsonb_build_object(
    'ok', true, 'id', v_id,
    'used_minutes', v_used,
    'allowance_minutes', COALESCE(s.permission_monthly_minutes, 120),
    'would_exceed', (v_used + p_minutes) > COALESCE(s.permission_monthly_minutes, 120));
END;
$$;


-- --- Decide one --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hr_review_permission(
  p_id uuid, p_approve boolean, p_note text DEFAULT '', p_paid_override boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r       record;
  s       record;
  v_used  integer;
  v_paid  boolean;
BEGIN
  IF NOT hr_can_edit('attendance') THEN
    RAISE EXCEPTION 'You do not have permission to review these requests.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO r FROM hr_permission_requests WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found.' USING ERRCODE = 'no_data_found'; END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'This request has already been reviewed.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO s FROM hr_attendance_settings WHERE id = 1;

  /*
   * Approving beyond the allowance is allowed but UNPAID by default -- the
   * absence is agreed, it simply stops being free. Rejecting is the way to say
   * no outright. Only an approval that is paid credits anything, so the
   * allowance needs no separate deduction anywhere.
   */
  IF p_approve THEN
    v_used := hr_permission_used_minutes(r.employee_id, r.work_date, r.id);
    v_paid := COALESCE(
      p_paid_override,
      NOT COALESCE(s.permission_enforce_allowance, true)
        OR (v_used + r.minutes) <= COALESCE(s.permission_monthly_minutes, 120));
  ELSE
    v_paid := NULL;
  END IF;

  UPDATE hr_permission_requests
     SET status      = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         paid        = v_paid,
         approver_id = nw_current_employee_id(),
         decided_at  = now(),
         decision_note = COALESCE(p_note, '')
   WHERE id = p_id;

  -- The day's settlement depends on this, so it is rebuilt now rather than
  -- waiting for tonight.
  PERFORM hr_recompute_daily(r.employee_id, r.work_date);

  PERFORM hr_audit('attendance', p_id,
    CASE WHEN p_approve THEN 'permission_approved' ELSE 'permission_rejected' END,
    jsonb_build_object('minutes', r.minutes),
    jsonb_build_object('paid', v_paid, 'note', COALESCE(p_note, '')), COALESCE(p_note, ''));

  RETURN jsonb_build_object('ok', true, 'paid', v_paid);
END;
$$;


-- --- Withdraw your own, while it is still pending ----------------------------

CREATE OR REPLACE FUNCTION public.hr_cancel_permission(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM hr_permission_requests WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found.' USING ERRCODE = 'no_data_found'; END IF;

  IF r.employee_id <> nw_current_employee_id() AND NOT hr_can_edit('attendance') THEN
    RAISE EXCEPTION 'You can only withdraw your own request.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a request still awaiting a decision can be withdrawn.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE hr_permission_requests
     SET status = 'cancelled', cancelled_at = now() WHERE id = p_id;

  PERFORM hr_audit('attendance', p_id, 'permission_cancelled', '{}'::jsonb, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.hr_permission_used_minutes(uuid, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_permission_summary(date)                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_request_permission(date, integer, time, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_review_permission(uuid, boolean, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_cancel_permission(uuid)                   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_permission_summary(date)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_request_permission(date, integer, time, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_review_permission(uuid, boolean, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_cancel_permission(uuid)                   TO authenticated;


-- --- Attendance settles a permitted day as a full one ------------------------

CREATE OR REPLACE FUNCTION public.hr_recompute_daily(p_employee_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s                 record;
  prof              record;
  p                 record;

  v_adj_id          uuid;
  v_adj_in          timestamptz;
  v_adj_out         timestamptz;
  v_adj_status      text;
  v_adj_reason      text;

  v_track_from      date;
  v_locked          boolean;
  v_holiday_id      uuid;
  v_is_weekly_off   boolean;
  v_status          text := 'absent';
  v_payable         numeric(3,2) := 0;

  v_first_in        timestamptz;
  v_last_out        timestamptz;
  v_open_in         timestamptz;
  v_worked_min      integer := 0;
  v_work_fraction   numeric(3,2) := 0;

  v_leave_paid      numeric(3,2) := 0;
  v_leave_unpaid    numeric(3,2) := 0;
  v_leave_req       uuid;

  v_is_late         boolean := false;
  v_late_min        integer := 0;
  v_is_early        boolean := false;
  v_early_min       integer := 0;
  v_ot_min          integer := 0;
  v_pending         boolean := false;
  v_missing_out     boolean := false;
  v_remarks         text := '';
  v_punch_count     integer := 0;
  v_arrangement     record;
  /*
   * SCALARS, not a record.
   *
   * These are assigned by a SELECT inside the ELSE branch below but read after
   * it, and a plpgsql RECORD that no SELECT has touched is not NULL -- reading
   * any field of it raises "record is not assigned yet". An employee whose day
   * falls before they joined or after they left skips that SELECT entirely, so
   * every not_joined and exited day threw. Scalars are simply NULL when the
   * SELECT never runs.
   *
   * This is the second time this exact shape has bitten (hr_20 fixed it for
   * the adjustment record). A record read outside the branch that fills it is
   * the bug, not the branch.
   */
  -- Approved, paid permission for this day, and the figure the full-day
  -- threshold is judged against. Kept apart from v_worked_min so the register
  -- and overtime keep reporting the hours actually worked.
  v_perm_min        integer := 0;
  v_for_status      integer := 0;
  v_break_id        uuid;
  v_break_label     text;
  -- IST wall-clock now, for deciding whether the day is still running.
  v_now_ist         timestamp;
BEGIN
  SELECT locked INTO v_locked FROM hr_attendance_daily
   WHERE employee_id = p_employee_id AND work_date = p_date;
  v_locked := COALESCE(v_locked, false);
  /*
   * A locked day is NOT skipped any more -- see the ON CONFLICT clause. The
   * lock protects what was PAID; it was also suppressing what was OBSERVED,
   * which is a different thing and should never have been frozen.
   */

  SELECT * INTO s FROM hr_attendance_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN; END IF;

  v_now_ist := now() AT TIME ZONE 'Asia/Kolkata';

  SELECT attendance_tracking_from INTO v_track_from FROM hr_settings WHERE id = 1;

  SELECT e.joining_date,
         pr.exit_date,
         COALESCE(pr.holiday_location, 'Chennai') AS holiday_location,
         pr.work_schedule_id
    INTO prof
  FROM nw_employees e
  LEFT JOIN hr_employee_profiles pr ON pr.employee_id = e.id
  WHERE e.id = p_employee_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF prof.joining_date IS NOT NULL AND p_date < prof.joining_date THEN
    v_status := 'not_joined';
  ELSIF prof.exit_date IS NOT NULL AND p_date > prof.exit_date THEN
    v_status := 'exited';
  ELSE
    /*
     * A BREAK OUTRANKS THE CALENDAR.
     *
     * Someone on an extended break -- maternity, sabbatical, long unpaid leave
     * -- is not working, and the weekends and public holidays that fall inside
     * the break are not paid days off either. Nothing is being earned, so the
     * break is settled before holidays, weekly offs, leave and punches are
     * even considered.
     *
     * It is NOT absence. Like not_joined and exited, these days sit outside
     * the period the employee is being paid for, so they never become loss of
     * pay -- which is the whole difference between "away with our agreement"
     * and "did not turn up".
     */
    SELECT b.id, b.label INTO v_break_id, v_break_label FROM hr_employee_breaks b
     WHERE b.employee_id = p_employee_id
       AND b.status = 'active'
       AND p_date >= b.from_date
       AND (b.to_date IS NULL OR p_date <= b.to_date)
     ORDER BY b.from_date DESC
     LIMIT 1;
  END IF;

  IF v_break_id IS NOT NULL THEN
    v_status  := 'on_break';
    v_payable := 0;
    v_remarks := v_break_label;
  ELSIF v_status NOT IN ('not_joined', 'exited') THEN
    v_holiday_id    := hr_is_holiday(prof.holiday_location, p_date);
    v_is_weekly_off := hr_is_weekly_off(prof.work_schedule_id, p_date);

    SELECT COALESCE(SUM(CASE WHEN ld.paid THEN ld.portion ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN ld.paid THEN 0 ELSE ld.portion END), 0)
      INTO v_leave_paid, v_leave_unpaid
    FROM hr_leave_days ld
    WHERE ld.employee_id = p_employee_id AND ld.work_date = p_date;

    SELECT ld.leave_request_id INTO v_leave_req
    FROM hr_leave_days ld
    WHERE ld.employee_id = p_employee_id AND ld.work_date = p_date
    LIMIT 1;

    SELECT EXISTS (
      SELECT 1 FROM hr_attendance_punches
      WHERE employee_id = p_employee_id AND work_date = p_date
        AND approval_status = 'pending'
    ) INTO v_pending;

    SELECT a.id, a.requested_in_at, a.requested_out_at, a.requested_status, a.reason
      INTO v_adj_id, v_adj_in, v_adj_out, v_adj_status, v_adj_reason
    FROM hr_attendance_adjustments a
    WHERE a.employee_id = p_employee_id AND a.work_date = p_date AND a.status = 'approved'
    ORDER BY a.reviewed_at DESC NULLS LAST
    LIMIT 1;

    IF v_adj_id IS NOT NULL AND (v_adj_in IS NOT NULL OR v_adj_out IS NOT NULL) THEN
      v_first_in := v_adj_in;
      v_last_out := v_adj_out;
      IF v_first_in IS NOT NULL AND v_last_out IS NOT NULL THEN
        v_worked_min := GREATEST(0, (EXTRACT(EPOCH FROM (v_last_out - v_first_in)) / 60)::integer);
      END IF;
      v_remarks := 'Adjusted: ' || COALESCE(v_adj_reason, '');
    ELSE
      FOR p IN
        SELECT punch_type, punched_at
        FROM hr_attendance_punches
        WHERE employee_id = p_employee_id AND work_date = p_date
          AND approval_status IN ('auto_approved', 'approved')
        ORDER BY punched_at
      LOOP
        v_punch_count := v_punch_count + 1;
        IF p.punch_type = 'in' THEN
          IF v_first_in IS NULL THEN v_first_in := p.punched_at; END IF;
          IF v_open_in IS NULL THEN v_open_in := p.punched_at; END IF;
        ELSE
          v_last_out := p.punched_at;
          IF v_open_in IS NOT NULL THEN
            v_worked_min := v_worked_min
              + GREATEST(0, (EXTRACT(EPOCH FROM (p.punched_at - v_open_in)) / 60)::integer);
            v_open_in := NULL;
          END IF;
        END IF;
      END LOOP;

      IF v_open_in IS NOT NULL THEN
        IF p_date < hr_today() THEN
          v_missing_out := true;
          IF s.auto_punch_out_after_minutes IS NOT NULL THEN
            v_worked_min := v_worked_min + s.auto_punch_out_after_minutes;
            v_remarks := 'Auto punch-out applied (no out punch recorded).';
          ELSE
            v_remarks := 'No punch out recorded.';
          END IF;
        ELSE
          v_worked_min := v_worked_min
            + GREATEST(0, (EXTRACT(EPOCH FROM (now() - v_open_in)) / 60)::integer);
        END IF;
      END IF;
    END IF;

    v_worked_min := GREATEST(0, v_worked_min - COALESCE(s.break_minutes, 0));
    IF COALESCE(s.rounding_minutes, 0) > 0 THEN
      v_worked_min := (ROUND(v_worked_min::numeric / s.rounding_minutes) * s.rounding_minutes)::integer;
    END IF;

    /*
     * PERMISSION COUNTS TOWARD THE DAY, NOT TOWARD THE CLOCK.
     *
     * An hour of approved, paid permission makes a seven-hour day settle as
     * present rather than half_day -- which is the entire point of granting
     * it. The credit is used for this threshold ONLY:
     *
     *   * worked_minutes below still stores the hours actually worked, so the
     *     register never claims someone was at their desk when they were not;
     *   * overtime is measured further down against the real figure, so
     *     permission can never manufacture overtime.
     *
     * Unpaid permission -- granted beyond the monthly allowance -- credits
     * nothing, so the short day falls through to half_day or absent by itself.
     */
    SELECT COALESCE(SUM(minutes), 0) INTO v_perm_min
      FROM hr_permission_requests
     WHERE employee_id = p_employee_id AND work_date = p_date
       AND status = 'approved' AND COALESCE(paid, false);

    v_for_status := v_worked_min + v_perm_min;

    IF v_for_status >= s.full_day_minutes THEN
      v_work_fraction := 1.00;
    ELSIF v_for_status >= s.half_day_minutes THEN
      v_work_fraction := 0.50;
    ELSE
      v_work_fraction := 0;
    END IF;

    IF v_first_in IS NOT NULL THEN
      v_late_min := GREATEST(0, (
        EXTRACT(EPOCH FROM (
          (v_first_in AT TIME ZONE 'Asia/Kolkata')::time - s.office_start
        )) / 60)::integer - s.late_after_minutes);
      v_is_late := v_late_min > 0;
    END IF;

    -- Leaving early on permission that was agreed in advance is not something
    -- to flag back at the employee.
    IF v_last_out IS NOT NULL AND NOT v_missing_out AND v_perm_min = 0 THEN
      v_early_min := GREATEST(0, (
        EXTRACT(EPOCH FROM (
          s.office_end - (v_last_out AT TIME ZONE 'Asia/Kolkata')::time
        )) / 60)::integer - s.early_out_before_minutes);
      v_is_early := v_early_min > 0;
    END IF;

    IF v_worked_min > s.overtime_after_minutes THEN
      v_ot_min := v_worked_min - s.overtime_after_minutes;
    END IF;

    IF v_holiday_id IS NOT NULL THEN
      v_status := 'holiday';  v_payable := 1.00;
    ELSIF v_is_weekly_off THEN
      v_status := 'weekly_off'; v_payable := 1.00;
    ELSIF v_adj_status IS NOT NULL THEN
      v_status := CASE v_adj_status
                    WHEN 'on_duty'  THEN 'on_duty'
                    WHEN 'present'  THEN 'present'
                    WHEN 'half_day' THEN 'half_day'
                    ELSE 'absent' END;
      v_payable := CASE v_adj_status
                     WHEN 'absent'   THEN 0
                     WHEN 'half_day' THEN 0.50
                     ELSE 1.00 END;
    ELSE
      v_payable := LEAST(1.00, v_leave_paid + v_work_fraction);

      IF v_leave_paid >= 1.00 THEN
        v_status := 'paid_leave';
      ELSIF v_leave_unpaid >= 1.00 THEN
        v_status := 'unpaid_leave'; v_payable := 0;
      ELSIF v_leave_paid > 0 OR v_leave_unpaid > 0 THEN
        v_status := CASE WHEN v_payable >= 1.00 THEN 'present' ELSE 'half_day' END;
      ELSIF v_work_fraction >= 1.00 THEN
        v_status := 'present';
      ELSIF v_work_fraction = 0.50 THEN
        v_status := 'half_day';
      ELSE
        v_status := 'absent';
      END IF;

      -- Before tracking began there can be no punches, so an otherwise
      -- unexplained working day is not absence -- it is a day nobody recorded.
      -- Applied last so leave, holidays and weekly offs keep precedence, and
      -- only when no punch was found, so an early adopter's data survives.
      IF v_status = 'absent'
         AND v_track_from IS NOT NULL
         AND p_date < v_track_from
         AND v_punch_count = 0 THEN
        v_status  := 'on_duty';
        v_payable := 1.00;
        v_remarks := 'Before attendance tracking began; paid in full, no punch data exists for this day.';

      /*
       * WORKING, JUST NOT FROM THE OFFICE.
       *
       * Someone on an approved remote arrangement -- maternity working from
       * home, a medical restriction, a posting elsewhere -- is at work. They
       * simply have no office to punch in at, so attendance settles them as
       * on duty and pays the day in full.
       *
       * Placed AFTER leave, holidays, weekly offs and any admin correction, so
       * all of those still win: taking leave during a remote period is still
       * leave. Placed BEFORE the unfinished-day rule because a remote day
       * needs no observation to be settled -- there is nothing to wait for.
       *
       * And it only rescues a day that would otherwise be ABSENCE. If they do
       * come in and punch, the punches decide the day exactly as usual, so an
       * occasional office visit is recorded as the present day it was.
       */
      ELSIF v_status = 'absent' AND v_punch_count = 0 THEN
        SELECT * INTO v_arrangement FROM hr_work_arrangements a
         WHERE a.employee_id = p_employee_id
           AND a.status = 'active'
           AND p_date >= a.from_date
           AND (a.to_date IS NULL OR p_date <= a.to_date)
         ORDER BY a.from_date DESC
         LIMIT 1;
        IF FOUND THEN
          v_status  := 'on_duty';
          v_payable := 1.00;
          v_remarks := v_arrangement.label;
        END IF;
      END IF;

      /*
       * A DAY THAT HAS NOT FINISHED CANNOT BE ABSENCE.
       *
       * 'absent' is a verdict, and the engine was reaching it for days that
       * had not happened yet and for mornings that were still in progress:
       * worked_minutes only crosses the full-day threshold late in the
       * afternoon, so everyone who punched in at 10 read as absent until they
       * punched out. Two symptoms, one cause -- stating the outcome of a day
       * before the day is over.
       *
       * This is not cosmetic. payable_fraction was 0 on those rows, so a
       * payroll run made mid-month counted every remaining day of the month as
       * loss of pay. Future working days are provisionally payable in full;
       * absence is a deduction from what actually happened, and nothing has
       * happened yet.
       *
       * Holidays, weekly offs, approved leave, not_joined and exited are all
       * genuinely knowable in advance, so they are settled above and keep
       * their precedence -- only the 'absent' fallback is deferred.
       */
      IF v_status = 'absent' AND (
              p_date > hr_today()
              OR (p_date = hr_today()
                  AND (v_open_in IS NOT NULL
                       OR v_now_ist < (p_date + s.office_end)))) THEN
        -- Clocked in right now, or some punch already today, reads as working;
        -- a day nobody has touched yet reads as upcoming.
        v_status  := CASE WHEN v_punch_count > 0 THEN 'working' ELSE 'upcoming' END;
        v_payable := 1.00;
      END IF;
    END IF;

    IF v_perm_min > 0 THEN
      v_remarks := trim(both ' ' from v_remarks || ' '
        || (v_perm_min / 60.0)::numeric(4,2) || ' hr permission (paid).');
    END IF;

    IF v_pending AND v_status IN ('absent', 'working', 'upcoming') THEN
      v_remarks := trim(both ' ' from v_remarks || ' Punch awaiting approval.');
    END IF;
  END IF;

  INSERT INTO hr_attendance_daily (
    employee_id, work_date, status, payable_fraction,
    first_in_at, last_out_at, worked_minutes,
    is_late, late_minutes, is_early_out, early_out_minutes, overtime_minutes,
    has_pending_punch, missing_punch_out, leave_request_id, holiday_id, adjustment_id,
    remarks, computed_at)
  VALUES (
    p_employee_id, p_date, v_status, v_payable,
    v_first_in, v_last_out, v_worked_min,
    v_is_late, v_late_min, v_is_early, v_early_min, v_ot_min,
    v_pending, v_missing_out, v_leave_req, v_holiday_id, v_adj_id,
    COALESCE(v_remarks, ''), now())
  /*
   * On a LOCKED day only the observational half is refreshed. status,
   * payable_fraction and the leave/holiday/adjustment links are what payroll
   * settled on and must not move; the punch times, worked minutes and
   * lateness are simply what happened and should stay true.
   */
  ON CONFLICT (employee_id, work_date) DO UPDATE SET
    /*
     * The label may settle even on a locked day, but ONLY while the money
     * stays identical. 'working' becoming 'present' once the day ends is the
     * same 1.00 either way and simply stops a finished day reading as still
     * in progress for ever. 'upcoming' becoming 'absent' is NOT the same --
     * that is 1.00 becoming 0.00 on a day already paid -- so it is refused
     * and the row keeps what payroll settled on.
     */
    status            = CASE WHEN hr_attendance_daily.locked
                               AND EXCLUDED.payable_fraction IS DISTINCT FROM hr_attendance_daily.payable_fraction
                             THEN hr_attendance_daily.status ELSE EXCLUDED.status END,
    payable_fraction  = CASE WHEN hr_attendance_daily.locked
                             THEN hr_attendance_daily.payable_fraction ELSE EXCLUDED.payable_fraction END,
    leave_request_id  = CASE WHEN hr_attendance_daily.locked
                             THEN hr_attendance_daily.leave_request_id ELSE EXCLUDED.leave_request_id END,
    holiday_id        = CASE WHEN hr_attendance_daily.locked
                             THEN hr_attendance_daily.holiday_id ELSE EXCLUDED.holiday_id END,
    adjustment_id     = CASE WHEN hr_attendance_daily.locked
                             THEN hr_attendance_daily.adjustment_id ELSE EXCLUDED.adjustment_id END,
    remarks           = CASE WHEN hr_attendance_daily.locked
                             THEN hr_attendance_daily.remarks ELSE EXCLUDED.remarks END,
    first_in_at       = EXCLUDED.first_in_at,
    last_out_at       = EXCLUDED.last_out_at,
    worked_minutes    = EXCLUDED.worked_minutes,
    is_late           = EXCLUDED.is_late,
    late_minutes      = EXCLUDED.late_minutes,
    is_early_out      = EXCLUDED.is_early_out,
    early_out_minutes = EXCLUDED.early_out_minutes,
    overtime_minutes  = EXCLUDED.overtime_minutes,
    has_pending_punch = EXCLUDED.has_pending_punch,
    missing_punch_out = EXCLUDED.missing_punch_out,
    computed_at       = now();
END;
$$;

REVOKE ALL ON FUNCTION public.hr_recompute_daily(uuid, date) FROM PUBLIC, anon, authenticated;
