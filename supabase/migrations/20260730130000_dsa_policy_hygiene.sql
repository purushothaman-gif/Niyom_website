/*
  # DSA policy hygiene — prerequisite for the Partner Portal

  ## Purpose
  Three pre-existing conditions make it unsafe to introduce a partner (DSA) JWT.
  A partner authenticates as `authenticated`, exactly like an employee and a
  client, so every policy whose predicate is "any authenticated user" or "the
  parent row is visible to me" silently widens the moment partners exist. This
  migration closes all three BEFORE any partner login is provisioned.

    1. nw_dsa carries THREE stacked SELECT policies (plus three INSERT and three
       UPDATE) accumulated over three successive migrations. RLS policies are
       OR'd, so the assignment scoping that 20260701120000 introduced is defeated
       by the older blanket "Active employees can view all DSAs". The net live
       behaviour is that every active employee sees every DSA — the opposite of
       what 20260701120000 documented. Collapsed here to one policy per command,
       owner-scoped, which is the approved behaviour.

    2. dsa_debit_note_lines INSERT/DELETE are gated only by "the parent note is
       visible to me". That predicate is today equivalent to employee ownership
       (policy subqueries are themselves RLS-filtered). The moment a partner can
       SELECT their own note, the SAME policies would let them DELETE the ledger
       lines that stop a transaction being paid twice (see 20260718100300) and
       INSERT arbitrary ones. Made explicit and employee-only here.

    3. storage.objects "Authenticated users can upload to crm-documents" is
       WITH CHECK (bucket_id = 'crm-documents') with no identity check at all —
       a partner JWT would inherit write access to the entire document bucket.
       Narrowed to employees, plus clients writing only under their own
       clients/<client_code>/ prefix (the in-portal KYC upload path in
       src/portal/features/onboarding/onboardingService.ts depends on this —
       it must keep working).

  ## Tables
    nw_dsa (policies only)
    dsa_debit_note_lines (policies only)
    storage.objects (one INSERT policy)
    New helper: nw_current_client_code()

  ## Security
    Net effect for employees: INSERT/UPDATE/DELETE unchanged. SELECT on nw_dsa
    NARROWS from "every active employee sees every DSA" to "assigned employee or
    admin" — a deliberate, approved product decision, and the behaviour that
    20260701120000 intended. src/crm/DSAManagement.tsx relies purely on RLS for
    its list, so it narrows with no code change; src/crm/DSAPayout.tsx already
    filters client-side by employee_id and is unaffected.

    Net effect for clients: unchanged. The crm-documents upload path is narrowed
    from "any authenticated user, anywhere in the bucket" to "own client prefix",
    which the only client upload path already satisfies.

    Deliberately NOT touched: the employee-avatars policies. That bucket is
    public and read via getPublicUrl() (src/crm/Settings.tsx, Employees.tsx), so
    its storage RLS SELECT policy is not the access gate and narrowing it would
    change nothing.

  ## Safety
    Idempotent (DROP ... IF EXISTS + CREATE, CREATE OR REPLACE). No DDL on
    tables, no data change, no DROP TABLE / DELETE / TRUNCATE / UPDATE.
    Every helper call is wrapped as (SELECT fn()) so it is evaluated once per
    query (InitPlan) rather than once per row — see 20260727130000.
*/

-- ---------------------------------------------------------------------------
-- 1. nw_dsa — collapse to one policy per command, owner-scoped.
--    The three historical names for each command are dropped so no stale
--    permissive branch survives to OR itself back in.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Active employees can view all DSAs"                ON nw_dsa;
DROP POLICY IF EXISTS "Employees can view own and admin can view all DSAs" ON nw_dsa;
DROP POLICY IF EXISTS "Employees can view their own DSA records"          ON nw_dsa;
CREATE POLICY "Employees can view their own DSA records"
  ON nw_dsa FOR SELECT TO authenticated
  USING (
    employee_id = (SELECT nw_current_employee_id())
    OR (SELECT nw_current_emp_is_admin())
  );

DROP POLICY IF EXISTS "Employees can insert DSAs for themselves"   ON nw_dsa;
DROP POLICY IF EXISTS "Employees can insert own DSAs"              ON nw_dsa;
DROP POLICY IF EXISTS "Employees can insert their own DSA records" ON nw_dsa;
CREATE POLICY "Employees can insert their own DSA records"
  ON nw_dsa FOR INSERT TO authenticated
  WITH CHECK (
    employee_id = (SELECT nw_current_employee_id())
    OR (SELECT nw_current_emp_is_admin())
  );

DROP POLICY IF EXISTS "Admins can update any DSA, employees own DSAs" ON nw_dsa;
DROP POLICY IF EXISTS "Employees can update own DSAs"                 ON nw_dsa;
DROP POLICY IF EXISTS "Employees can update their own DSA records"    ON nw_dsa;
CREATE POLICY "Employees can update their own DSA records"
  ON nw_dsa FOR UPDATE TO authenticated
  USING (
    employee_id = (SELECT nw_current_employee_id())
    OR (SELECT nw_current_emp_is_admin())
  )
  WITH CHECK (
    employee_id = (SELECT nw_current_employee_id())
    OR (SELECT nw_current_emp_is_admin())
  );

-- "Admins can delete DSAs" is intentionally left exactly as it is.

-- ---------------------------------------------------------------------------
-- 2. dsa_debit_note_lines — writes become explicitly employee-only.
--    Previously the predicate was merely "the parent note row exists and is
--    visible to me", which inherits whatever the parent table allows. Stating
--    ownership explicitly means a future partner SELECT branch on the parent
--    can never silently grant partners write access to the payout ledger.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Access lines via parent note (insert)"           ON dsa_debit_note_lines;
DROP POLICY IF EXISTS "Employees write debit note lines for owned notes" ON dsa_debit_note_lines;
CREATE POLICY "Employees write debit note lines for owned notes"
  ON dsa_debit_note_lines FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM dsa_debit_notes n
      WHERE n.id = dsa_debit_note_lines.debit_note_id
        AND (nw_emp_owns_dsa(n.dsa_id) OR (SELECT nw_current_emp_is_admin()))
    )
  );

DROP POLICY IF EXISTS "Access lines via parent note (delete)"            ON dsa_debit_note_lines;
DROP POLICY IF EXISTS "Employees delete debit note lines for owned notes" ON dsa_debit_note_lines;
CREATE POLICY "Employees delete debit note lines for owned notes"
  ON dsa_debit_note_lines FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dsa_debit_notes n
      WHERE n.id = dsa_debit_note_lines.debit_note_id
        AND (nw_emp_owns_dsa(n.dsa_id) OR (SELECT nw_current_emp_is_admin()))
    )
  );

-- SELECT on lines keeps its existing parent-derived predicate for now; the
-- partner branch is added explicitly in the partner-portal RLS migration.

-- ---------------------------------------------------------------------------
-- 3. storage.objects — crm-documents uploads get an identity check.
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so the storage policy can resolve the caller's client_code
-- without depending on nw_clients' own RLS (policy subqueries are RLS-filtered,
-- which would make the storage policy's behaviour depend on unrelated policies).
CREATE OR REPLACE FUNCTION nw_current_client_code()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT client_code FROM nw_clients
  WHERE client_auth_user_id = (SELECT auth.uid())
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION nw_current_client_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nw_current_client_code() TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can upload to crm-documents"   ON storage.objects;
DROP POLICY IF EXISTS "Employees and clients can upload to crm-documents" ON storage.objects;
CREATE POLICY "Employees and clients can upload to crm-documents"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'crm-documents'
    AND (
      -- Any active employee, anywhere in the bucket (unchanged for staff).
      (SELECT public.nw_current_employee_id()) IS NOT NULL
      -- A client, only under their own clients/<client_code>/ prefix. This is
      -- the in-portal KYC upload (clients/<code>/ONBOARD_KYC/<type>_<ts>.<ext>).
      OR (
        (SELECT public.nw_current_client_code()) IS NOT NULL
        AND name LIKE 'clients/' || (SELECT public.nw_current_client_code()) || '/%'
      )
    )
  );
