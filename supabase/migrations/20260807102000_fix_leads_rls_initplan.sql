-- Perf fix 2026-08-07 (part 1 of 2): nw_leads RLS helpers evaluated per row.
--
-- nw_leads_select called nw_current_emp_is_admin() and nw_current_employee_id()
-- BARE in the policy. Postgres cannot fold a bare STABLE function into an
-- InitPlan there, so both were re-executed for every one of the 29,704 rows —
-- each doing an index lookup on nw_employees. One lead-list page load read
-- ~90,000 buffers (703 MB) to return 346 rows.
--
-- Wrapping each call in a scalar subquery forces a one-time InitPlan.
-- Measured on this database:
--   count page          2,211 ms -> 12 ms     buffers 90,060 -> 1,545
--   list w/ owner joins ~3,000 ms -> 3.4 ms   (planner switches to
--                                              idx_nw_leads_created_at and
--                                              stops at LIMIT 25)
--   nw_lead_dashboard() ~3,018 ms -> 27 ms
--
-- The predicates are logically IDENTICAL — this changes performance only, not
-- who can see which row. Verified post-apply by impersonating real users:
-- employee 141a9df2 sees 346/29,704 leads, super_admin sees 29,704 — both
-- match ground truth computed without RLS.
--
-- Supabase's auth_rls_initplan advisor does NOT catch this: it only pattern-
-- matches auth.*() and current_setting(), not project-local helper functions.
-- Several policies were already fixed this way in the 2026-07 audit
-- (nw_dsa, mkt_referral_links, the debit-note tables); Leads was missed.

ALTER POLICY nw_leads_select ON public.nw_leads
  USING (
    (SELECT public.nw_current_emp_is_admin())
    OR owner_employee_id      = (SELECT public.nw_current_employee_id())
    OR created_by_employee_id = (SELECT public.nw_current_employee_id())
  );

ALTER POLICY nw_leads_update ON public.nw_leads
  USING (
    (SELECT public.nw_current_emp_is_admin())
    OR owner_employee_id = (SELECT public.nw_current_employee_id())
  )
  WITH CHECK (
    (SELECT public.nw_current_emp_is_admin())
    OR owner_employee_id = (SELECT public.nw_current_employee_id())
  );

ALTER POLICY nw_leads_delete ON public.nw_leads
  USING ((SELECT public.nw_current_emp_is_admin()));

ALTER POLICY nw_leads_insert ON public.nw_leads
  WITH CHECK (
    (SELECT public.nw_current_emp_is_admin())
    OR (
      lead_origin           = 'employee_manual'
      AND created_by_employee_id = (SELECT public.nw_current_employee_id())
      AND owner_employee_id      = (SELECT public.nw_current_employee_id())
    )
  );

-- nw_can_see_lead is rewritten the same way for consistency. NOTE: unlike the
-- policies above this buys essentially nothing, because the function is
-- SECURITY DEFINER and therefore cannot be inlined by the planner — it stays an
-- opaque per-row call and the InitPlan scope is a single invocation. The child
-- tables are fixed properly in part 2 (20260807102217) by inlining the
-- predicate into their policies instead.
CREATE OR REPLACE FUNCTION public.nw_can_see_lead(p_lead_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM nw_leads l
     WHERE l.id = p_lead_id
       AND ((SELECT nw_current_emp_is_admin())
            OR l.owner_employee_id      = (SELECT nw_current_employee_id())
            OR l.created_by_employee_id = (SELECT nw_current_employee_id()))
  );
$function$;
