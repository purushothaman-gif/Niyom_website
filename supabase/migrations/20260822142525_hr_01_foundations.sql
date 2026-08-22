-- =============================================================================
-- NIYOM HR & PAYROLL -- 01: foundations
--
-- Helper functions, the HR permission model, org-wide settings, work schedules
-- and pay schedules. Nothing here touches an existing table.
--
-- TIMEZONE: the database runs in UTC, the business runs in IST. Every date this
-- module derives from a timestamp goes through hr_ist_date(); a bare
-- current_date would mis-date every punch made after 18:30 IST.
-- =============================================================================

-- --- Time helpers ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.hr_ist_date(p_ts timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT (p_ts AT TIME ZONE 'Asia/Kolkata')::date;
$$;

CREATE OR REPLACE FUNCTION public.hr_ist_now()
RETURNS timestamp LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata');
$$;

CREATE OR REPLACE FUNCTION public.hr_today()
RETURNS date LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date;
$$;

COMMENT ON FUNCTION public.hr_ist_date(timestamptz) IS
  'The IST calendar date of a timestamp. All HR work_date values are derived through this.';

-- --- HR permission model -----------------------------------------------------
-- Deliberately NOT a new value in nw_employees.role: ~40 existing RLS policies
-- test `role IN (''admin'',''super_admin'')`, and adding a fourth role would
-- silently change all of them. HR capability is an independent axis.

CREATE TABLE public.hr_role_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hr_role     text NOT NULL CHECK (hr_role IN ('hr_admin', 'manager')),
  module      text NOT NULL CHECK (module IN (
                'employees', 'attendance', 'leave', 'holidays',
                'salary', 'payroll', 'payslips', 'reports', 'settings')),
  can_view    boolean NOT NULL DEFAULT false,
  can_edit    boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hr_role, module)
);

COMMENT ON TABLE public.hr_role_permissions IS
  'What an hr_admin / manager may reach. Super admin narrows HR access here; a super_admin/admin always has full access regardless of these rows.';

-- --- Org settings (single row) -----------------------------------------------

CREATE TABLE public.hr_settings (
  id                      smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name            text NOT NULL DEFAULT 'NIYOM WEALTH DISTRIBUTION LLP',
  company_address         text NOT NULL DEFAULT '',
  company_logo_url        text NOT NULL DEFAULT '/niyomlogo.png',
  payslip_number_format   text NOT NULL DEFAULT 'NIYOM/PAY/{YYYY}/{MM}/{EMPCODE}',
  payslip_footer_note     text NOT NULL DEFAULT 'This is a computer generated payslip and does not require a signature.',
  signatory_name          text NOT NULL DEFAULT '',
  signatory_designation   text NOT NULL DEFAULT '',
  signatory_signature_url text,
  notify_payroll_ready    boolean NOT NULL DEFAULT true,
  notify_missing_punch    boolean NOT NULL DEFAULT true,
  notify_payslip_published boolean NOT NULL DEFAULT true,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL
);

COMMENT ON COLUMN public.hr_settings.payslip_number_format IS
  'Tokens: {YYYY} {YY} {MM} {MMM} {EMPCODE} {SEQ}. Rendered by hr_payslip_number().';

-- --- Work schedules ----------------------------------------------------------

CREATE TABLE public.hr_work_schedules (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL UNIQUE,
  -- ISO day-of-week numbers that are weekly offs: 1=Mon .. 7=Sun.
  weekly_offs          smallint[] NOT NULL DEFAULT ARRAY[7]::smallint[],
  -- Saturdays that are ALSO off, on top of weekly_offs.
  saturday_rule        text NOT NULL DEFAULT 'none'
                         CHECK (saturday_rule IN ('none', 'all', '2nd_4th', '1st_3rd', 'alternate')),
  daily_hours          numeric(4,2) NOT NULL DEFAULT 8.00 CHECK (daily_hours > 0 AND daily_hours <= 24),
  is_default           boolean NOT NULL DEFAULT false,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX hr_work_schedules_one_default
  ON public.hr_work_schedules (is_default) WHERE is_default;

COMMENT ON COLUMN public.hr_work_schedules.weekly_offs IS
  'ISO dow: 1=Monday .. 7=Sunday, matching extract(isodow).';

-- --- Pay schedules -----------------------------------------------------------

CREATE TABLE public.hr_pay_schedules (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL UNIQUE,
  frequency              text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly')),
  -- Day of the month the payroll period starts on; 1 = calendar month.
  period_start_day       smallint NOT NULL DEFAULT 1 CHECK (period_start_day BETWEEN 1 AND 28),
  -- Cut-offs, as a day of the month. NULL = end of period.
  attendance_cutoff_day  smallint CHECK (attendance_cutoff_day BETWEEN 1 AND 31),
  lop_cutoff_day         smallint CHECK (lop_cutoff_day BETWEEN 1 AND 31),
  processing_day         smallint CHECK (processing_day BETWEEN 1 AND 31),
  payment_day            smallint CHECK (payment_day BETWEEN 1 AND 31),
  -- Which day counts as "last working day" for the auto-prepare job.
  last_working_day_rule  text NOT NULL DEFAULT 'last_working_day'
                           CHECK (last_working_day_rule IN ('last_calendar_day', 'last_working_day', 'fixed_day')),
  last_working_fixed_day smallint CHECK (last_working_fixed_day BETWEEN 1 AND 31),
  -- The divisor in: per-day pay = monthly gross / divisor. Configurable because
  -- organisations genuinely differ here; hardcoding one is a payroll bug.
  lop_divisor_mode       text NOT NULL DEFAULT 'calendar_days'
                           CHECK (lop_divisor_mode IN ('calendar_days', 'working_days', 'payable_days', 'fixed_30')),
  round_net_to_rupee     boolean NOT NULL DEFAULT true,
  is_default             boolean NOT NULL DEFAULT false,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX hr_pay_schedules_one_default
  ON public.hr_pay_schedules (is_default) WHERE is_default;

COMMENT ON COLUMN public.hr_pay_schedules.lop_divisor_mode IS
  'LOP = monthly gross / divisor * lop_days. calendar_days | working_days | payable_days | fixed_30.';

-- --- updated_at touch trigger, reused by every hr_ table ---------------------

CREATE OR REPLACE FUNCTION public.hr_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER hr_work_schedules_touch BEFORE UPDATE ON public.hr_work_schedules
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();
CREATE TRIGGER hr_pay_schedules_touch BEFORE UPDATE ON public.hr_pay_schedules
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();
CREATE TRIGGER hr_settings_touch BEFORE UPDATE ON public.hr_settings
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();
CREATE TRIGGER hr_role_permissions_touch BEFORE UPDATE ON public.hr_role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();