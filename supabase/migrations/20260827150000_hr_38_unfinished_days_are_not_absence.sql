-- =============================================================================
-- A day that has not finished yet is not absence.
--
-- Two reported symptoms, one cause. Future dates were being written as
-- 'absent', and anyone who punched in at 10am read as 'absent' until they
-- punched out, because worked_minutes only crosses the full-day threshold late
-- in the afternoon. In both cases the engine was stating the verdict of a day
-- before the day was over.
--
-- It was also a live PAYROLL bug, not just a display one. Those rows carried
-- payable_fraction 0.00, so a payroll run made mid-month counted every
-- remaining working day of the month as loss of pay -- 16 such rows existed
-- for August when this was written.
--
-- Two new statuses:
--   working  -- today, punched in or already punched at least once, day open
--   upcoming -- a future working day, or today before anyone has punched
-- Both are provisionally payable in full. Absence is a DEDUCTION from what
-- actually happened, and for these rows nothing has happened yet. The nightly
-- recompute settles each day to present / half_day / absent once it is over.
--
-- Holidays, weekly offs, approved leave, not_joined and exited are genuinely
-- knowable in advance and keep their precedence -- only the 'absent' fallback
-- is deferred.
-- =============================================================================

ALTER TABLE public.hr_attendance_daily DROP CONSTRAINT IF EXISTS hr_attendance_daily_status_check;
ALTER TABLE public.hr_attendance_daily ADD CONSTRAINT hr_attendance_daily_status_check
  CHECK (status IN ('present', 'half_day', 'absent', 'weekly_off', 'holiday',
                    'paid_leave', 'unpaid_leave', 'on_duty', 'not_joined', 'exited',
                    'working', 'upcoming'));

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
  -- IST wall-clock now, for deciding whether the day is still running.
  v_now_ist         timestamp;
BEGIN
  SELECT locked INTO v_locked FROM hr_attendance_daily
   WHERE employee_id = p_employee_id AND work_date = p_date;
  IF COALESCE(v_locked, false) THEN
    RETURN;
  END IF;

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
      ELSIF v_status = 'absent' AND (
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
  ON CONFLICT (employee_id, work_date) DO UPDATE SET
    status            = EXCLUDED.status,
    payable_fraction  = EXCLUDED.payable_fraction,
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
    leave_request_id  = EXCLUDED.leave_request_id,
    holiday_id        = EXCLUDED.holiday_id,
    adjustment_id     = EXCLUDED.adjustment_id,
    remarks           = EXCLUDED.remarks,
    computed_at       = now();
END;
$$;

REVOKE ALL ON FUNCTION public.hr_recompute_daily(uuid, date) FROM PUBLIC, anon, authenticated;