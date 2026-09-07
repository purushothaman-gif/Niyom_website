-- nw2_generate_dsa_code used COUNT(*) + 1 to number a new DSA under an
-- employee. Once any DSA row was deleted the count fell behind the highest
-- code already issued, so the next call returned a code that still existed
-- and the insert died on nw_dsa_dsa_code_key.
-- Number from the highest sequence actually issued under the prefix instead,
-- and step past any code that is somehow still taken.
CREATE OR REPLACE FUNCTION nw2_generate_dsa_code(p_employee_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_code text;
  v_emp_seq  text;
  v_prefix   text;
  v_dsa_seq  int;
  v_dsa_code text;
BEGIN
  SELECT employee_code INTO v_emp_code
  FROM nw_employees WHERE id = p_employee_id;

  -- Extract numeric part from employee code (e.g. NIYOM-001 -> 001)
  v_emp_seq := regexp_replace(coalesce(v_emp_code, ''), '[^0-9]', '', 'g');
  IF v_emp_seq = '' THEN v_emp_seq := '001'; END IF;
  v_emp_seq := lpad(v_emp_seq, 3, '0');

  v_prefix := 'NWDSA-' || v_emp_seq || '-';

  -- Highest sequence already issued under this prefix, across every employee
  -- that maps to it. Gaps left by deleted DSAs are never reused.
  SELECT coalesce(max((regexp_replace(dsa_code, '^' || v_prefix, ''))::int), 0) + 1
    INTO v_dsa_seq
  FROM nw_dsa
  WHERE dsa_code ~ ('^' || v_prefix || '[0-9]+$');

  -- Belt and braces: skip anything still occupied (e.g. hand-seeded codes).
  LOOP
    v_dsa_code := v_prefix || lpad(v_dsa_seq::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM nw_dsa WHERE dsa_code = v_dsa_code);
    v_dsa_seq := v_dsa_seq + 1;
  END LOOP;

  RETURN v_dsa_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.nw2_generate_dsa_code(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.nw2_generate_dsa_code(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.nw2_generate_dsa_code(uuid) TO authenticated;
