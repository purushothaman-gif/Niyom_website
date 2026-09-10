/*
  # Multiple DSA (partner) bank accounts — 1 Primary + up to 4 Secondary

  Mirrors nw_client_bank_accounts (20260713130000) for partners.

  New model:
    nw_dsa_bank_accounts — one row per partner bank account, with a single
    is_primary row per DSA (DB-enforced by a partial unique index).

  Backward compatibility:
    nw_dsa.bank_account / bank_ifsc / bank_name are RETAINED and remain the
    "primary mirror" — the application updates them explicitly whenever the
    primary account is created / changed / edited / deleted. Every existing
    downstream reader (dsa_debit_note payout PDFs, nw_partner_profile's masked
    bank block, the DSA list column) therefore keeps working unchanged. NO
    trigger is used — the mirror is maintained in application code so the write
    path stays explicit and debuggable, exactly as on the client side.

  dsa_debit_notes.pdf_snapshot is NOT touched — signed payout statements remain
  immutable.

  Only additive schema changes; safe idempotent backfill.
*/

-- =====================================================================
-- 1. Partner bank accounts
-- =====================================================================
CREATE TABLE IF NOT EXISTS nw_dsa_bank_accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dsa_id         uuid NOT NULL REFERENCES nw_dsa(id) ON DELETE CASCADE,
  account_number text NOT NULL,
  ifsc           text NOT NULL DEFAULT '',
  bank_name      text NOT NULL DEFAULT '',
  holder_name    text NOT NULL DEFAULT '',
  label          text NOT NULL DEFAULT '',
  is_primary     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nw_dsa_bank_accounts_dsa
  ON nw_dsa_bank_accounts(dsa_id);

-- Invariant: at most one PRIMARY account per DSA (application guarantees at
-- least one primary whenever any account exists).
CREATE UNIQUE INDEX IF NOT EXISTS uq_nw_dsa_bank_accounts_primary
  ON nw_dsa_bank_accounts(dsa_id)
  WHERE is_primary;

ALTER TABLE nw_dsa_bank_accounts ENABLE ROW LEVEL SECURITY;

-- Assigned-employee-or-admin access, matching the nw_dsa policies collapsed in
-- 20260730130000. The argument-free helper is wrapped as (SELECT fn()) so it
-- evaluates once per query (InitPlan) rather than once per row — see the
-- 2026-07 audit; nw_emp_owns_dsa() takes the row's own column, so it cannot be
-- hoisted and is called plainly, exactly as in the debit-note-line policies.
--
-- Partners deliberately get NO table policy here: RLS grants rows, not columns,
-- and PostgREST would then serve the raw account_number. The partner-facing
-- read is the masked nw_partner_bank_accounts() RPC below.
DROP POLICY IF EXISTS "nw_dba_select" ON nw_dsa_bank_accounts;
CREATE POLICY "nw_dba_select" ON nw_dsa_bank_accounts
  FOR SELECT TO authenticated
  USING (
    nw_emp_owns_dsa(nw_dsa_bank_accounts.dsa_id) OR (SELECT nw_current_emp_is_admin())
  );

DROP POLICY IF EXISTS "nw_dba_insert" ON nw_dsa_bank_accounts;
CREATE POLICY "nw_dba_insert" ON nw_dsa_bank_accounts
  FOR INSERT TO authenticated
  WITH CHECK (
    nw_emp_owns_dsa(nw_dsa_bank_accounts.dsa_id) OR (SELECT nw_current_emp_is_admin())
  );

DROP POLICY IF EXISTS "nw_dba_update" ON nw_dsa_bank_accounts;
CREATE POLICY "nw_dba_update" ON nw_dsa_bank_accounts
  FOR UPDATE TO authenticated
  USING (
    nw_emp_owns_dsa(nw_dsa_bank_accounts.dsa_id) OR (SELECT nw_current_emp_is_admin())
  )
  WITH CHECK (
    nw_emp_owns_dsa(nw_dsa_bank_accounts.dsa_id) OR (SELECT nw_current_emp_is_admin())
  );

DROP POLICY IF EXISTS "nw_dba_delete" ON nw_dsa_bank_accounts;
CREATE POLICY "nw_dba_delete" ON nw_dsa_bank_accounts
  FOR DELETE TO authenticated
  USING (
    nw_emp_owns_dsa(nw_dsa_bank_accounts.dsa_id) OR (SELECT nw_current_emp_is_admin())
  );

-- =====================================================================
-- 2. Partner-facing read — masked, own accounts only
-- =====================================================================
-- Same masking rule as nw_partner_profile() (20260730150000): the partner sees
-- which accounts are on file and which one is Primary, never the full number.
CREATE OR REPLACE FUNCTION nw_partner_bank_accounts()
RETURNS TABLE (
  id uuid, bank_name text, account_number_masked text, ifsc text,
  holder_name text, label text, is_primary boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_dsa uuid;
BEGIN
  v_dsa := nw_current_dsa_id();
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;

  RETURN QUERY
  SELECT b.id, b.bank_name,
         CASE WHEN length(b.account_number) >= 4
              THEN 'XXXXXX' || right(b.account_number, 4) ELSE 'XXXXXX' END,
         b.ifsc, b.holder_name, b.label, b.is_primary
  FROM nw_dsa_bank_accounts b
  WHERE b.dsa_id = v_dsa
  ORDER BY b.is_primary DESC, b.created_at;
END $fn$;

-- REVOKE FROM PUBLIC, anon does NOT remove EXECUTE from `authenticated`
-- (see 20260901123000) — the in-function nw_current_dsa_id() check is the gate.
REVOKE ALL ON FUNCTION nw_partner_bank_accounts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION nw_partner_bank_accounts() TO authenticated;

-- =====================================================================
-- 3. Safe idempotent backfill — seed one PRIMARY row per existing DSA that
--    already has bank data and has no bank-account row yet.
-- =====================================================================
INSERT INTO nw_dsa_bank_accounts (dsa_id, account_number, ifsc, bank_name, holder_name, is_primary)
SELECT d.id,
       COALESCE(d.bank_account, ''),
       COALESCE(d.bank_ifsc, ''),
       COALESCE(d.bank_name, ''),
       COALESCE(d.full_name, ''),
       true
FROM nw_dsa d
WHERE (COALESCE(d.bank_account, '') <> ''
       OR COALESCE(d.bank_ifsc, '') <> ''
       OR COALESCE(d.bank_name, '') <> '')
  AND NOT EXISTS (
    SELECT 1 FROM nw_dsa_bank_accounts b WHERE b.dsa_id = d.id
  );
