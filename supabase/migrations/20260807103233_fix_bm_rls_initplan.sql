-- Perf fix 2026-08-07 (part 3 of 3): bond master tables, same bare-helper bug
-- as nw_leads (see 20260807102000). Found by sweeping pg_policies for helper
-- calls NOT preceded by "( SELECT " on any table with >1,000 live rows.
--
-- Affected: bm_coupon_schedule 5,570 rows, bm_cashflow_schedule 4,956,
-- bm_field_provenance 4,366, bm_price_history 1,820 (plus the smaller bm_*
-- tables, rewritten here too so the whole module is consistent).
--
-- Measured on bm_cashflow_schedule (count of all rows):
--   135 ms -> 1.3 ms, buffers 5,019 -> 27
--   planner also switches Seq Scan -> Index Only Scan (Heap Fetches: 0)
--
-- Predicates unchanged. Verified post-apply across all three roles:
--   super_admin — bonds 218, provenance 4,366, cashflow 4,956, coupon 5,570
--   employee    — cashflow 4,956, coupon 5,570, price 1,820, holiday 50;
--                 bonds 0 and provenance 0 (correctly admin-only)
--   anon        — 0 everywhere
-- All match ground truth computed without RLS.

ALTER POLICY bm_bonds_admin_all ON public.bm_bonds
  USING ((SELECT public.nw_current_emp_is_admin()))
  WITH CHECK ((SELECT public.nw_current_emp_is_admin()));

ALTER POLICY bm_issuers_admin_all ON public.bm_issuers
  USING ((SELECT public.nw_current_emp_is_admin()))
  WITH CHECK ((SELECT public.nw_current_emp_is_admin()));

ALTER POLICY bm_field_provenance_admin_all ON public.bm_field_provenance
  USING ((SELECT public.nw_current_emp_is_admin()))
  WITH CHECK ((SELECT public.nw_current_emp_is_admin()));

ALTER POLICY bm_provider_log_admin_all ON public.bm_provider_log
  USING ((SELECT public.nw_current_emp_is_admin()))
  WITH CHECK ((SELECT public.nw_current_emp_is_admin()));

ALTER POLICY bm_verification_queue_admin_all ON public.bm_verification_queue
  USING ((SELECT public.nw_current_emp_is_admin()))
  WITH CHECK ((SELECT public.nw_current_emp_is_admin()));

ALTER POLICY bm_cashflow_schedule_admin_write ON public.bm_cashflow_schedule
  USING ((SELECT public.nw_current_emp_is_admin()))
  WITH CHECK ((SELECT public.nw_current_emp_is_admin()));
ALTER POLICY bm_cashflow_schedule_staff_read ON public.bm_cashflow_schedule
  USING ((SELECT public.nw_current_employee_id()) IS NOT NULL);

ALTER POLICY bm_coupon_schedule_admin_write ON public.bm_coupon_schedule
  USING ((SELECT public.nw_current_emp_is_admin()))
  WITH CHECK ((SELECT public.nw_current_emp_is_admin()));
ALTER POLICY bm_coupon_schedule_staff_read ON public.bm_coupon_schedule
  USING ((SELECT public.nw_current_employee_id()) IS NOT NULL);

ALTER POLICY bm_corporate_actions_admin_write ON public.bm_corporate_actions
  USING ((SELECT public.nw_current_emp_is_admin()))
  WITH CHECK ((SELECT public.nw_current_emp_is_admin()));
ALTER POLICY bm_corporate_actions_staff_read ON public.bm_corporate_actions
  USING ((SELECT public.nw_current_employee_id()) IS NOT NULL);

ALTER POLICY bm_holiday_calendar_admin_write ON public.bm_holiday_calendar
  USING ((SELECT public.nw_current_emp_is_admin()))
  WITH CHECK ((SELECT public.nw_current_emp_is_admin()));
ALTER POLICY bm_holiday_calendar_staff_read ON public.bm_holiday_calendar
  USING ((SELECT public.nw_current_employee_id()) IS NOT NULL);

ALTER POLICY bm_price_history_admin_write ON public.bm_price_history
  USING ((SELECT public.nw_current_emp_is_admin()))
  WITH CHECK ((SELECT public.nw_current_emp_is_admin()));
ALTER POLICY bm_price_history_staff_read ON public.bm_price_history
  USING ((SELECT public.nw_current_employee_id()) IS NOT NULL);

ALTER POLICY bm_rating_history_admin_write ON public.bm_rating_history
  USING ((SELECT public.nw_current_emp_is_admin()))
  WITH CHECK ((SELECT public.nw_current_emp_is_admin()));
ALTER POLICY bm_rating_history_staff_read ON public.bm_rating_history
  USING ((SELECT public.nw_current_employee_id()) IS NOT NULL);
