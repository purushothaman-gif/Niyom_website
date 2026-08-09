-- Perf fix 2026-08-07 (part 2 of 2): lead child tables.
--
-- nw_can_see_lead() is SECURITY DEFINER, which BLOCKS SQL function inlining.
-- The planner therefore treats it as an opaque per-row call: one invocation per
-- candidate row (17,871 on nw_lead_audit, 9,001 on nw_lead_activities, 8,932 on
-- status_history, 8,929 on assignments), each doing a pk lookup on nw_leads
-- plus employee lookups. Wrapping the helpers inside the function body does NOT
-- help — the InitPlan scope is a single invocation. Part 1 left these tables at
-- ~3,370 ms / 54,530 buffers.
--
-- Inlining the same predicate directly into the policy lets the planner hoist
-- the helper calls to whole-query InitPlans and collapse the check into a hash
-- semi-join against nw_leads.
--   nw_lead_activities  3,369 ms -> 15.6 ms   buffers 54,530 -> 1,672
--   nw_lead_audit       ~3,300 ms -> 16.1 ms
--
-- SEMANTICS UNCHANGED. nw_can_see_lead bypassed nw_leads RLS (definer), but the
-- inline subquery is now subject to nw_leads_select, whose predicate is the
-- same condition — so the visible row set is identical. Verified post-apply
-- against ground truth computed without RLS:
--   employee 141a9df2 — leads 346, activities 346, audit 690, history 345,
--                       assignments 344
--   super_admin       — leads 29,704, activities 9,001, audit 17,871
--
-- The INSERT/UPDATE policies still call nw_can_see_lead(): those are
-- single-row checks, so the per-row cost is irrelevant there.
-- nw_lead_notes / _communications / _followups / _documents are left alone too
-- (39 rows or fewer combined).

ALTER POLICY nw_lead_activities_select ON public.nw_lead_activities
  USING (EXISTS (
    SELECT 1 FROM public.nw_leads l
     WHERE l.id = nw_lead_activities.lead_id
       AND ((SELECT public.nw_current_emp_is_admin())
            OR l.owner_employee_id      = (SELECT public.nw_current_employee_id())
            OR l.created_by_employee_id = (SELECT public.nw_current_employee_id()))
  ));

ALTER POLICY nw_lead_audit_select ON public.nw_lead_audit
  USING (EXISTS (
    SELECT 1 FROM public.nw_leads l
     WHERE l.id = nw_lead_audit.lead_id
       AND ((SELECT public.nw_current_emp_is_admin())
            OR l.owner_employee_id      = (SELECT public.nw_current_employee_id())
            OR l.created_by_employee_id = (SELECT public.nw_current_employee_id()))
  ));

ALTER POLICY nw_lead_status_history_select ON public.nw_lead_status_history
  USING (EXISTS (
    SELECT 1 FROM public.nw_leads l
     WHERE l.id = nw_lead_status_history.lead_id
       AND ((SELECT public.nw_current_emp_is_admin())
            OR l.owner_employee_id      = (SELECT public.nw_current_employee_id())
            OR l.created_by_employee_id = (SELECT public.nw_current_employee_id()))
  ));

ALTER POLICY nw_lead_assignments_select ON public.nw_lead_assignments
  USING (EXISTS (
    SELECT 1 FROM public.nw_leads l
     WHERE l.id = nw_lead_assignments.lead_id
       AND ((SELECT public.nw_current_emp_is_admin())
            OR l.owner_employee_id      = (SELECT public.nw_current_employee_id())
            OR l.created_by_employee_id = (SELECT public.nw_current_employee_id()))
  ));
