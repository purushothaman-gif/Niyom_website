-- =============================================================================
-- Everything the CRM shell needs to decide which HR menu entries to draw, in
-- one call.
--
-- The sidebar was asking three separate questions on every mount -- what is my
-- HR role, does that role grant any module, and (now) am I on payroll -- which
-- is three round trips before the navigation can settle. Worse, each answer
-- came from a different place, so a fourth question would have meant a fourth
-- trip and a fourth chance for the menu to disagree with the database.
--
-- The menu is a CONVENIENCE, never a control. Everything here is enforced
-- independently by RLS and by the RPCs; hiding an entry only stops someone
-- being offered a screen that would refuse them anyway.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hr_my_nav_context()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    -- HR capability, independent of the CRM role.
    'hr_role', COALESCE(hr_current_profile_role(), 'none'),
    -- Does this person have ANY HR administration surface? A CRM admin always
    -- does; anyone else only through a granted module.
    'hr_admin_access', nw_current_emp_is_admin() OR EXISTS (
      SELECT 1 FROM hr_role_permissions rp
      WHERE rp.hr_role = hr_current_profile_role() AND rp.can_view),
    -- Is this person salaried? A partner has no attendance, no leave balance
    -- and no payslip, so the self-service entry is noise for them.
    -- Defaults TRUE when no profile exists: a new employee is salaried until
    -- someone says otherwise, and defaulting the other way would hide their own
    -- attendance from them on their first day.
    'on_payroll', COALESCE(
      (SELECT p.on_payroll
         FROM hr_employee_profiles p
         JOIN nw_employees e ON e.id = p.employee_id
        WHERE e.auth_user_id = auth.uid()
        LIMIT 1), true)
  );
$$;

REVOKE ALL ON FUNCTION public.hr_my_nav_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hr_my_nav_context() TO authenticated;

COMMENT ON FUNCTION public.hr_my_nav_context() IS
  'What the CRM shell needs to draw the HR menu, in one call. A convenience for the UI only -- every screen behind it is enforced by RLS regardless.';