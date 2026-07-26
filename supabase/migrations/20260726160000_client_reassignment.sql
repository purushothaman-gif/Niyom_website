-- ===========================================================================
-- Client reassignment (admin only)
-- ---------------------------------------------------------------------------
-- Leads already have an admin reassignment path (nw_assign_leads). Clients do
-- not: nw_clients.employee_id (the owning RM) is fixed at onboarding and there
-- is no RPC/UI to move a client to another employee. This adds that.
--
-- Direct (website "Open Your Free Account") clients are all created under
-- NIYOM-001 (Purushothaman) by default; this lets an admin distribute them to
-- the right RM later. Employee-onboarded clients keep their onboarding owner
-- unless an admin explicitly reassigns here.
--
-- Mirrors the proven nw_assign_leads pattern (20260719120000) + the
-- SECURITY DEFINER hardening lesson (20260719140000): REVOKE EXECUTE FROM PUBLIC
-- so anon / client-portal sessions cannot call it.
-- ===========================================================================

CREATE OR REPLACE FUNCTION nw_reassign_client(
  p_client_id uuid, p_to_employee uuid, p_reason text DEFAULT ''
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  admin_emp uuid := nw_current_employee_id();
  v_from    uuid;
  from_name text;
  to_name   text;
  cli       record;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only administrators can reassign clients.';
  END IF;

  -- Target must be an active employee.
  SELECT full_name INTO to_name FROM nw_employees
    WHERE id = p_to_employee AND status = 'active';
  IF to_name IS NULL THEN RAISE EXCEPTION 'Target employee not found or inactive.'; END IF;

  SELECT * INTO cli FROM nw_clients WHERE id = p_client_id;
  IF cli.id IS NULL THEN RAISE EXCEPTION 'Client not found.'; END IF;

  v_from := cli.employee_id;
  IF v_from IS NOT DISTINCT FROM p_to_employee THEN
    RETURN; -- no-op: already owned by the target
  END IF;
  SELECT full_name INTO from_name FROM nw_employees WHERE id = v_from;

  UPDATE nw_clients
    SET employee_id = p_to_employee, updated_at = now()
    WHERE id = p_client_id;

  -- Keep any linked lead in sync (e.g. website_signup leads that sit in the
  -- admin pool with owner_employee_id = NULL after conversion).
  UPDATE nw_leads
    SET owner_employee_id = p_to_employee,
        status = CASE WHEN status = 'New' THEN 'Assigned' ELSE status END
    WHERE converted_client_id = p_client_id
      AND owner_employee_id IS DISTINCT FROM p_to_employee;

  -- Audit trail (reuses the existing client activity log).
  INSERT INTO nw_activity_logs(employee_id, client_id, action, description)
    VALUES (admin_emp, p_client_id, 'client_reassigned',
            'Client reassigned: ' || COALESCE(from_name, 'Admin Pool') || ' → ' || to_name ||
            CASE WHEN COALESCE(p_reason, '') <> '' THEN ' — ' || p_reason ELSE '' END);

  -- Notify the new owner via the existing CRM bell.
  INSERT INTO nw_alerts(employee_id, title, message, category, action_url)
    VALUES (p_to_employee, 'Client Assigned',
            cli.full_name || ' (' || COALESCE(cli.client_code, '') || ') was assigned to you',
            'client_assigned', '/crm/clients');
END;
$$;

-- Postgres grants EXECUTE to PUBLIC by default — lock it down (see 20260719140000).
REVOKE EXECUTE ON FUNCTION nw_reassign_client(uuid, uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION nw_reassign_client(uuid, uuid, text) TO authenticated;
