-- =============================================================================
-- NIYOM HR & PAYROLL -- 09: the attendance derivation engine
--
-- hr_recompute_daily() is the ONLY writer of hr_attendance_daily. It rebuilds a
-- day from scratch every time out of (approved punches + approved corrections +
-- approved leave + holidays + the work schedule), so the summary can never drift
-- from the evidence and a re-run is always safe.
--
-- It deliberately refuses to touch a day the payroll has locked.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hr_recompute_daily(p_employee_id uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s                 record;   -- attendance settings
  prof              record;   -- employee profile + joining/exit
  adj               record;   -- approved correction for the day, if any
  p                 record;   -- punch cursor row

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
BEGIN
  -- A locked day belongs to a finalised payroll. Leave it exactly as it was.
  SELECT locked INTO v_locked FROM hr_attendance_daily
   WHERE employee_id = p_employee_id AND work_date = p_date;
  IF COALESCE(v_locked, false) THEN
    RETURN;
  END IF;

  SELECT * INTO s FROM hr_attendance_settings WHERE id = 1;
  IF NOT FOUND THEN RETURN; END IF;   -- module not configured yet

  SELECT e.joining_date,
         pr.exit_date,
         COALESCE(pr.holiday_location, 'Chennai') AS holiday_location,
         pr.work_schedule_id
    INTO prof
  FROM nw_employees e
  LEFT JOIN hr_employee_profiles pr ON pr.employee_id = e.id
  WHERE e.id = p_employee_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- ---- Employment window -----------------------------------------------
  IF prof.joining_date IS NOT NULL AND p_date < prof.joining_date THEN
    v_status := 'not_joined';
  ELSIF prof.exit_date IS NOT NULL AND p_date > prof.exit_date THEN
    v_status := 'exited';
  ELSE
    -- ---- Calendar ------------------------------------------------------
    v_holiday_id    := hr_is_holiday(prof.holiday_location, p_date);
    v_is_weekly_off := hr_is_weekly_off(prof.work_schedule_id, p_date);

    -- ---- Approved leave -------------------------------------------------
    SELECT COALESCE(SUM(CASE WHEN ld.paid THEN ld.portion ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN ld.paid THEN 0 ELSE ld.portion END), 0),
           MIN(ld.leave_request_id)
      INTO v_leave_paid, v_leave_unpaid, v_leave_req
    FROM hr_leave_days ld
    WHERE ld.employee_id = p_employee_id AND ld.work_date = p_date;

    -- ---- Punches --------------------------------------------------------
    -- Only punches that count: auto-approved, or an off-network punch an admin
    -- has since approved. A pending punch contributes nothing but is flagged.
    SELECT EXISTS (
      SELECT 1 FROM hr_attendance_punches
      WHERE employee_id = p_employee_id AND work_date = p_date
        AND approval_status = 'pending'
    ) INTO v_pending;

    SELECT * INTO adj
    FROM hr_attendance_adjustments
    WHERE employee_id = p_employee_id AND work_date = p_date AND status = 'approved'
    ORDER BY reviewed_at DESC NULLS LAST
    LIMIT 1;

    IF adj.id IS NOT NULL AND (adj.requested_in_at IS NOT NULL OR adj.requested_out_at IS NOT NULL) THEN
      -- An approved correction replaces the derived times for the day. The
      -- punches themselves are untouched -- this is why they can stay immutable.
      v_first_in := adj.requested_in_at;
      v_last_out := adj.requested_out_at;
      IF v_first_in IS NOT NULL AND v_last_out IS NOT NULL THEN
        v_worked_min := GREATEST(0, (EXTRACT(EPOCH FROM (v_last_out - v_first_in)) / 60)::integer);
      END IF;
      v_remarks := 'Adjusted: ' || COALESCE(adj.reason, '');
    ELSE
      -- Pair the punches in time order. An unmatched IN contributes nothing;
      -- an OUT with no open IN is ignored rather than counted as a negative.
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

      -- Still punched in. On a past day that is a forgotten punch-out; on today
      -- it is simply the day in progress, so count time so far.
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

    -- Breaks and rounding.
    v_worked_min := GREATEST(0, v_worked_min - COALESCE(s.break_minutes, 0));
    IF COALESCE(s.rounding_minutes, 0) > 0 THEN
      v_worked_min := (ROUND(v_worked_min::numeric / s.rounding_minutes) * s.rounding_minutes)::integer;
    END IF;

    -- ---- How much of the day did they actually work? --------------------
    IF v_worked_min >= s.full_day_minutes THEN
      v_work_fraction := 1.00;
    ELSIF v_worked_min >= s.half_day_minutes THEN
      v_work_fraction := 0.50;
    ELSE
      v_work_fraction := 0;
    END IF;

    -- ---- Late / early / overtime ----------------------------------------
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

    -- ---- Resolve the day's status ---------------------------------------
    -- Order matters. A holiday or weekly off is paid regardless of leave, so it
    -- wins: booking leave on a holiday must not consume the balance or show as
    -- absence. Work done on such a day still records its hours and overtime.
    IF v_holiday_id IS NOT NULL THEN
      v_status := 'holiday';  v_payable := 1.00;
    ELSIF v_is_weekly_off THEN
      v_status := 'weekly_off'; v_payable := 1.00;
    ELSIF adj.requested_status IS NOT NULL THEN
      v_status := CASE adj.requested_status
                    WHEN 'on_duty'  THEN 'on_duty'
                    WHEN 'present'  THEN 'present'
                    WHEN 'half_day' THEN 'half_day'
                    ELSE 'absent' END;
      v_payable := CASE adj.requested_status
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
        -- Half-day leave: the rest of the day is expected to be worked.
        v_status := CASE WHEN v_payable >= 1.00 THEN 'present' ELSE 'half_day' END;
      ELSIF v_work_fraction >= 1.00 THEN
        v_status := 'present';
      ELSIF v_work_fraction = 0.50 THEN
        v_status := 'half_day';
      ELSE
        v_status := 'absent';
      END IF;
    END IF;

    IF v_pending AND v_status = 'absent' THEN
      v_remarks := trim(both ' ' from v_remarks || ' Off-network punch awaiting approval.');
    END IF;
  END IF;

  -- ---- Upsert -----------------------------------------------------------
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
    v_pending, v_missing_out, v_leave_req, v_holiday_id, adj.id,
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

COMMENT ON FUNCTION public.hr_recompute_daily(uuid, date) IS
  'Sole writer of hr_attendance_daily. Idempotent: rebuilds the day from punches, corrections, leave and the calendar. Skips days locked by a finalised payroll.';

-- Convenience wrappers -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hr_recompute_range(p_employee_id uuid, p_from date, p_to date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d date; n integer := 0;
BEGIN
  FOR d IN SELECT generate_series(p_from, p_to, interval '1 day')::date LOOP
    PERFORM hr_recompute_daily(p_employee_id, d);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- Every active employee for one date -- used by the nightly job.
CREATE OR REPLACE FUNCTION public.hr_recompute_all_for_date(p_date date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e record; n integer := 0;
BEGIN
  FOR e IN
    SELECT id FROM nw_employees WHERE status = 'active'
  LOOP
    PERFORM hr_recompute_daily(e.id, p_date);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_recompute_daily(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_recompute_range(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_recompute_all_for_date(date) FROM PUBLIC, anon, authenticated;