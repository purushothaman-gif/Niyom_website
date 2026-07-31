/*
  # Add EUIN to nw_employees

  SEBI expects an EUIN declaration on distributor-executed mutual fund
  transactions. Nothing we send BSE has ever carried one — mem_details is
  optional in their API, so orders were accepted regardless.

  EUIN identifies the individual who executed or advised the transaction, so it
  belongs on the employee, not the client. The BSE proxy stamps the EUIN of
  whoever is signed in and placing the order; that keeps the MF Admin console
  standalone, since nw_employees is already the one CRM table it reads (for the
  login gate) and nw_clients stays untouched.

  ARN 362707 is member-level and constant, so it lives in the proxy's config
  rather than here.

  Nullable: RAMYA N holds no EUIN, and orders placed for her clients fall back
  to the default EUIN configured on the proxy. A client's own portal order has
  no employee behind it and takes the same fallback.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nw_employees' AND column_name = 'euin'
  ) THEN
    ALTER TABLE nw_employees ADD COLUMN euin text;
    COMMENT ON COLUMN nw_employees.euin IS
      'SEBI EUIN of this employee, stamped on BSE orders they place. Null = use the proxy''s default EUIN.';
  END IF;
END $$;

-- Format guard only. Deliberately permissive about which employees have one.
ALTER TABLE nw_employees DROP CONSTRAINT IF EXISTS nw_employees_euin_check;
ALTER TABLE nw_employees ADD CONSTRAINT nw_employees_euin_check
  CHECK (euin IS NULL OR euin ~ '^E[0-9]{6}$');

UPDATE nw_employees SET euin = v.euin
FROM (VALUES
  ('NIYOM-001', 'E124361'),  -- Purushothaman S
  ('NIYOM-003', 'E694550'),  -- VINITHA G
  ('NIYOM-004', 'E694614'),  -- NANTHINI C
  ('NIYOM-005', 'E694553'),  -- BHUVANESWARI R
  ('NIYOM-006', 'E694552'),  -- ANANDHAN K
  ('NIYOM-007', 'E694551')   -- PRABHU S
) AS v(employee_code, euin)
WHERE nw_employees.employee_code = v.employee_code
  AND nw_employees.euin IS DISTINCT FROM v.euin;
