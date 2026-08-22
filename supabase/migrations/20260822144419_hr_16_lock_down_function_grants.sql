-- =============================================================================
-- NIYOM HR & PAYROLL -- 16: close the function-grant findings from get_advisors
--
-- Postgres grants EXECUTE on a new function to PUBLIC by default, and PostgREST
-- publishes anything the anon/authenticated roles can execute at
-- /rest/v1/rpc/<name>. Three groups needed narrowing:
--
--   1. Trigger functions. Calling one as an RPC fails at runtime ("can only be
--      called as a trigger"), but a SECURITY DEFINER function that the public
--      internet can reach is not something to leave lying around.
--   2. hr_last_working_day / hr_count_leave_days -- wanted by the UI, not by an
--      anonymous caller.
--   3. hr_audit -- the audit writer. Left callable by `authenticated`, any
--      employee could forge entries in the log that is supposed to hold them to
--      account. Every real caller is a SECURITY DEFINER function, which does
--      not need the grant.
-- =============================================================================

REVOKE ALL ON FUNCTION public.hr_touch_updated_at()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_guard_punch_immutable()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_guard_punch_no_delete()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_guard_profile_self_update()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_guard_leave_request_update()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_guard_adjustment_update()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_guard_run_locked()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_guard_line_locked()            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_guard_run_transition()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_guard_structure_dates()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_guard_structure_frozen()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nw_employees_guard_self_update()  FROM PUBLIC, anon, authenticated;

-- Read-only calendar helpers: staff yes, anonymous no.
REVOKE ALL ON FUNCTION public.hr_last_working_day(smallint, smallint, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_last_working_day(smallint, smallint, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.hr_ist_date(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_ist_now()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_today()               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_match_network(inet)   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hr_is_weekly_off(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_is_holiday(text, date)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_structure_on(uuid, date)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_payslip_number(text, smallint, smallint, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_ist_date(timestamptz)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_today()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_is_weekly_off(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_is_holiday(text, date)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_structure_on(uuid, date)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_payslip_number(text, smallint, smallint, text, integer) TO authenticated;

-- The audit log must not be writable by the people it audits.
REVOKE ALL ON FUNCTION public.hr_audit(text, uuid, text, jsonb, jsonb, text, inet, text)
  FROM PUBLIC, anon, authenticated;

-- Capability checks stay callable: RLS evaluates them as the querying role, so
-- revoking EXECUTE here would break every policy that uses them.
GRANT EXECUTE ON FUNCTION public.hr_can_view(text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_can_edit(text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_is_staff()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_is_manager_of(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_current_profile_role()    TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_employee_salary_visible() TO authenticated;