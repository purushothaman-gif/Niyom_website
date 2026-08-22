-- =============================================================================
-- NIYOM HR & PAYROLL -- 05: salary components, structures and revisions
--
-- No Indian tax law is compiled in. PF, ESI, PT and TDS are ordinary rows in
-- hr_salary_components whose rates the admin owns; the engine only knows how to
-- evaluate `fixed`, `percent_of`, `balance` and `slab`.
--
-- Structures are EFFECTIVE-DATED, never overwritten. A revision from 01 Sep
-- closes the previous row at 31 Aug, so the August run keeps using the August
-- structure for ever.
-- =============================================================================

CREATE TABLE public.hr_salary_components (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  name               text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer_contribution')),

  -- fixed      : amount_monthly on the structure line
  -- percent_of : percent_value % of another component (or of gross/basic/ctc)
  -- balance    : whatever is left of gross after every other earning -- the
  --              classic Special Allowance plug. At most one per structure.
  -- slab       : looked up from hr_salary_component_slabs (professional tax)
  calc_type          text NOT NULL DEFAULT 'fixed'
                       CHECK (calc_type IN ('fixed', 'percent_of', 'balance', 'slab')),
  percent_of         text CHECK (percent_of IS NULL OR percent_of IN ('basic', 'gross', 'ctc', 'component')),
  percent_of_component_id uuid REFERENCES public.hr_salary_components(id) ON DELETE SET NULL,
  default_percent    numeric(6,3) CHECK (default_percent IS NULL OR default_percent >= 0),

  -- Caps applied to the computed amount, e.g. PF at 12% of Basic capped at the
  -- wage ceiling: cap_base caps the BASE before the percentage is applied,
  -- cap_amount caps the RESULT.
  cap_base           numeric(12,2) CHECK (cap_base IS NULL OR cap_base >= 0),
  cap_amount         numeric(12,2) CHECK (cap_amount IS NULL OR cap_amount >= 0),
  floor_amount       numeric(12,2) CHECK (floor_amount IS NULL OR floor_amount >= 0),
  -- Component only applies while this ceiling is not breached (ESI-style).
  eligibility_max_gross numeric(12,2) CHECK (eligibility_max_gross IS NULL OR eligibility_max_gross >= 0),

  -- Payroll behaviour
  prorate_on_lop     boolean NOT NULL DEFAULT true,
  taxable            boolean NOT NULL DEFAULT true,
  include_in_gross   boolean NOT NULL DEFAULT true,
  include_in_ctc     boolean NOT NULL DEFAULT true,
  show_on_payslip    boolean NOT NULL DEFAULT true,
  -- One-off components (bonus, incentive, reimbursement) are not part of the
  -- standing structure; they arrive as payroll adjustments.
  is_recurring       boolean NOT NULL DEFAULT true,

  description        text NOT NULL DEFAULT '',
  sort_order         smallint NOT NULL DEFAULT 0,
  active             boolean NOT NULL DEFAULT true,
  -- Seeded components the UI protects from deletion (they may still be edited
  -- or deactivated). Nothing about them is special to the engine.
  system_seeded      boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CHECK (calc_type <> 'percent_of' OR percent_of IS NOT NULL),
  CHECK (percent_of <> 'component' OR percent_of_component_id IS NOT NULL)
);

CREATE INDEX hr_salary_components_kind_idx ON public.hr_salary_components (kind, sort_order) WHERE active;

CREATE TRIGGER hr_salary_components_touch BEFORE UPDATE ON public.hr_salary_components
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

-- Slabs for calc_type = 'slab' (professional tax and anything shaped like it).
CREATE TABLE public.hr_salary_component_slabs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id  uuid NOT NULL REFERENCES public.hr_salary_components(id) ON DELETE CASCADE,
  from_amount   numeric(12,2) NOT NULL DEFAULT 0 CHECK (from_amount >= 0),
  to_amount     numeric(12,2) CHECK (to_amount IS NULL OR to_amount > from_amount),
  amount        numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  sort_order    smallint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hr_component_slabs_idx ON public.hr_salary_component_slabs (component_id, from_amount);

-- --- Effective-dated structures ---------------------------------------------

CREATE TABLE public.hr_salary_structures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id      uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,
  effective_from   date NOT NULL,
  effective_to     date,                      -- NULL = currently in force
  ctc_annual       numeric(14,2) NOT NULL DEFAULT 0 CHECK (ctc_annual >= 0),
  gross_monthly    numeric(14,2) NOT NULL DEFAULT 0 CHECK (gross_monthly >= 0),
  revision_reason  text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('draft', 'active', 'superseded')),
  created_by       uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- At most one open-ended structure per employee. Combined with the overlap
-- trigger below this is what keeps the effective-dated history sane. (An
-- EXCLUDE constraint over a daterange would be the textbook answer but needs
-- btree_gist, which this project does not have installed -- not worth adding an
-- extension for a rule a trigger states more clearly.)
CREATE UNIQUE INDEX hr_salary_structures_one_open
  ON public.hr_salary_structures (employee_id)
  WHERE effective_to IS NULL AND status <> 'draft';

CREATE INDEX hr_salary_structures_emp_idx ON public.hr_salary_structures (employee_id, effective_from DESC);

CREATE TRIGGER hr_salary_structures_touch BEFORE UPDATE ON public.hr_salary_structures
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

CREATE TABLE public.hr_salary_structure_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id   uuid NOT NULL REFERENCES public.hr_salary_structures(id) ON DELETE CASCADE,
  component_id   uuid NOT NULL REFERENCES public.hr_salary_components(id) ON DELETE RESTRICT,
  -- Snapshot of how the component was configured when the structure was saved,
  -- so editing the component master later cannot retroactively change a run.
  calc_type      text NOT NULL,
  amount_monthly numeric(12,2) NOT NULL DEFAULT 0,
  percent_value  numeric(6,3),
  sort_order     smallint NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),

  UNIQUE (structure_id, component_id)
);

CREATE INDEX hr_structure_lines_idx ON public.hr_salary_structure_lines (structure_id);

-- --- Overlap guard + auto-close of the previous structure --------------------

CREATE OR REPLACE FUNCTION public.hr_guard_structure_dates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_conflict record;
BEGIN
  IF NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- Close any still-open earlier structure the day before this one starts.
  IF TG_OP = 'INSERT' THEN
    UPDATE hr_salary_structures s
       SET effective_to = NEW.effective_from - 1,
           status       = 'superseded'
     WHERE s.employee_id = NEW.employee_id
       AND s.id <> NEW.id
       AND s.status <> 'draft'
       AND s.effective_to IS NULL
       AND s.effective_from < NEW.effective_from;
  END IF;

  -- Anything still overlapping is a genuine mistake, not a revision.
  SELECT s.id, s.effective_from, s.effective_to INTO v_conflict
  FROM hr_salary_structures s
  WHERE s.employee_id = NEW.employee_id
    AND s.id <> NEW.id
    AND s.status <> 'draft'
    AND daterange(s.effective_from, s.effective_to, '[]')
        && daterange(NEW.effective_from, NEW.effective_to, '[]')
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Salary structure overlaps an existing one effective % to %. Close the earlier revision first.',
      v_conflict.effective_from, COALESCE(v_conflict.effective_to::text, 'open')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER hr_salary_structures_dates
  BEFORE INSERT OR UPDATE OF effective_from, effective_to, status
  ON public.hr_salary_structures
  FOR EACH ROW EXECUTE FUNCTION public.hr_guard_structure_dates();

-- A structure referenced by a payroll record can never be edited or removed --
-- that is what makes historical payroll reproducible.
CREATE OR REPLACE FUNCTION public.hr_guard_structure_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_run text;
BEGIN
  SELECT r.period_year || '-' || lpad(r.period_month::text, 2, '0')
    INTO v_run
  FROM hr_payroll_employee_records rec
  JOIN hr_payroll_runs r ON r.id = rec.run_id
  WHERE rec.structure_id = COALESCE(OLD.id, OLD.structure_id)
    AND r.status IN ('approved', 'locked', 'paid')
  LIMIT 1;

  IF v_run IS NOT NULL THEN
    RAISE EXCEPTION
      'This salary structure is used by the locked % payroll and cannot be changed. Create a new revision instead.', v_run
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- Returns the structure in force for an employee on a given date.
CREATE OR REPLACE FUNCTION public.hr_structure_on(p_employee_id uuid, p_date date)
RETURNS uuid LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT s.id FROM hr_salary_structures s
  WHERE s.employee_id = p_employee_id
    AND s.status <> 'draft'
    AND s.effective_from <= p_date
    AND (s.effective_to IS NULL OR s.effective_to >= p_date)
  ORDER BY s.effective_from DESC
  LIMIT 1;
$$;