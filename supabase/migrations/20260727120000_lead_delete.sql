-- Admin-only hard delete of a lead.
--
-- All lead child rows (activities, notes, follow-ups, communications, documents,
-- tasks, reminders, and nw_alerts.lead_id) reference nw_leads ON DELETE CASCADE,
-- so removing the lead cleans them up automatically. nw_lead_duplicate_requests
-- keeps its row with existing_lead_id set NULL (ON DELETE SET NULL).
--
-- Follows the module's SECURITY DEFINER + REVOKE-from-PUBLIC + GRANT-to-
-- authenticated pattern, and reuses the nw_current_emp_is_admin() helper. A row
-- is written to the general CRM audit (nw_activity_logs) BEFORE the delete, since
-- the lead's own nw_lead_activities rows cascade away with it.

CREATE OR REPLACE FUNCTION nw_delete_lead(p_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  emp    uuid := nw_current_employee_id();
  v_code text;
  v_name text;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only an admin can delete a lead.';
  END IF;

  SELECT lead_code, lead_name INTO v_code, v_name FROM nw_leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found.';
  END IF;

  INSERT INTO nw_activity_logs(employee_id, action, description)
    VALUES (emp, 'Lead Deleted',
            'Deleted lead ' || v_code || ' (' || v_name || ')');

  DELETE FROM nw_leads WHERE id = p_lead_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION nw_delete_lead(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION nw_delete_lead(uuid) TO authenticated;
