-- =============================================================================
-- Employee incentive module.
--
-- The formula itself lives in ONE place, shared/incentive/incentiveEngine.ts,
-- which the tracker and the admin board both run. This migration stores:
--
--   inc_plan_versions       the structure (bands, product thresholds, rules) as
--                           effective-dated, insert-only versions. Admin
--                           "changes the structure" by adding a version from a
--                           chosen month, so every past month stays
--                           reproducible under the rules it was paid on.
--   inc_monthly_statements  one row per employee per REVENUE month. A draft
--                           holds admin's manual figures (SIP, insurance, any
--                           override); approval freezes the full calculation.
--                           The freeze matters: MIS credits revenue to a
--                           client's CURRENT owner, so a later reassignment
--                           would otherwise rewrite a month already paid.
--   inc_events              audit trail of every change.
--
-- PAYROLL. Revenue of month M is paid with the salary of month M+1. Approved
-- statements are pushed into that run as ordinary hr_payroll_adjustments on
-- the seeded INCENT component, so the payroll engine, payslips and bank file
-- need no change. The adjustment carries incentive_statement_id; deleting it
-- in payroll unlinks the statement (trigger below), so it can be re-sent.
--
-- TRUST. The amounts are computed in the admin's browser by the shared engine
-- and written through admin-only RPCs. That is deliberate: admin may override
-- the amount outright, so re-deriving it here would add a second copy of the
-- formula without adding any protection. Employees can read, never write.
-- =============================================================================

-- --- Structure versions ------------------------------------------------------

CREATE TABLE public.inc_plan_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from  date NOT NULL CHECK (extract(day FROM effective_from) = 1),
  config          jsonb NOT NULL,
  note            text NOT NULL CHECK (length(btrim(note)) >= 3),
  created_by      uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inc_plan_versions_effective_idx ON public.inc_plan_versions (effective_from DESC, created_at DESC);

COMMENT ON TABLE public.inc_plan_versions IS
  'Incentive structure, effective-dated and insert-only. The version for a month is the latest effective_from <= that month (latest created_at breaks ties). Shape validated by parseIncentiveConfig in shared/incentive/incentiveEngine.ts.';

-- --- Monthly statements ------------------------------------------------------

CREATE TABLE public.inc_monthly_statements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id        uuid NOT NULL REFERENCES public.nw_employees(id) ON DELETE CASCADE,
  -- The REVENUE month (1st of month). Paid in the following month's payroll.
  period_month       date NOT NULL CHECK (extract(day FROM period_month) = 1),
  plan_version_id    uuid REFERENCES public.inc_plan_versions(id) ON DELETE RESTRICT,

  salary             numeric(14,2) NOT NULL DEFAULT 0,
  revenue_auto       numeric(14,2) NOT NULL DEFAULT 0,
  revenue_override   numeric(14,2),
  volumes_auto       jsonb NOT NULL DEFAULT '{}'::jsonb,
  volumes_manual     jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Full engine output at the last save; frozen once approved.
  result             jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_amount    numeric(14,2) NOT NULL DEFAULT 0 CHECK (computed_amount >= 0),
  amount_override    numeric(14,2) CHECK (amount_override >= 0),
  override_reason    text NOT NULL DEFAULT '',
  final_amount       numeric(14,2) NOT NULL DEFAULT 0 CHECK (final_amount >= 0),

  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  approved_by        uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  approved_at        timestamptz,

  payroll_run_id        uuid REFERENCES public.hr_payroll_runs(id) ON DELETE SET NULL,
  payroll_adjustment_id uuid,

  updated_by         uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (employee_id, period_month)
);
CREATE INDEX inc_monthly_statements_period_idx ON public.inc_monthly_statements (period_month, status);
CREATE INDEX inc_monthly_statements_plan_idx ON public.inc_monthly_statements (plan_version_id);
CREATE INDEX inc_monthly_statements_run_idx ON public.inc_monthly_statements (payroll_run_id);

CREATE TRIGGER inc_monthly_statements_touch BEFORE UPDATE ON public.inc_monthly_statements
  FOR EACH ROW EXECUTE FUNCTION public.hr_touch_updated_at();

-- --- Audit -------------------------------------------------------------------

CREATE TABLE public.inc_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event         text NOT NULL CHECK (event IN
                  ('plan_version_created', 'statement_saved', 'approved', 'reopened',
                   'pushed_to_payroll', 'removed_from_payroll')),
  statement_id  uuid REFERENCES public.inc_monthly_statements(id) ON DELETE SET NULL,
  employee_id   uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  period_month  date,
  actor_employee_id uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  actor_name    text NOT NULL DEFAULT '',
  reason        text NOT NULL DEFAULT '',
  before_value  jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_value   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inc_events_created_idx ON public.inc_events (created_at DESC);
CREATE INDEX inc_events_statement_idx ON public.inc_events (statement_id);
CREATE INDEX inc_events_employee_idx ON public.inc_events (employee_id);
CREATE INDEX inc_events_actor_idx ON public.inc_events (actor_employee_id);

-- --- Payroll link (additive) -------------------------------------------------

ALTER TABLE public.hr_payroll_adjustments
  ADD COLUMN incentive_statement_id uuid UNIQUE
    REFERENCES public.inc_monthly_statements(id) ON DELETE SET NULL;

ALTER TABLE public.hr_payroll_events DROP CONSTRAINT IF EXISTS hr_payroll_events_event_check;
ALTER TABLE public.hr_payroll_events ADD CONSTRAINT hr_payroll_events_event_check
  CHECK (event IN ('opened', 'calculated', 'recalculated', 'approved', 'locked',
                   'reopened', 'marked_paid', 'payslips_published',
                   'bank_file_generated', 'cancelled',
                   'lop_waived', 'lop_waiver_removed', 'incentives_imported'));

-- --- RLS ---------------------------------------------------------------------

ALTER TABLE public.inc_plan_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inc_monthly_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inc_events             ENABLE ROW LEVEL SECURITY;

-- The structure is transparent: every employee needs it to see their goals.
CREATE POLICY inc_plan_versions_read ON public.inc_plan_versions
  FOR SELECT TO authenticated USING ((SELECT nw_current_employee_id()) IS NOT NULL);

-- Own statements only; admins see all.
CREATE POLICY inc_monthly_statements_read ON public.inc_monthly_statements
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT nw_current_employee_id()) OR (SELECT nw_current_emp_is_admin()));

CREATE POLICY inc_events_read ON public.inc_events
  FOR SELECT TO authenticated USING ((SELECT nw_current_emp_is_admin()));

-- No write policies: every write goes through the RPCs below.

-- --- Helpers -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inc_require_admin()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can change incentives.' USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.inc_log(
  p_event text, p_statement_id uuid, p_employee_id uuid, p_period date,
  p_reason text, p_before jsonb, p_after jsonb
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO inc_events (event, statement_id, employee_id, period_month,
                          actor_employee_id, actor_name, reason, before_value, after_value)
  SELECT p_event, p_statement_id, p_employee_id, p_period,
         e.id, COALESCE(e.full_name, ''), COALESCE(p_reason, ''),
         COALESCE(p_before, '{}'::jsonb), COALESCE(p_after, '{}'::jsonb)
  FROM (SELECT 1) one
  LEFT JOIN nw_employees e ON e.auth_user_id = auth.uid();
$$;

-- --- Create a structure version ---------------------------------------------

CREATE OR REPLACE FUNCTION public.inc_create_plan_version(
  p_effective_from date, p_config jsonb, p_note text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM inc_require_admin();
  IF p_effective_from IS NULL THEN
    RAISE EXCEPTION 'Choose the month this structure takes effect from.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_note IS NULL OR length(btrim(p_note)) < 3 THEN
    RAISE EXCEPTION 'Describe what changed in this structure.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF jsonb_typeof(p_config -> 'bands') <> 'array' OR jsonb_array_length(p_config -> 'bands') = 0
     OR jsonb_typeof(p_config -> 'products') <> 'array'
     OR jsonb_typeof(p_config -> 'rules') <> 'object' THEN
    RAISE EXCEPTION 'The structure is incomplete (bands, products and rules are required).' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO inc_plan_versions (effective_from, config, note, created_by)
  VALUES (date_trunc('month', p_effective_from)::date, p_config, btrim(p_note), nw_current_employee_id())
  RETURNING id INTO v_id;

  PERFORM inc_log('plan_version_created', NULL, NULL, date_trunc('month', p_effective_from)::date,
                  btrim(p_note), NULL, jsonb_build_object('plan_version_id', v_id));
  RETURN v_id;
END;
$$;

-- --- Save (upsert) a draft statement ----------------------------------------

CREATE OR REPLACE FUNCTION public.inc_save_statement(
  p_employee_id      uuid,
  p_period_month     date,
  p_plan_version_id  uuid,
  p_salary           numeric,
  p_revenue_auto     numeric,
  p_revenue_override numeric,
  p_volumes_auto     jsonb,
  p_volumes_manual   jsonb,
  p_result           jsonb,
  p_computed_amount  numeric,
  p_amount_override  numeric,
  p_override_reason  text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_period date := date_trunc('month', p_period_month)::date;
  v_prev   inc_monthly_statements;
  v_id     uuid;
  v_reason text := btrim(COALESCE(p_override_reason, ''));
BEGIN
  PERFORM inc_require_admin();

  IF NOT EXISTS (SELECT 1 FROM nw_employees WHERE id = p_employee_id) THEN
    RAISE EXCEPTION 'Employee not found.' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF (p_revenue_override IS NOT NULL OR p_amount_override IS NOT NULL) AND length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Give a reason for the override.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF COALESCE(p_computed_amount, 0) < 0 OR COALESCE(p_amount_override, 0) < 0 THEN
    RAISE EXCEPTION 'Incentive amounts cannot be negative.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT * INTO v_prev FROM inc_monthly_statements
   WHERE employee_id = p_employee_id AND period_month = v_period;
  IF FOUND AND v_prev.status = 'approved' THEN
    RAISE EXCEPTION 'This incentive is already approved. Reopen it before changing it.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO inc_monthly_statements (
    employee_id, period_month, plan_version_id, salary, revenue_auto, revenue_override,
    volumes_auto, volumes_manual, result, computed_amount, amount_override, override_reason,
    final_amount, status, updated_by)
  VALUES (
    p_employee_id, v_period, p_plan_version_id, round(COALESCE(p_salary, 0), 2),
    round(COALESCE(p_revenue_auto, 0), 2), round(p_revenue_override, 2),
    COALESCE(p_volumes_auto, '{}'::jsonb), COALESCE(p_volumes_manual, '{}'::jsonb),
    COALESCE(p_result, '{}'::jsonb), round(COALESCE(p_computed_amount, 0), 2),
    round(p_amount_override, 2), v_reason,
    round(COALESCE(p_amount_override, p_computed_amount, 0), 2), 'draft', nw_current_employee_id())
  ON CONFLICT (employee_id, period_month) DO UPDATE SET
    plan_version_id  = EXCLUDED.plan_version_id,
    salary           = EXCLUDED.salary,
    revenue_auto     = EXCLUDED.revenue_auto,
    revenue_override = EXCLUDED.revenue_override,
    volumes_auto     = EXCLUDED.volumes_auto,
    volumes_manual   = EXCLUDED.volumes_manual,
    result           = EXCLUDED.result,
    computed_amount  = EXCLUDED.computed_amount,
    amount_override  = EXCLUDED.amount_override,
    override_reason  = EXCLUDED.override_reason,
    final_amount     = EXCLUDED.final_amount,
    updated_by       = EXCLUDED.updated_by
  RETURNING id INTO v_id;

  PERFORM inc_log('statement_saved', v_id, p_employee_id, v_period, v_reason,
    CASE WHEN v_prev.id IS NULL THEN NULL ELSE jsonb_build_object(
      'revenue_override', v_prev.revenue_override, 'volumes_manual', v_prev.volumes_manual,
      'amount_override', v_prev.amount_override, 'final_amount', v_prev.final_amount) END,
    jsonb_build_object(
      'revenue_override', p_revenue_override, 'volumes_manual', p_volumes_manual,
      'amount_override', p_amount_override,
      'final_amount', COALESCE(p_amount_override, p_computed_amount, 0)));
  RETURN v_id;
END;
$$;

-- --- Approve / reopen --------------------------------------------------------

CREATE OR REPLACE FUNCTION public.inc_approve_statements(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_n integer := 0; r record;
BEGIN
  PERFORM inc_require_admin();
  FOR r IN
    UPDATE inc_monthly_statements
       SET status = 'approved', approved_by = nw_current_employee_id(), approved_at = now()
     WHERE id = ANY(p_ids) AND status = 'draft'
    RETURNING id, employee_id, period_month, final_amount
  LOOP
    v_n := v_n + 1;
    PERFORM inc_log('approved', r.id, r.employee_id, r.period_month, '', NULL,
                    jsonb_build_object('final_amount', r.final_amount));
  END LOOP;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.inc_reopen_statement(p_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s inc_monthly_statements;
BEGIN
  PERFORM inc_require_admin();
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Give a reason for reopening.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO s FROM inc_monthly_statements WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incentive statement not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF s.payroll_adjustment_id IS NOT NULL THEN
    RAISE EXCEPTION 'This incentive is already in a payroll run. Remove it from payroll first.' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE inc_monthly_statements SET status = 'draft', approved_by = NULL, approved_at = NULL WHERE id = p_id;
  PERFORM inc_log('reopened', p_id, s.employee_id, s.period_month, btrim(p_reason),
                  jsonb_build_object('status', s.status), jsonb_build_object('status', 'draft'));
END;
$$;

-- --- Push approved incentives into the following month's payroll ------------

CREATE OR REPLACE FUNCTION public.inc_push_to_payroll(p_period_month date, p_run_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_period   date := date_trunc('month', p_period_month)::date;
  v_pay      date := (date_trunc('month', p_period_month) + interval '1 month')::date;
  run        hr_payroll_runs;
  v_comp     uuid;
  v_label    text := 'Incentive – ' || to_char(date_trunc('month', p_period_month), 'Mon YYYY');
  v_adj      uuid;
  v_n        integer := 0;
  v_total    numeric := 0;
  s          record;
BEGIN
  PERFORM inc_require_admin();

  SELECT * INTO run FROM hr_payroll_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF run.period_year <> extract(year FROM v_pay) OR run.period_month <> extract(month FROM v_pay) THEN
    RAISE EXCEPTION 'Incentive for % is paid in the % payroll, not this run.',
      to_char(v_period, 'Mon YYYY'), to_char(v_pay, 'Mon YYYY') USING ERRCODE = 'check_violation';
  END IF;
  IF run.status NOT IN ('draft', 'processing', 'review') THEN
    RAISE EXCEPTION 'This payroll is % and cannot take new incentives. Reopen it first.', run.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_comp FROM hr_salary_components WHERE code = 'INCENT' AND active LIMIT 1;
  IF v_comp IS NULL THEN
    RAISE EXCEPTION 'The "INCENT" salary component is missing or inactive.' USING ERRCODE = 'no_data_found';
  END IF;

  FOR s IN
    SELECT id, employee_id, final_amount FROM inc_monthly_statements
     WHERE period_month = v_period AND status = 'approved'
       AND payroll_adjustment_id IS NULL AND final_amount > 0
     FOR UPDATE
  LOOP
    INSERT INTO hr_payroll_adjustments (run_id, employee_id, component_id, label, kind, amount,
                                        prorate_on_lop, taxable, reason, created_by, incentive_statement_id)
    VALUES (p_run_id, s.employee_id, v_comp, v_label, 'earning', s.final_amount,
            false, true, 'Incentive on ' || to_char(v_period, 'Mon YYYY') || ' revenue',
            nw_current_employee_id(), s.id)
    RETURNING id INTO v_adj;

    UPDATE inc_monthly_statements SET payroll_run_id = p_run_id, payroll_adjustment_id = v_adj WHERE id = s.id;
    PERFORM inc_log('pushed_to_payroll', s.id, s.employee_id, v_period, '', NULL,
                    jsonb_build_object('run_id', p_run_id, 'amount', s.final_amount));
    v_n := v_n + 1;
    v_total := v_total + s.final_amount;
  END LOOP;

  IF v_n > 0 THEN
    INSERT INTO hr_payroll_events (run_id, event, actor_employee_id, actor_name, after_value)
    SELECT p_run_id, 'incentives_imported', e.id, e.full_name,
           jsonb_build_object('revenue_month', v_period, 'count', v_n, 'total', v_total)
    FROM nw_employees e WHERE e.auth_user_id = auth.uid();
  END IF;
  RETURN v_n;
END;
$$;

-- --- Keep the link honest when payroll removes or edits the adjustment -------

CREATE OR REPLACE FUNCTION public.inc_adjustment_link_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.incentive_statement_id IS NOT NULL THEN
      UPDATE inc_monthly_statements SET payroll_run_id = NULL, payroll_adjustment_id = NULL
       WHERE id = OLD.incentive_statement_id;
      INSERT INTO inc_events (event, statement_id, employee_id, actor_employee_id, actor_name, before_value)
      SELECT 'removed_from_payroll', OLD.incentive_statement_id, OLD.employee_id, e.id, COALESCE(e.full_name, ''),
             jsonb_build_object('run_id', OLD.run_id, 'amount', OLD.amount)
      FROM (SELECT 1) one LEFT JOIN nw_employees e ON e.auth_user_id = auth.uid();
    END IF;
    RETURN OLD;
  END IF;
  -- An incentive line's amount is owned by the approved statement. Changing it
  -- in payroll would pay a figure the incentive record does not show.
  IF OLD.incentive_statement_id IS NOT NULL
     AND (NEW.amount IS DISTINCT FROM OLD.amount
          OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
          OR NEW.incentive_statement_id IS DISTINCT FROM OLD.incentive_statement_id) THEN
    RAISE EXCEPTION 'This incentive line comes from Incentive Admin. Delete it here, reopen and change it there, then send it again.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hr_payroll_adjustments_incentive_link
  BEFORE UPDATE OR DELETE ON public.hr_payroll_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.inc_adjustment_link_guard();

-- --- Grants ------------------------------------------------------------------
-- REVOKE FROM PUBLIC, anon does NOT remove authenticated's default EXECUTE, so
-- internal helpers revoke it explicitly.

REVOKE ALL ON FUNCTION public.inc_require_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inc_log(text, uuid, uuid, date, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inc_adjustment_link_guard() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.inc_create_plan_version(date, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inc_save_statement(uuid, date, uuid, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inc_approve_statements(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inc_reopen_statement(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.inc_push_to_payroll(date, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.inc_create_plan_version(date, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inc_save_statement(uuid, date, uuid, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inc_approve_statements(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inc_reopen_statement(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inc_push_to_payroll(date, uuid) TO authenticated;

-- --- Seed version 1: the management workbook --------------------------------
-- Mirrors DEFAULT_CONFIG_V1 in shared/incentive/incentiveEngine.ts.

INSERT INTO public.inc_plan_versions (effective_from, config, note) VALUES (
  '2026-01-01',
  $json${
    "bands": [
      {"lower_x": 0,   "label": "0x–2x",     "note": "No incentive",                 "base_mult": 0,   "addon_pct": 0,     "oa_pct": 0},
      {"lower_x": 2,   "label": "2x–3x",     "note": "Entry band",                   "base_mult": 0.1, "addon_pct": 0,     "oa_pct": 0},
      {"lower_x": 3,   "label": "3x–4x",     "note": "Ramp band",                    "base_mult": 0.4, "addon_pct": 0.045, "oa_pct": 0},
      {"lower_x": 4,   "label": "4x–5x",     "note": "Growth band",                  "base_mult": 0.6, "addon_pct": 0.05,  "oa_pct": 0},
      {"lower_x": 5,   "label": "5x–5.5x",   "note": "Target band",                  "base_mult": 0.8, "addon_pct": 0.075, "oa_pct": 0.05},
      {"lower_x": 5.5, "label": "5.5x–7x",   "note": "Direct revenue add-on starts", "base_mult": 1.6, "addon_pct": 0.08,  "oa_pct": 0.075},
      {"lower_x": 7,   "label": "7x–9x",     "note": "High performer",               "base_mult": 2.0, "addon_pct": 0.085, "oa_pct": 0.075},
      {"lower_x": 9,   "label": "9x–12x",    "note": "Elite",                        "base_mult": 2.4, "addon_pct": 0.09,  "oa_pct": 0.075},
      {"lower_x": 12,  "label": "12x–16x",   "note": "Top tier",                     "base_mult": 3.5, "addon_pct": 0.15,  "oa_pct": 0.08},
      {"lower_x": 16,  "label": "16x–20x",   "note": "Superstar",                    "base_mult": 4.0, "addon_pct": 0.2,   "oa_pct": 0.09},
      {"lower_x": 20,  "label": "Above 20x", "note": "Exceptional performer",        "base_mult": 4.5, "addon_pct": 0.25,  "oa_pct": 0.1}
    ],
    "products": [
      {"key": "mf",        "label": "Mutual Fund",        "unit": "₹ mobilized",      "min_threshold": 100000, "oa_threshold": 1000000},
      {"key": "sip",       "label": "SIP",                "unit": "₹ monthly SIP",    "min_threshold": 3000,   "oa_threshold": 25000},
      {"key": "bond_fd",   "label": "Bond / FD",          "unit": "₹ mobilized",      "min_threshold": 500000, "oa_threshold": 5000000},
      {"key": "unlisted",  "label": "Unlisted / Pre-IPO", "unit": "₹ invested",       "min_threshold": 100000, "oa_threshold": 2500000},
      {"key": "insurance", "label": "Insurance",          "unit": "₹ annual premium", "min_threshold": 25000,  "oa_threshold": 150000}
    ],
    "rules": {
      "min_x": 2, "product_switch_x": 10,
      "products_required_below_switch": 3, "products_required_at_or_above_switch": 1,
      "addon_min_x": 5.5, "oa_products_required": 3, "cap_pct_revenue": 0.5
    },
    "policy_notes": [
      "Incentive is provisional until the firm receives commission/revenue from the product house or issuer.",
      "If a client closes, cancels, redeems, or reverses the product before the vesting window, the related incentive is clawed back.",
      "Mutual Fund: hold 6 months for SIP / 3 months for lumpsum. SIP must survive at least 3 successful deductions.",
      "Bond / FD: incentive releases only after commission confirmation; if closed early and commission is reversed, incentive is reversed.",
      "Unlisted / Pre-IPO: payout only after allotment / acceptance; reversal applies if transaction is cancelled before completion.",
      "Insurance: subject to free-look and policy persistence; clawback applies for lapse / cancellation within insurer clawback period.",
      "Overachievement bonus is paid only if at least 3 overachievement thresholds are met in the same month."
    ]
  }$json$::jsonb,
  'Version 1 — Niyom Wealth incentive auto-calculator workbook'
);
