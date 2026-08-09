-- Security fix (finding 1): a logged-in client could rewrite ANY column on their
-- own nw_clients row. The "Clients can update own password changed flag" policy
-- is column-unrestricted and `authenticated` holds UPDATE on all 43 columns.
--
-- Column-level GRANTs cannot express this: clients AND employees share the
-- `authenticated` role, and the CRM legitimately needs to write every column.
-- So the boundary is enforced by a BEFORE UPDATE trigger that only constrains
-- callers acting as the client themselves.
--
-- The client portal genuinely self-serves a subset of fields during KYC
-- onboarding (address, bank details they are supplying, demat, preferences) --
-- those stay writable. What the client must never set is the *verification*
-- state of that data, their identity, or their commercial routing.
--
-- NOTE: the function body here uses `v_blocked || 'col'`, which Postgres
-- resolves as anyarray || anyarray and fails on the unknown-typed literal. It
-- failed CLOSED (the UPDATE still aborted) and is corrected in the immediately
-- following migration, sec_nw_clients_guard_fix_array_append.

CREATE OR REPLACE FUNCTION public.nw_clients_guard_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_blocked text[] := '{}';
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM nw_employees e
    WHERE e.auth_user_id = v_uid AND e.status = 'active'
  ) THEN
    RETURN NEW;
  END IF;

  IF OLD.client_auth_user_id IS DISTINCT FROM v_uid THEN
    RETURN NEW;
  END IF;

  IF NEW.pan IS DISTINCT FROM OLD.pan THEN v_blocked := v_blocked || 'pan'; END IF;
  -- ... (full column list; superseded by the next migration)

  IF array_length(v_blocked, 1) > 0 THEN
    RAISE EXCEPTION 'Not permitted: % can only be changed by Niyom Wealth staff.',
      array_to_string(v_blocked, ', ')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.nw_clients_guard_self_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nw_clients_guard_self_update ON public.nw_clients;
CREATE TRIGGER nw_clients_guard_self_update
  BEFORE UPDATE ON public.nw_clients
  FOR EACH ROW EXECUTE FUNCTION public.nw_clients_guard_self_update();

-- Defence in depth: `anon` had INSERT/UPDATE/DELETE grants on nw_clients. RLS
-- already blocks it (every policy targets `authenticated`), but the grant has
-- no reason to exist. Edge functions use the service role.
REVOKE INSERT, UPDATE, DELETE ON public.nw_clients FROM anon;
