/*
  # Transfer Admin — a CRM login that can only work the Transfer Queue

  A super admin creates one (or more) `transfer_admin` logins from Employees →
  Add Employee and hands the email + password to whichever employee is doing
  transfers that day. That login sees the Transfer Queue and nothing else.

  Why a new role and not `admin`:
    `admin` passes every admin RLS policy in the schema (every client, PAN,
    bank account, MIS, payouts). The Transfer Queue needs a sliver of that:
    the deals that are currently waiting for transfer, plus their line items,
    payment ledger and the transactions already booked against them.

  What `transfer_admin` can read (additive SELECT policies, nothing else):
    - nw_deal_confirmations       rows that are in the transfer queue
    - nw_deal_confirmation_items  lines of those deals
    - nw_deal_payments            ledger of those deals
    - nw_transactions             transactions booked against those deals
  "In the queue" is decided by nw_deal_transfer_eligible itself, through the
  SECURITY DEFINER helper nw_deal_in_transfer_queue(), so eligibility has one
  definition. A deal leaves the transfer admin's view the moment it is fully
  transferred. It writes nothing directly; the transfer goes through the
  transfer-deal edge function → nw_transfer_deal, which now accepts the role.

  Everything else sees `transfer_admin` as neither admin nor RM-owner, so it
  gets exactly the surface of an employee with an empty book (the employee
  directory and the unlisted-share master), and no admin surface anywhere.

  No 2FA: evaluateMfaGate only challenges admin/super_admin, and a shared login
  cannot carry one person's authenticator. The login is guarded by password
  alone — that is the accepted trade-off of a shared account.
*/

-- =====================================================================
-- 1. Allow the role
-- =====================================================================
ALTER TABLE nw_employees DROP CONSTRAINT IF EXISTS nw_employees_role_check;
ALTER TABLE nw_employees ADD CONSTRAINT nw_employees_role_check
  CHECK (role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'employee'::text, 'transfer_admin'::text]));

-- =====================================================================
-- 2. Helpers
-- =====================================================================
CREATE OR REPLACE FUNCTION public.nw_current_emp_is_transfer_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM nw_employees
    WHERE auth_user_id = auth.uid()
      AND status = 'active'
      AND role = 'transfer_admin'
  );
$$;

-- Runs as the owner, so the security_invoker view is evaluated without the
-- caller's RLS — the answer is the queue's real membership, not a filtered one.
CREATE OR REPLACE FUNCTION public.nw_deal_in_transfer_queue(p_deal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM nw_deal_transfer_eligible WHERE deal_id = p_deal_id);
$$;

-- RLS evaluates these as the calling user, so `authenticated` needs EXECUTE.
-- REVOKE FROM PUBLIC, anon alone would leave authenticated's grant in place
-- (see the Supabase REVOKE gotcha) — that grant is intended here; anon's is not.
REVOKE ALL ON FUNCTION public.nw_current_emp_is_transfer_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nw_deal_in_transfer_queue(uuid)   FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nw_current_emp_is_transfer_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nw_deal_in_transfer_queue(uuid)   TO authenticated, service_role;

-- =====================================================================
-- 3. Read access, scoped to deals in the queue
--    `(SELECT fn())` is an initplan: evaluated once per query, so for every
--    non-transfer-admin the policy is a constant false and costs nothing.
-- =====================================================================
DROP POLICY IF EXISTS "Transfer admin reads queued deals" ON nw_deal_confirmations;
CREATE POLICY "Transfer admin reads queued deals"
  ON nw_deal_confirmations FOR SELECT TO authenticated
  USING (
    (SELECT nw_current_emp_is_transfer_admin())
    AND status = 'confirmed'
    AND acceptance_status NOT IN ('rejected', 'expired')
    AND nw_deal_in_transfer_queue(id)
  );

DROP POLICY IF EXISTS "Transfer admin reads queued deal items" ON nw_deal_confirmation_items;
CREATE POLICY "Transfer admin reads queued deal items"
  ON nw_deal_confirmation_items FOR SELECT TO authenticated
  USING ((SELECT nw_current_emp_is_transfer_admin()) AND nw_deal_in_transfer_queue(deal_id));

DROP POLICY IF EXISTS "Transfer admin reads queued deal payments" ON nw_deal_payments;
CREATE POLICY "Transfer admin reads queued deal payments"
  ON nw_deal_payments FOR SELECT TO authenticated
  USING ((SELECT nw_current_emp_is_transfer_admin()) AND nw_deal_in_transfer_queue(deal_confirmation_id));

DROP POLICY IF EXISTS "Transfer admin reads queued deal transactions" ON nw_transactions;
CREATE POLICY "Transfer admin reads queued deal transactions"
  ON nw_transactions FOR SELECT TO authenticated
  USING (
    (SELECT nw_current_emp_is_transfer_admin())
    AND deal_confirmation_id IS NOT NULL
    AND nw_deal_in_transfer_queue(deal_confirmation_id)
  );

-- =====================================================================
-- 4. nw_transfer_deal accepts the role
--    Patched in place from the live definition (last full rewrite:
--    20260903120000_transfer_deal_transfer_date.sql) so nothing else in the
--    11 KB body can drift. The assertion fails the migration loudly if the
--    guard line ever changes shape.
-- =====================================================================
DO $$
DECLARE
  v_def text := pg_get_functiondef(
    'public.nw_transfer_deal(uuid,uuid,text,text,boolean,timestamptz)'::regprocedure);
  v_old text := $q$IF v_employee.role NOT IN ('admin', 'super_admin') THEN$q$;
  v_new text := $q$IF v_employee.role NOT IN ('admin', 'super_admin', 'transfer_admin') THEN$q$;
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RETURN; -- already applied
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'nw_transfer_deal role guard not found — update this migration';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;

-- =====================================================================
-- 5. Sign every device out of a transfer login (password rotation)
--    Called only by the transfer-login-password edge function after it sets
--    a new password. Refresh tokens cascade from auth.sessions, so deleting
--    the sessions ends them; open tabs lapse at their access token's expiry.
--    Refuses any user that is not a transfer_admin, so even a misused service
--    call cannot sign a real employee out.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.nw_revoke_auth_sessions(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM nw_employees WHERE auth_user_id = p_user_id AND role = 'transfer_admin'
  ) THEN
    RAISE EXCEPTION 'Not a transfer login' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.nw_revoke_auth_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nw_revoke_auth_sessions(uuid) TO service_role;

-- =====================================================================
-- 6. No referral links for the transfer login
--    Every active employee otherwise gets an employee referral link (insert
--    trigger) and a partner-onboarding link (backfilled whenever an admin opens
--    Partner Onboard Links). A lead or partner signing up through the transfer
--    login's link would be mapped to a desk nobody works as an RM.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.mkt_provision_referral_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role = 'transfer_admin' THEN
    RETURN NEW;
  END IF;
  INSERT INTO mkt_referral_links (employee_id, kind)
  VALUES (NEW.id, 'employee')
  ON CONFLICT (employee_id) WHERE kind = 'employee' AND employee_id IS NOT NULL
  DO NOTHING;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.nw_ensure_partner_ref_links()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if nw_current_employee_id() is null then return; end if;
  insert into mkt_referral_links (employee_id, ref_code, kind, label, active)
  select null, 'p' || substr(replace(gen_random_uuid()::text,'-',''),1,15),
         'partner', 'Company Direct — Partner Onboarding', true
  where not exists (select 1 from mkt_referral_links where kind='partner' and employee_id is null);
  insert into mkt_referral_links (employee_id, ref_code, kind, label, active)
  select e.id, 'p' || substr(replace(gen_random_uuid()::text,'-',''),1,15),
         'partner', 'Partner Onboarding — ' || e.full_name, true
  from nw_employees e
  where e.status='active'
    and e.role <> 'transfer_admin'
    and not exists (select 1 from mkt_referral_links r where r.kind='partner' and r.employee_id=e.id);
end; $function$;
