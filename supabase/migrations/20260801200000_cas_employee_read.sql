/*
  # Let an RM see their client's imported statement

  The cas_* tables were built client-first: a client reads their own rows and
  nobody else reads anything. That was right for the portal and wrong for the
  console — the RM who gets the "held-away assets detected" alert had no way to
  look at what triggered it.

  These policies add employee reads on exactly the terms the rest of the CRM
  already uses (nw_holdings): an RM sees the clients assigned to them, an admin
  or super_admin sees everyone. Nothing else changes — still SELECT only, still
  no writes from any browser session, so a statement stays something the client
  supplied and staff can read rather than something staff can edit.

  ## Why the CAS data is NOT copied into nw_holdings

  It would be the obvious way to make it appear in the console, and it would
  quietly wreck two things.

  nw_holdings is the book of record for what we sold: it carries DSA pricing,
  landing cost and trail fields, and MIS/AUM reporting reads it. A CAS knows
  none of that, so imported rows would land with those fields empty and be
  indistinguishable from a badly-entered manual row.

  Worse, a client's CAS includes funds bought through other distributors.
  Copying those into nw_holdings would count someone else's business as ours in
  every AUM figure the console produces.

  So the console reads the statement alongside the book rather than merged into
  it, and the two stay answerable to different questions: nw_holdings for "what
  did we sell and what are we paid on", cas_* for "what does this client
  actually hold".
*/

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cas_imports','cas_folios','cas_schemes','cas_transactions','cas_requests','cas_consents']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_employee_read', t);
    /*
      Mirrors "Employees can view holdings for accessible clients" on
      nw_holdings, including the admin override — an RM should not gain wider
      reach over a statement than they already have over the client record it
      belongs to.

      (select auth.uid()) rather than auth.uid() so the planner evaluates it
      once per query instead of once per row.
    */
    EXECUTE format($f$
      CREATE POLICY %I ON %I FOR SELECT TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM nw_clients c
          JOIN nw_employees e ON e.auth_user_id = (select auth.uid())
          WHERE c.id = %I.client_id
            AND e.status = 'active'
            AND (e.role IN ('admin', 'super_admin') OR e.id = c.employee_id)
        )
      )
    $f$, t || '_employee_read', t, t);
  END LOOP;
END $$;
