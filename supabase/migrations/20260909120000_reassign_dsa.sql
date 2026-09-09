/*
  # nw_reassign_dsa — move a DSA (partner) to another employee / admin

  ## Why
  Ownership of a DSA is decided by exactly one column — `nw_dsa.employee_id`
  (see 20260701120000_dsa_ownership_forward_align). Until now that column was
  written once, at creation, and never changed: when an RM left or a partner was
  handed to someone else there was no way to remap them.

  This mirrors `nw_reassign_client` for partners, with one addition the client
  version doesn't need: **every client sourced through the DSA moves with it**,
  so the partner and their book never end up owned by two different people.

  ## What moves
    - `nw_dsa.employee_id`                    — the partner itself
    - `nw_clients.employee_id`                — every client with this dsa_id
    - `nw_deal_confirmations.employee_id`     — those clients' deals
    - `nw_transactions.employee_id`           — those clients' transactions
    - `nw_leads.owner_employee_id`            — leads from this DSA, and leads
                                                that converted into its clients

  Deals and transactions follow the same full-handover rule `nw_reassign_client`
  already applies: the new owner sees the complete history and MIS credits them.
  Nothing about the business itself changes — no deal terms, no amounts, no
  DSA payout math (that keys on dsa_id, which is untouched).

  Clients whose `employee_id` had drifted away from their DSA's owner are pulled
  back in line by this call, which is the intended repair path for such rows.

  ## Safety
    - Admin-only, enforced inside the function (`nw_current_emp_is_admin`).
    - SECURITY DEFINER so the cascade isn't blocked by RLS, exactly as
      `nw_reassign_client` does; the accepted-deal / post-transfer immutability
      guards still evaluate the real caller and pass only because they are admin.
    - Idempotent: re-running with the same target updates nothing and reports
      zero counts.
    - Additive: no schema change, no deletes.
*/

CREATE OR REPLACE FUNCTION nw_reassign_dsa(
  p_dsa_id      uuid,
  p_to_employee uuid,
  p_reason      text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  admin_emp    uuid := nw_current_employee_id();
  v_dsa        nw_dsa%ROWTYPE;
  v_from       uuid;
  from_name    text;
  to_name      text;
  v_client_ids uuid[];
  v_moved_ids  uuid[];
  n_clients    int := 0;
  n_deals      int := 0;
  n_txns       int := 0;
  n_leads      int := 0;
  v_suffix     text;
BEGIN
  IF NOT nw_current_emp_is_admin() THEN
    RAISE EXCEPTION 'Only administrators can reassign a DSA.';
  END IF;

  SELECT full_name INTO to_name FROM nw_employees
    WHERE id = p_to_employee AND status = 'active';
  IF to_name IS NULL THEN RAISE EXCEPTION 'Target employee not found or inactive.'; END IF;

  SELECT * INTO v_dsa FROM nw_dsa WHERE id = p_dsa_id;
  IF v_dsa.id IS NULL THEN RAISE EXCEPTION 'DSA not found.'; END IF;

  v_from := v_dsa.employee_id;
  SELECT full_name INTO from_name FROM nw_employees WHERE id = v_from;

  -- Every client sourced through this DSA, whatever their current owner: a
  -- client that had drifted onto another RM is realigned by this handover.
  SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_client_ids
    FROM nw_clients WHERE dsa_id = p_dsa_id;

  -- Already fully on the target (partner AND book) — nothing to do.
  IF v_from IS NOT DISTINCT FROM p_to_employee
     AND NOT EXISTS (
       SELECT 1 FROM nw_clients
        WHERE dsa_id = p_dsa_id AND employee_id IS DISTINCT FROM p_to_employee
     ) THEN
    RETURN jsonb_build_object(
      'unchanged', true, 'clients', 0, 'deals', 0, 'transactions', 0, 'leads', 0);
  END IF;

  UPDATE nw_dsa
     SET employee_id = p_to_employee, updated_at = now()
   WHERE id = p_dsa_id AND employee_id IS DISTINCT FROM p_to_employee;

  IF array_length(v_client_ids, 1) > 0 THEN
    WITH upd AS (
      UPDATE nw_clients
         SET employee_id = p_to_employee, updated_at = now()
       WHERE id = ANY(v_client_ids) AND employee_id IS DISTINCT FROM p_to_employee
      RETURNING id
    ) SELECT COALESCE(array_agg(id), '{}'::uuid[]) INTO v_moved_ids FROM upd;
    n_clients := COALESCE(array_length(v_moved_ids, 1), 0);

    WITH upd AS (
      UPDATE nw_deal_confirmations
         SET employee_id = p_to_employee
       WHERE client_id = ANY(v_client_ids) AND employee_id IS DISTINCT FROM p_to_employee
      RETURNING 1
    ) SELECT count(*) INTO n_deals FROM upd;

    WITH upd AS (
      UPDATE nw_transactions
         SET employee_id = p_to_employee
       WHERE client_id = ANY(v_client_ids) AND employee_id IS DISTINCT FROM p_to_employee
      RETURNING 1
    ) SELECT count(*) INTO n_txns FROM upd;
  END IF;

  WITH upd AS (
    UPDATE nw_leads
       SET owner_employee_id = p_to_employee,
           status = CASE WHEN status = 'New' THEN 'Assigned' ELSE status END
     WHERE (dsa_id = p_dsa_id OR converted_client_id = ANY(v_client_ids))
       AND owner_employee_id IS DISTINCT FROM p_to_employee
    RETURNING 1
  ) SELECT count(*) INTO n_leads FROM upd;

  v_suffix := CASE WHEN COALESCE(p_reason, '') <> '' THEN ' - ' || p_reason ELSE '' END;

  -- DSA-level audit row (no client_id: this is the partner's own event).
  INSERT INTO nw_activity_logs(employee_id, client_id, action, description)
    VALUES (admin_emp, NULL, 'dsa_reassigned',
            'DSA reassigned: ' || v_dsa.full_name || ' (' || v_dsa.dsa_code || ') ' ||
            COALESCE(from_name, 'Unassigned') || ' -> ' || to_name ||
            ' with ' || n_clients || ' client(s)' || v_suffix);

  -- One row per client that actually moved, so it shows on the client timeline
  -- next to a manual reassignment.
  IF COALESCE(array_length(v_moved_ids, 1), 0) > 0 THEN
    INSERT INTO nw_activity_logs(employee_id, client_id, action, description)
      SELECT admin_emp, t.cid, 'client_reassigned',
             'Client reassigned with DSA ' || v_dsa.dsa_code || ': ' ||
             COALESCE(from_name, 'Admin Pool') || ' -> ' || to_name || v_suffix
        FROM unnest(v_moved_ids) AS t(cid);
  END IF;

  INSERT INTO nw_alerts(employee_id, title, message, category, action_url)
    VALUES (p_to_employee, 'DSA Assigned',
            v_dsa.full_name || ' (' || v_dsa.dsa_code || ') was assigned to you' ||
            CASE WHEN n_clients > 0 THEN ' along with ' || n_clients || ' client(s)' ELSE '' END,
            'dsa_assigned', '/crm/dsa_management');

  RETURN jsonb_build_object(
    'unchanged', false,
    'clients', n_clients, 'deals', n_deals,
    'transactions', n_txns, 'leads', n_leads);
END;
$$;

REVOKE EXECUTE ON FUNCTION nw_reassign_dsa(uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION nw_reassign_dsa(uuid, uuid, text) TO authenticated;
