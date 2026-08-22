-- =============================================================================
-- NIYOM HR & PAYROLL -- 04: leave types, balances, requests, holidays
--
-- A leave REQUEST is expanded on approval into one hr_leave_days row per
-- calendar day (with a 0.5/1.0 portion). Payroll and the daily attendance
-- summary then join a single date column instead of testing range overlap,
-- which is what makes mid-month and part-day leave come out right.
-- =============================================================================

CREATE TABLE public.hr_leave_types (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  paid                boolean NOT NULL DEFAULT true,
  -- 'none' = no entitlement tracking (e.g. Loss of Pay).
  accrual_mode        text NOT NULL DEFAULT 'annual'
                        CHECK (accrual_mode IN ('none', 'annual', 'monthly')),
  annual_quota        numeric(5,2) NOT NULL DEFAULT 0 CHECK (annual_quota >= 0),
  monthly_accrual     numeric(5,2) NOT NULL DEFAULT 0 CHECK (monthly_accrual >= 0),
  carry_forward       boolean NOT NULL DEFAULT false,
  carry_forward_max   numeric(5,2) NOT NULL DEFAULT 0 CHECK (carry_forward_max >= 0),
  max_balance         numeric(5,2) CHECK (max_balance IS NULL OR max_balance >= 0),
  requires_approval   boolean NOT NULL DEFAULT true,
  allow_half_day      boolean NOT NULL DEFAULT true,
  allow_during_probation boolean NOT NULL DEFAULT false,
  -- Negative balance permitted (leave taken before it accrues).
  allow_negative      boolean NOT NULL DEFAULT false,
  -- Counts as LOP in payroll. Unpaid types set this; it is derived from `paid`
  -- but kept explicit so an unpaid-but-not-LOP type stays expressible.
  counts_as_lop       boolean NOT NULL DEFAULT false,
  colour              text NOT NULL DEFAULT '#6366f1',
  sort_order          smallint NOT NULL DEFAULT 0,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER hr_leave_types_touch BEFORE UPDATE ON public.hr_leave_types
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

-- --- Balances (one row per employee / type / leave year) --------------------

CREATE TABLE public.hr_leave_balances (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,
  leave_type_id     uuid NOT NULL REFERENCES public.hr_leave_types(id) ON DELETE CASCADE,
  leave_year        smallint NOT NULL CHECK (leave_year BETWEEN 2000 AND 2100),

  -- Opening balance exists so a Zoho cut-over can carry real balances in.
  opening_balance   numeric(6,2) NOT NULL DEFAULT 0,
  accrued           numeric(6,2) NOT NULL DEFAULT 0 CHECK (accrued >= 0),
  carried_forward   numeric(6,2) NOT NULL DEFAULT 0 CHECK (carried_forward >= 0),
  used              numeric(6,2) NOT NULL DEFAULT 0 CHECK (used >= 0),
  -- Manual correction, signed, always with a reason in hr_audit_logs.
  adjusted          numeric(6,2) NOT NULL DEFAULT 0,

  balance           numeric(6,2) GENERATED ALWAYS AS
                      (opening_balance + accrued + carried_forward + adjusted - used) STORED,
  last_accrued_on   date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (employee_id, leave_type_id, leave_year)
);

CREATE INDEX hr_leave_balances_emp_idx ON public.hr_leave_balances (employee_id, leave_year);

CREATE TRIGGER hr_leave_balances_touch BEFORE UPDATE ON public.hr_leave_balances
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

-- --- Requests ----------------------------------------------------------------

CREATE TABLE public.hr_leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,
  leave_type_id   uuid NOT NULL REFERENCES public.hr_leave_types(id) ON DELETE RESTRICT,
  from_date       date NOT NULL,
  to_date         date NOT NULL,
  -- Half-day handling at either end of the range.
  from_half_day   boolean NOT NULL DEFAULT false,
  to_half_day     boolean NOT NULL DEFAULT false,
  -- Working days requested, excluding weekly offs and holidays. Computed on
  -- submit and re-verified on approval.
  days            numeric(5,2) NOT NULL CHECK (days > 0),
  reason          text NOT NULL DEFAULT '',
  contact_number  text NOT NULL DEFAULT '',

  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  applied_at      timestamptz NOT NULL DEFAULT now(),
  approver_id     uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  decision_note   text NOT NULL DEFAULT '',
  cancelled_at    timestamptz,
  cancel_reason   text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (to_date >= from_date)
);

CREATE INDEX hr_leave_requests_emp_idx     ON public.hr_leave_requests (employee_id, from_date DESC);
CREATE INDEX hr_leave_requests_pending_idx ON public.hr_leave_requests (status) WHERE status = 'pending';
CREATE INDEX hr_leave_requests_range_idx   ON public.hr_leave_requests (from_date, to_date);

CREATE TRIGGER hr_leave_requests_touch BEFORE UPDATE ON public.hr_leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

-- --- Expanded leave days -----------------------------------------------------

CREATE TABLE public.hr_leave_days (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id  uuid NOT NULL REFERENCES public.hr_leave_requests(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,
  leave_type_id     uuid NOT NULL REFERENCES public.hr_leave_types(id) ON DELETE RESTRICT,
  work_date         date NOT NULL,
  portion           numeric(3,2) NOT NULL DEFAULT 1.00 CHECK (portion IN (0.50, 1.00)),
  paid              boolean NOT NULL,
  counts_as_lop     boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- One live leave booking per employee per day. Rows only exist for approved
-- requests, so this is what stops double-booked leave.
CREATE UNIQUE INDEX hr_leave_days_one_per_day
  ON public.hr_leave_days (employee_id, work_date);
CREATE INDEX hr_leave_days_date_idx ON public.hr_leave_days (work_date);
CREATE INDEX hr_leave_days_req_idx  ON public.hr_leave_days (leave_request_id);

COMMENT ON TABLE public.hr_leave_days IS
  'Materialised on approval, one row per calendar day. Deleted if the request is later cancelled or rejected.';

-- --- Holiday calendar --------------------------------------------------------

CREATE TABLE public.hr_holidays (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  holiday_date  date NOT NULL,
  holiday_type  text NOT NULL DEFAULT 'public'
                  CHECK (holiday_type IN ('public', 'restricted', 'optional', 'company')),
  location      text NOT NULL DEFAULT 'Chennai',
  paid          boolean NOT NULL DEFAULT true,
  -- Optional/restricted holidays do not automatically exclude the working day;
  -- an employee must apply for them.
  auto_applies  boolean NOT NULL DEFAULT true,
  description   text NOT NULL DEFAULT '',
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (holiday_date, location, name)
);

CREATE INDEX hr_holidays_date_idx ON public.hr_holidays (holiday_date) WHERE active;

CREATE TRIGGER hr_holidays_touch BEFORE UPDATE ON public.hr_holidays
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

-- Late-added FKs on hr_attendance_daily, now that the targets exist.
ALTER TABLE public.hr_attendance_daily
  ADD CONSTRAINT hr_daily_leave_request_fk
    FOREIGN KEY (leave_request_id) REFERENCES public.hr_leave_requests(id) ON DELETE SET NULL,
  ADD CONSTRAINT hr_daily_holiday_fk
    FOREIGN KEY (holiday_id) REFERENCES public.hr_holidays(id) ON DELETE SET NULL;

-- --- Is this date a working day for this employee? --------------------------
-- One definition, used by leave-day counting, the daily summary and payroll.

CREATE OR REPLACE FUNCTION public.hr_is_weekly_off(p_schedule_id uuid, p_date date)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  v_offs smallint[];
  v_rule text;
  v_dow  smallint := extract(isodow FROM p_date)::smallint;
  v_nth  smallint := ((extract(day FROM p_date)::int - 1) / 7 + 1)::smallint;
BEGIN
  SELECT weekly_offs, saturday_rule INTO v_offs, v_rule
  FROM hr_work_schedules WHERE id = p_schedule_id;

  IF v_offs IS NULL THEN
    SELECT weekly_offs, saturday_rule INTO v_offs, v_rule
    FROM hr_work_schedules WHERE is_default LIMIT 1;
  END IF;

  IF v_offs IS NULL THEN
    v_offs := ARRAY[7]::smallint[];   -- Sunday only
    v_rule := 'none';
  END IF;

  IF v_dow = ANY (v_offs) THEN
    RETURN true;
  END IF;

  IF v_dow = 6 THEN                    -- Saturday
    RETURN CASE v_rule
      WHEN 'all'       THEN true
      WHEN '2nd_4th'   THEN v_nth IN (2, 4)
      WHEN '1st_3rd'   THEN v_nth IN (1, 3)
      WHEN 'alternate' THEN v_nth IN (2, 4)
      ELSE false
    END;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_is_holiday(p_location text, p_date date)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT h.id FROM hr_holidays h
  WHERE h.active AND h.auto_applies
    AND h.holiday_date = p_date
    AND h.location = COALESCE(p_location, 'Chennai')
  LIMIT 1;
$$;