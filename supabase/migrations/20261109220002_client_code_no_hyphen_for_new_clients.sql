-- New clients get BSE StAR / Wylth-compatible codes with no separators:
-- NW + 3-digit RM part + 4-digit serial, e.g. NW0010026.
-- Existing hyphenated codes (NW-001-0025) are deliberately left unchanged —
-- they are already accepted by Wylth through SSO. The serial continues from
-- the highest number used by that RM in EITHER format, so no reuse.
-- Applied to prod via MCP apply_migration on 2026-11-10.
CREATE OR REPLACE FUNCTION public.nw2_generate_client_code(p_employee_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  emp_code text;
  rm_part  text;
  next_num int;
BEGIN
  SELECT employee_code INTO emp_code FROM nw_employees WHERE id = p_employee_id;

  -- NIYOM-001 → 001; anything else → its alphanumerics (no separators either way).
  IF emp_code ~ '^NIYOM-[0-9]+$' THEN
    rm_part := SPLIT_PART(emp_code, '-', 2);
  ELSE
    rm_part := REGEXP_REPLACE(UPPER(COALESCE(emp_code, '')), '[^A-Z0-9]', '', 'g');
  END IF;

  SELECT COALESCE(MAX(RIGHT(client_code, 4)::int), 0) + 1
    INTO next_num
    FROM nw_clients
   WHERE client_code ~ ('^NW-?' || rm_part || '-?[0-9]{4}$');

  RETURN 'NW' || rm_part || LPAD(next_num::text, 4, '0');
END;
$function$;
