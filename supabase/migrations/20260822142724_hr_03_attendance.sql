-- =============================================================================
-- NIYOM HR & PAYROLL -- 03: attendance
--
-- Punches are IMMUTABLE. A correction never rewrites history: it creates an
-- hr_attendance_adjustments row carrying before/after, and the derived
-- hr_attendance_daily row is recomputed from (punches + adjustments + leave).
-- =============================================================================

-- --- Rules (single row) ------------------------------------------------------

CREATE TABLE public.hr_attendance_settings (
  id                      smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),

  -- Office hours, IST, stored as local time-of-day.
  office_start            time NOT NULL DEFAULT '10:00',
  office_end              time NOT NULL DEFAULT '18:00',
  grace_minutes           smallint NOT NULL DEFAULT 15  CHECK (grace_minutes BETWEEN 0 AND 240),
  late_after_minutes      smallint NOT NULL DEFAULT 15  CHECK (late_after_minutes BETWEEN 0 AND 240),
  early_out_before_minutes smallint NOT NULL DEFAULT 15 CHECK (early_out_before_minutes BETWEEN 0 AND 240),

  -- Worked-minute thresholds that decide the day's status.
  full_day_minutes        smallint NOT NULL DEFAULT 480 CHECK (full_day_minutes > 0),
  half_day_minutes        smallint NOT NULL DEFAULT 240 CHECK (half_day_minutes > 0),
  overtime_after_minutes  smallint NOT NULL DEFAULT 540 CHECK (overtime_after_minutes > 0),
  break_minutes           smallint NOT NULL DEFAULT 0   CHECK (break_minutes >= 0),
  -- Round worked time to the nearest N minutes; 0 = no rounding.
  rounding_minutes        smallint NOT NULL DEFAULT 0   CHECK (rounding_minutes BETWEEN 0 AND 60),

  -- ---- Network enforcement ----
  -- observe : record the verdict truthfully, never block. Ships in this mode so
  --           the real office IPs can be confirmed from live punches before
  --           enforcement is switched on (the office IP may not be static).
  -- enforce : off-network punches are accepted but held as ''pending'' and do
  --           not count until an admin approves them.
  enforcement_mode        text NOT NULL DEFAULT 'observe'
                            CHECK (enforcement_mode IN ('observe', 'enforce')),
  -- How many proxy hops in front of the edge runtime are trusted. The client
  -- can prepend to X-Forwarded-For; the platform APPENDS, so the trustworthy
  -- entry is counted from the RIGHT. 0 = right-most.
  trusted_proxy_hops      smallint NOT NULL DEFAULT 0 CHECK (trusted_proxy_hops BETWEEN 0 AND 5),

  -- ---- Abuse control ----
  punch_cooldown_seconds  smallint NOT NULL DEFAULT 60  CHECK (punch_cooldown_seconds BETWEEN 0 AND 3600),
  max_punches_per_day     smallint NOT NULL DEFAULT 20  CHECK (max_punches_per_day BETWEEN 2 AND 100),
  rate_limit_per_minute   smallint NOT NULL DEFAULT 6   CHECK (rate_limit_per_minute BETWEEN 1 AND 60),

  -- Auto punch-out for a forgotten out-punch: NULL = never.
  auto_punch_out_after_minutes smallint CHECK (auto_punch_out_after_minutes IS NULL OR auto_punch_out_after_minutes > 0),

  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,

  CHECK (half_day_minutes <= full_day_minutes)
);

CREATE TRIGGER hr_attendance_settings_touch BEFORE UPDATE ON public.hr_attendance_settings
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

-- --- Approved office networks ------------------------------------------------
-- inet/cidr rather than text: `ip <<= cidr` is an indexable containment test
-- that handles IPv4, IPv6 and ranges correctly. String comparison of IPs is a
-- classic source of near-miss bugs (leading zeroes, ::ffff: mapped addresses).

CREATE TABLE public.hr_allowed_networks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  location       text NOT NULL DEFAULT 'Chennai',
  -- Exactly one of the two: a single address, or a range.
  ip_address     inet,
  ip_range       cidr,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to   date,
  description    text NOT NULL DEFAULT '',
  created_by     uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CHECK (num_nonnulls(ip_address, ip_range) = 1),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX hr_allowed_networks_active_idx ON public.hr_allowed_networks (status)
  WHERE status = 'active';

CREATE TRIGGER hr_allowed_networks_touch BEFORE UPDATE ON public.hr_allowed_networks
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

COMMENT ON TABLE public.hr_allowed_networks IS
  'Office public IPs. Matched server-side only -- the client never supplies an IP and one sent in a request body is ignored.';

-- Returns the matching network row id, or NULL when the address is off-network.
CREATE OR REPLACE FUNCTION public.hr_match_network(p_ip inet)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT n.id
  FROM hr_allowed_networks n
  WHERE p_ip IS NOT NULL
    AND n.status = 'active'
    AND n.effective_from <= hr_today()
    AND (n.effective_to IS NULL OR n.effective_to >= hr_today())
    AND (
      (n.ip_address IS NOT NULL AND n.ip_address = p_ip) OR
      (n.ip_range   IS NOT NULL AND p_ip <<= n.ip_range)
    )
  ORDER BY n.ip_address NULLS LAST   -- prefer an exact match over a range
  LIMIT 1;
$$;

-- --- Punches (append-only) ---------------------------------------------------

CREATE TABLE public.hr_attendance_punches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,
  punch_type      text NOT NULL CHECK (punch_type IN ('in', 'out')),
  -- Server clock, always. The client cannot supply a time.
  punched_at      timestamptz NOT NULL DEFAULT now(),
  -- IST calendar date, derived server-side from punched_at.
  work_date       date NOT NULL,

  -- Server-detected network context.
  detected_ip     inet,
  forwarded_for   text,        -- raw header, kept for observe-mode verification
  network_id      uuid REFERENCES public.hr_allowed_networks(id) ON DELETE SET NULL,
  network_name    text NOT NULL DEFAULT '',
  network_status  text NOT NULL CHECK (network_status IN ('office', 'off_network', 'unknown')),

  -- Off-network punches are recorded but do not count until approved.
  approval_status text NOT NULL DEFAULT 'auto_approved'
                    CHECK (approval_status IN ('auto_approved', 'pending', 'approved', 'rejected')),
  approved_by     uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  review_note     text NOT NULL DEFAULT '',

  user_agent      text NOT NULL DEFAULT '',
  source          text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'mobile', 'admin')),
  enforcement_mode text NOT NULL DEFAULT 'observe',  -- mode in force at punch time
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hr_punches_emp_date_idx ON public.hr_attendance_punches (employee_id, work_date, punched_at);
CREATE INDEX hr_punches_date_idx     ON public.hr_attendance_punches (work_date);
CREATE INDEX hr_punches_pending_idx  ON public.hr_attendance_punches (approval_status)
  WHERE approval_status = 'pending';
-- Two punches at the same instant by the same employee is always a double-submit.
CREATE UNIQUE INDEX hr_punches_no_exact_dupe
  ON public.hr_attendance_punches (employee_id, punched_at);

COMMENT ON TABLE public.hr_attendance_punches IS
  'Append-only. Only the approval columns may ever change, and only by admin/HR -- enforced by hr_punches_immutable.';

-- Immutability guard.
CREATE OR REPLACE FUNCTION public.hr_guard_punch_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.id             IS DISTINCT FROM OLD.id
  OR NEW.employee_id    IS DISTINCT FROM OLD.employee_id
  OR NEW.punch_type     IS DISTINCT FROM OLD.punch_type
  OR NEW.punched_at     IS DISTINCT FROM OLD.punched_at
  OR NEW.work_date      IS DISTINCT FROM OLD.work_date
  OR NEW.detected_ip    IS DISTINCT FROM OLD.detected_ip
  OR NEW.forwarded_for  IS DISTINCT FROM OLD.forwarded_for
  OR NEW.network_id     IS DISTINCT FROM OLD.network_id
  OR NEW.network_status IS DISTINCT FROM OLD.network_status
  OR NEW.user_agent     IS DISTINCT FROM OLD.user_agent
  OR NEW.source         IS DISTINCT FROM OLD.source
  OR NEW.created_at     IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Attendance punches are immutable. Raise an attendance correction instead.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Approval columns: admin/HR only. auth.uid() IS NULL means service role or
  -- an internal SECURITY DEFINER context, which is already authorised.
  IF auth.uid() IS NOT NULL AND NOT hr_can_edit('attendance') THEN
    RAISE EXCEPTION 'Only an administrator can approve or reject an attendance punch.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER hr_punches_immutable BEFORE UPDATE ON public.hr_attendance_punches
  FOR EACH ROW EXECUTE FUNCTION public.hr_guard_punch_immutable();

-- Deleting a punch would destroy the audit trail the whole design rests on.
CREATE OR REPLACE FUNCTION public.hr_guard_punch_no_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'Attendance punches cannot be deleted. Reject the punch or raise a correction instead.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER hr_punches_no_delete BEFORE DELETE ON public.hr_attendance_punches
  FOR EACH ROW EXECUTE FUNCTION public.hr_guard_punch_no_delete();

-- --- Corrections / adjustments ----------------------------------------------

CREATE TABLE public.hr_attendance_adjustments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,
  work_date         date NOT NULL,
  kind              text NOT NULL CHECK (kind IN
                      ('missing_punch_in', 'missing_punch_out', 'wrong_time', 'regularize', 'admin_override')),
  -- The corrected times being requested (IST timestamps).
  requested_in_at   timestamptz,
  requested_out_at  timestamptz,
  -- Force a day status regardless of times, e.g. an admin marking on-duty.
  requested_status  text CHECK (requested_status IS NULL OR requested_status IN
                      ('present', 'half_day', 'absent', 'on_duty')),
  reason            text NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by      uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  reviewed_by       uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  review_note       text NOT NULL DEFAULT '',
  before_value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hr_adjustments_emp_date_idx ON public.hr_attendance_adjustments (employee_id, work_date);
CREATE INDEX hr_adjustments_pending_idx  ON public.hr_attendance_adjustments (status)
  WHERE status = 'pending';
-- One open request per employee per day; re-applying means editing the open one.
CREATE UNIQUE INDEX hr_adjustments_one_open
  ON public.hr_attendance_adjustments (employee_id, work_date) WHERE status = 'pending';

CREATE TRIGGER hr_adjustments_touch BEFORE UPDATE ON public.hr_attendance_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

-- --- Derived daily summary ---------------------------------------------------
-- Fully recomputable from punches + adjustments + leave + holidays. Never
-- hand-edited; hr_recompute_daily() owns every column below.

CREATE TABLE public.hr_attendance_daily (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id        uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,
  work_date          date NOT NULL,

  status             text NOT NULL DEFAULT 'absent' CHECK (status IN
                       ('present', 'half_day', 'absent', 'weekly_off', 'holiday',
                        'paid_leave', 'unpaid_leave', 'on_duty', 'not_joined', 'exited')),
  -- 1.0 / 0.5 / 0 -- what payroll counts for this day.
  payable_fraction   numeric(3,2) NOT NULL DEFAULT 0 CHECK (payable_fraction BETWEEN 0 AND 1),

  first_in_at        timestamptz,
  last_out_at        timestamptz,
  worked_minutes     integer NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),

  is_late            boolean NOT NULL DEFAULT false,
  late_minutes       integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  is_early_out       boolean NOT NULL DEFAULT false,
  early_out_minutes  integer NOT NULL DEFAULT 0 CHECK (early_out_minutes >= 0),
  overtime_minutes   integer NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),

  has_pending_punch  boolean NOT NULL DEFAULT false,  -- off-network awaiting approval
  missing_punch_out  boolean NOT NULL DEFAULT false,
  leave_request_id   uuid,
  holiday_id         uuid,
  adjustment_id      uuid REFERENCES public.hr_attendance_adjustments(id) ON DELETE SET NULL,

  -- Set when the covering payroll run is locked; blocks further recomputation.
  locked             boolean NOT NULL DEFAULT false,
  locked_by_run_id   uuid,

  remarks            text NOT NULL DEFAULT '',
  computed_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (employee_id, work_date)
);

CREATE INDEX hr_daily_date_idx      ON public.hr_attendance_daily (work_date);
CREATE INDEX hr_daily_emp_month_idx ON public.hr_attendance_daily (employee_id, work_date DESC);
CREATE INDEX hr_daily_status_idx    ON public.hr_attendance_daily (status);

COMMENT ON TABLE public.hr_attendance_daily IS
  'Derived, not authoritative. Recomputed by hr_recompute_daily() from punches, approved adjustments, leave and holidays.';