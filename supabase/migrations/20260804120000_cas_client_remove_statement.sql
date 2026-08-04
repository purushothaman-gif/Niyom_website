/*
  # Let a client remove a statement they imported

  Statements now COMBINE rather than replace, so a wrong upload is no longer
  corrected by uploading the right one — it sits alongside it, contributing
  folios that do not belong. Until now the only fix was a hand-written DELETE
  against the database.

  Deleting the import row is enough: cas_folios, cas_schemes and cas_transactions
  all cascade on import_id, and PostgreSQL performs referential actions as a
  system operation, so the cascade is not blocked by those tables having no
  delete policy of their own.

  ## Who may

  The client whose statement it is, and the staff who can already read it (their
  RM, or an admin) — the same predicate as the existing read policies, so this
  grants no visibility that did not exist.

  Writing stays with the proxy's service role. This is a delete-only grant: a
  client can remove their own statement, never add or alter one, so nothing
  about the imported figures can be edited from a browser.
*/

DROP POLICY IF EXISTS cas_imports_own_delete ON cas_imports;
CREATE POLICY cas_imports_own_delete ON cas_imports
  FOR DELETE TO authenticated
  USING (
    client_id IN (
      SELECT id FROM nw_clients WHERE client_auth_user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS cas_imports_employee_delete ON cas_imports;
CREATE POLICY cas_imports_employee_delete ON cas_imports
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM nw_clients c
      JOIN nw_employees e ON e.auth_user_id = (SELECT auth.uid())
      WHERE c.id = cas_imports.client_id
        AND e.status = 'active'
        AND (e.role IN ('admin', 'super_admin') OR e.id = c.employee_id)
    )
  );
