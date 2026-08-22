-- Closes a privilege escalation that predates the HR module but blocks it.
--
-- RLS policy "Employees can update own record" on nw_employees is
--   USING/WITH CHECK (auth_user_id = auth.uid())
-- with no column guard, and `authenticated` holds UPDATE on every column of the
-- table -- including `role`. A signed-in employee could therefore run
--
--   update nw_employees set role = 'super_admin' where auth_user_id = auth.uid();
--
-- and RLS would allow it, because the row still belongs to them afterwards.
--
-- nw_clients already has exactly this guard (nw_clients_guard_self_update);
-- nw_employees never got one. The HR & Payroll module keys every one of its RLS
-- policies off `role`, so salary and payslip confidentiality is unenforceable
-- until this is closed.
--
-- Allowlist rather than blocklist on purpose: a column added to nw_employees in
-- future is server-owned by default, instead of silently becoming
-- self-writable. The five permitted columns are exactly what the app writes
-- from an employee's own session today:
--   Settings.tsx        -> full_name, phone, avatar_url, updated_at
--   ChangePassword.tsx  -> password_changed
CREATE OR REPLACE FUNCTION public.nw_employees_guard_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_blocked text[] := ARRAY[]::text[];
BEGIN
  -- Not an end-user request (service role, or an internal trigger context such
  -- as create-crm-user / delete-crm-user): allow.
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Admins and super admins manage the whole directory; the admin RLS policy
  -- already scopes that. Column freedom is intentional for them.
  IF EXISTS (
    SELECT 1 FROM nw_employees e
    WHERE e.auth_user_id = v_uid
      AND e.status = 'active'
      AND e.role IN ('admin', 'super_admin')
  ) THEN
    RETURN NEW;
  END IF;

  -- Not the owning employee -- RLS should already have rejected this, and the
  -- admin policy is the only other way in. Leave the decision to RLS.
  IF OLD.auth_user_id IS DISTINCT FROM v_uid THEN
    RETURN NEW;
  END IF;

  -- Caller is a non-admin employee acting on their own row. Everything that is
  -- not self-service is server-owned.
  IF NEW.id            IS DISTINCT FROM OLD.id            THEN v_blocked := array_append(v_blocked, 'id'); END IF;
  IF NEW.auth_user_id  IS DISTINCT FROM OLD.auth_user_id  THEN v_blocked := array_append(v_blocked, 'auth_user_id'); END IF;
  IF NEW.employee_code IS DISTINCT FROM OLD.employee_code THEN v_blocked := array_append(v_blocked, 'employee_code'); END IF;
  IF NEW.email         IS DISTINCT FROM OLD.email         THEN v_blocked := array_append(v_blocked, 'email'); END IF;
  IF NEW.role          IS DISTINCT FROM OLD.role          THEN v_blocked := array_append(v_blocked, 'role'); END IF;
  IF NEW.status        IS DISTINCT FROM OLD.status        THEN v_blocked := array_append(v_blocked, 'status'); END IF;
  IF NEW.designation   IS DISTINCT FROM OLD.designation   THEN v_blocked := array_append(v_blocked, 'designation'); END IF;
  IF NEW.joining_date  IS DISTINCT FROM OLD.joining_date  THEN v_blocked := array_append(v_blocked, 'joining_date'); END IF;
  IF NEW.euin          IS DISTINCT FROM OLD.euin          THEN v_blocked := array_append(v_blocked, 'euin'); END IF;
  IF NEW.created_at    IS DISTINCT FROM OLD.created_at    THEN v_blocked := array_append(v_blocked, 'created_at'); END IF;

  IF array_length(v_blocked, 1) > 0 THEN
    RAISE EXCEPTION 'Not permitted: % can only be changed by an administrator.',
      array_to_string(v_blocked, ', ')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.nw_employees_guard_self_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nw_employees_guard_self_update ON public.nw_employees;
CREATE TRIGGER nw_employees_guard_self_update
  BEFORE UPDATE ON public.nw_employees
  FOR EACH ROW EXECUTE FUNCTION public.nw_employees_guard_self_update();
