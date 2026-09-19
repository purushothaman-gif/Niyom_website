-- =============================================================================
-- Incentive: switch the multi-product mandate on/off for a month.
--
-- Some months admin waives the "N products at minimum threshold" requirement,
-- so eligibility rests on revenue alone. The structure version carries the
-- default (config.rules.product_mandate, absent = ON); a row here overrides it
-- for one revenue month. The OA bonus still needs its OA products either way.
--
-- Each statement records the setting it was calculated under
-- (inc_monthly_statements.product_mandate), so an approved month keeps showing
-- and paying what it was approved on even if the switch is flipped later.
-- =============================================================================

CREATE TABLE public.inc_month_settings (
  period_month    date PRIMARY KEY CHECK (extract(day FROM period_month) = 1),
  product_mandate boolean NOT NULL,
  reason          text NOT NULL DEFAULT '',
  updated_by      uuid REFERENCES public.nw_employees(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inc_month_settings_updated_by_idx ON public.inc_month_settings (updated_by);

ALTER TABLE public.inc_month_settings ENABLE ROW LEVEL SECURITY;
-- Every employee needs it: their tracker must apply the same rule the board does.
CREATE POLICY inc_month_settings_read ON public.inc_month_settings
  FOR SELECT TO authenticated USING ((SELECT nw_current_employee_id()) IS NOT NULL);

-- The mandate a statement was calculated under. NULL = saved before this
-- existed, which is the structure default (ON).
ALTER TABLE public.inc_monthly_statements ADD COLUMN IF NOT EXISTS product_mandate boolean;

ALTER TABLE public.inc_events DROP CONSTRAINT IF EXISTS inc_events_event_check;
ALTER TABLE public.inc_events ADD CONSTRAINT inc_events_event_check
  CHECK (event IN ('plan_version_created', 'statement_saved', 'approved', 'reopened',
                   'pushed_to_payroll', 'removed_from_payroll', 'month_setting_changed'));

-- --- Flip the switch for a month (NULL = back to the structure default) -------

CREATE OR REPLACE FUNCTION public.inc_set_month_setting(
  p_period_month date, p_product_mandate boolean, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_period date := date_trunc('month', p_period_month)::date;
  v_prev   boolean;
BEGIN
  PERFORM inc_require_admin();
  IF p_period_month IS NULL THEN
    RAISE EXCEPTION 'Choose the month.' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Give a reason for changing the product requirement.' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT product_mandate INTO v_prev FROM inc_month_settings WHERE period_month = v_period;

  IF p_product_mandate IS NULL THEN
    DELETE FROM inc_month_settings WHERE period_month = v_period;
  ELSE
    INSERT INTO inc_month_settings (period_month, product_mandate, reason, updated_by, updated_at)
    VALUES (v_period, p_product_mandate, btrim(p_reason), nw_current_employee_id(), now())
    ON CONFLICT (period_month) DO UPDATE
      SET product_mandate = EXCLUDED.product_mandate, reason = EXCLUDED.reason,
          updated_by = EXCLUDED.updated_by, updated_at = now();
  END IF;

  PERFORM inc_log('month_setting_changed', NULL, NULL, v_period, btrim(p_reason),
                  jsonb_build_object('product_mandate', v_prev),
                  jsonb_build_object('product_mandate', p_product_mandate));
END;
$$;

REVOKE ALL ON FUNCTION public.inc_set_month_setting(date, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inc_set_month_setting(date, boolean, text) TO authenticated;

-- --- inc_save_statement records the mandate it was calculated under ----------
-- New trailing parameter, so the old signature is dropped rather than left as
-- a second overload that would silently save without it.

DROP FUNCTION IF EXISTS public.inc_save_statement(uuid, date, uuid, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, numeric, text);

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
  p_override_reason  text,
  p_product_mandate  boolean DEFAULT NULL
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
    final_amount, status, updated_by, product_mandate)
  VALUES (
    p_employee_id, v_period, p_plan_version_id, round(COALESCE(p_salary, 0), 2),
    round(COALESCE(p_revenue_auto, 0), 2), round(p_revenue_override, 2),
    COALESCE(p_volumes_auto, '{}'::jsonb), COALESCE(p_volumes_manual, '{}'::jsonb),
    COALESCE(p_result, '{}'::jsonb), round(COALESCE(p_computed_amount, 0), 2),
    round(p_amount_override, 2), v_reason,
    round(COALESCE(p_amount_override, p_computed_amount, 0), 2), 'draft', nw_current_employee_id(),
    p_product_mandate)
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
    updated_by       = EXCLUDED.updated_by,
    product_mandate  = EXCLUDED.product_mandate
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

REVOKE ALL ON FUNCTION public.inc_save_statement(uuid, date, uuid, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, numeric, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inc_save_statement(uuid, date, uuid, numeric, numeric, numeric, jsonb, jsonb, jsonb, numeric, numeric, text, boolean) TO authenticated;
