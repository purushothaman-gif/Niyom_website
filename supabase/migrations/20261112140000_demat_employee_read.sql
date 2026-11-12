/*
  # Staff can read a client's imported demat statement

  demat_* shipped with a client-own-read policy only, so the CRM had no way to
  show an RM the stocks, bonds and ETFs a client imported from their eCAS. This
  adds the same employee-read rule cas_* already carries: an active admin sees
  every client, an active employee sees the clients mapped to them.

  SELECT only. A statement is the client's evidence, not a record staff
  maintain, so nothing here becomes writable from a browser session.
  (select auth.uid()) is evaluated once per query, not per row.
*/
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['demat_imports','demat_accounts','demat_holdings']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_employee_read', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1
        FROM nw_clients c
        JOIN nw_employees e ON e.auth_user_id = (select auth.uid())
        WHERE c.id = %I.client_id
          AND e.status = 'active'
          AND (e.role IN ('admin','super_admin') OR e.id = c.employee_id)
      ))
    $f$, t || '_employee_read', t, t);
  END LOOP;
END $$;
