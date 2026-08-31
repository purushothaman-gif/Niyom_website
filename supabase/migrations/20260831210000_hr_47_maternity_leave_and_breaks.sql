-- =============================================================================
-- Maternity leave, and a payroll break for an employee who steps away.
--
-- TWO DIFFERENT THINGS, deliberately kept apart:
--
--   MATERNITY LEAVE is leave. It is taken against a balance, it is approved
--   like any other leave, and it is PAID -- the days settle as paid_leave and
--   the salary runs normally. Added here as a leave type because the module
--   shipped with CL, SL, EL, COMP and LOP and nothing else, so there was no
--   honest way to record it.
--
--   A BREAK is an absence from payroll altogether: an extended period, often
--   open-ended, during which someone is not working and not being paid, and
--   after which they come back. Salary stops; it is not reduced.
--
-- WHY A BREAK IS NOT JUST "ABSENT". Absence is a deduction from a month
-- somebody was employed to work. A break is a stretch of time outside that --
-- the same category as the days before someone joined or after they left,
-- which is why on_break is excluded from the loss-of-pay calculation exactly
-- as not_joined and exited are. Marking a six-month break as absence would
-- generate six months of LOP against a salary nobody is paying.
--
-- It outranks the calendar: weekends and public holidays inside a break are
-- not paid days off either, so it is settled before holidays, weekly offs,
-- leave and punches are considered.
--
-- Open-ended by default (to_date NULL) -- "not active for a while, until we
-- say otherwise" is the actual requirement, and a break that silently expired
-- would put someone back on the payroll without anyone deciding to.
-- =============================================================================

-- --- Maternity leave --------------------------------------------------------
-- 26 weeks is the statutory entitlement in India for establishments the
-- Maternity Benefit Act covers; the quota is stored as a number so it can be
-- set to whatever this company's policy actually is.

INSERT INTO public.hr_leave_types
  (code, name, paid, accrual_mode, annual_quota, requires_approval,
   allow_half_day, allow_during_probation, counts_as_lop, colour, sort_order, active)
VALUES
  ('MAT', 'Maternity Leave', true, 'none', 182, true,
   false, true, false, '#ec4899', 60, true)
ON CONFLICT (code) DO NOTHING;


-- --- Breaks -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.hr_employee_breaks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,

  kind        text NOT NULL DEFAULT 'maternity'
                CHECK (kind IN ('maternity', 'sabbatical', 'unpaid_leave', 'medical', 'other')),
  from_date   date NOT NULL,
  to_date     date,                       -- NULL = until somebody ends it
  -- Shown against every day it settles, so a gap in the register is never
  -- mysterious months later.
  label       text NOT NULL CHECK (length(btrim(label)) >= 3),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),

  created_by  uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CHECK (to_date IS NULL OR to_date >= from_date)
);

CREATE INDEX IF NOT EXISTS hr_employee_breaks_lookup_idx
  ON public.hr_employee_breaks (employee_id, from_date DESC)
  WHERE status = 'active';

DROP TRIGGER IF EXISTS hr_employee_breaks_touch ON public.hr_employee_breaks;
CREATE TRIGGER hr_employee_breaks_touch BEFORE UPDATE ON public.hr_employee_breaks
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

COMMENT ON TABLE public.hr_employee_breaks IS
  'Periods when an employee is away from payroll entirely -- maternity, sabbatical, extended unpaid leave. Days settle as on_break: not payable, and NOT absence, so they never become loss of pay.';

ALTER TABLE public.hr_employee_breaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_employee_breaks_read_self ON public.hr_employee_breaks
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT nw_current_employee_id()) OR (SELECT hr_can_view('attendance')));

CREATE POLICY hr_employee_breaks_write ON public.hr_employee_breaks
  FOR ALL TO authenticated
  USING ((SELECT hr_can_edit('attendance'))) WITH CHECK ((SELECT hr_can_edit('attendance')));

-- on_break joins not_joined and exited as a status outside the paid window.
ALTER TABLE public.hr_attendance_daily DROP CONSTRAINT IF EXISTS hr_attendance_daily_status_check;
ALTER TABLE public.hr_attendance_daily ADD CONSTRAINT hr_attendance_daily_status_check
  CHECK (status IN ('present', 'half_day', 'absent', 'weekly_off', 'holiday',
                    'paid_leave', 'unpaid_leave', 'on_duty', 'not_joined', 'exited',
                    'working', 'upcoming', 'on_break'));

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
  v_break           record;
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
    SELECT * INTO v_break FROM hr_employee_breaks b
     WHERE b.employee_id = p_employee_id
       AND b.status = 'active'
       AND p_date >= b.from_date
       AND (b.to_date IS NULL OR p_date <= b.to_date)
     ORDER BY b.from_date DESC
     LIMIT 1;
  END IF;

  IF v_break.id IS NOT NULL THEN
    v_status  := 'on_break';
    v_payable := 0;
    v_remarks := v_break.label;
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

    IF v_worked_min >= s.full_day_minutes THEN
      v_work_fraction := 1.00;
    ELSIF v_worked_min >= s.half_day_minutes THEN
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

    IF v_last_out IS NOT NULL AND NOT v_missing_out THEN
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
