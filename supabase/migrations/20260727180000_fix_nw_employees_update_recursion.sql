/*
  # Fix infinite recursion in nw_employees UPDATE policy

  "Admins can update any employee record" used an inline
    EXISTS (SELECT 1 FROM nw_employees e2 WHERE e2.auth_user_id = auth.uid() ...)
  in both USING and WITH CHECK. Because nw_employees has FORCE row-level
  security, that self-reference recurses: evaluating the UPDATE policy requires
  querying nw_employees, which re-enters policy evaluation ->
  "infinite recursion detected in policy for relation nw_employees".

  This broke EVERY admin UPDATE of another employee's row (status toggle, edit,
  and the new avatar_url write). It was pre-existing but only surfaced from the
  browser once the avatar feature performed an admin update.

  Fix: use the SECURITY DEFINER helper nw_current_emp_is_admin() (identical
  check: active AND role in admin/super_admin), which reads nw_employees as its
  owner and bypasses RLS — the same safe pattern the SELECT policy already uses
  via nw_is_active_employee(). Verified: admin update of another employee now
  succeeds; non-admins remain blocked by this policy.
*/

DROP POLICY IF EXISTS "Admins can update any employee record" ON public.nw_employees;

CREATE POLICY "Admins can update any employee record"
  ON public.nw_employees FOR UPDATE
  TO authenticated
  USING (public.nw_current_emp_is_admin())
  WITH CHECK (public.nw_current_emp_is_admin());
