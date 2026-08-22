-- =============================================================================
-- Refuse punches made outside permitted hours.
--
-- THE TRAP THIS AVOIDS. The obvious implementation -- refuse anything outside
-- office hours, 10:00-18:00 -- breaks the people it is not aimed at:
--
--   * Someone still working at 18:30 cannot punch OUT. They stay punched in
--     for ever, the day is flagged as a missing punch-out, and the next
--     morning someone has to raise a correction to fix a person's honesty.
--   * Overtime becomes unrecordable, which contradicts the overtime threshold
--     already sitting in the same settings row.
--   * Anyone who arrives at 09:45 cannot start their day.
--
-- So the rule is asymmetric, and deliberately so:
--
--   PUNCH IN  outside the window is REFUSED. Starting a shift at 03:00 is the
--             thing worth blocking, and refusing it costs an honest person
--             nothing -- they were not there.
--   PUNCH OUT outside the window is ALLOWED by default and recorded, because
--             refusing it cannot prevent anything (the time was already
--             worked) and can only strand someone. Configurable for anyone who
--             disagrees, but it should stay on.
--
-- The window is wider than office hours on purpose: it is a sanity bound, not
-- a second attendance rule. Late arrival is already handled by
-- late_after_minutes, which marks the day rather than blocking it. If the
-- window were set to office hours it would silently become a punctuality
-- policy that no report explains.
--
-- Windows that cross midnight are supported (start > end) so a night shift can
-- be expressed without a schema change.
-- =============================================================================

ALTER TABLE public.hr_attendance_settings
  ADD COLUMN IF NOT EXISTS enforce_punch_window     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS punch_window_start       time    NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS punch_window_end         time    NOT NULL DEFAULT '22:00',
  ADD COLUMN IF NOT EXISTS allow_out_punch_anytime  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS block_on_weekly_off      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_on_holiday         boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.hr_attendance_settings.enforce_punch_window IS
  'Refuse punch-ins outside punch_window_start..punch_window_end (IST).';
COMMENT ON COLUMN public.hr_attendance_settings.allow_out_punch_anytime IS
  'Keep true. Refusing a late punch-out cannot prevent the time already worked, and strands the employee punched in.';
COMMENT ON COLUMN public.hr_attendance_settings.block_on_weekly_off IS
  'Refuse punch-ins on a weekly off. Off by default: people do come in on a Saturday, and a refused punch means unrecorded work.';
COMMENT ON COLUMN public.hr_attendance_settings.block_on_holiday IS
  'Refuse punch-ins on a holiday. Off by default, for the same reason as block_on_weekly_off.';

-- Is this instant inside the permitted window? Handles a window that wraps
-- midnight, so 22:00-06:00 means "the night", not "never".
CREATE OR REPLACE FUNCTION public.hr_within_punch_window(p_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  s      record;
  v_time time;
BEGIN
  SELECT enforce_punch_window, punch_window_start, punch_window_end INTO s
  FROM hr_attendance_settings WHERE id = 1;

  IF NOT FOUND OR NOT s.enforce_punch_window THEN
    RETURN true;
  END IF;

  v_time := (p_at AT TIME ZONE 'Asia/Kolkata')::time;

  IF s.punch_window_start <= s.punch_window_end THEN
    RETURN v_time >= s.punch_window_start AND v_time <= s.punch_window_end;
  END IF;

  -- Wrapped window, e.g. 22:00 -> 06:00.
  RETURN v_time >= s.punch_window_start OR v_time <= s.punch_window_end;
END;
$$;

REVOKE ALL ON FUNCTION public.hr_within_punch_window(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_within_punch_window(timestamptz) TO authenticated;