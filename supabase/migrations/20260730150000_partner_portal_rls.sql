/*
  # Partner Portal — data access (RLS policies + projection RPCs)

  ## Purpose
  Gives a signed-in partner read access to their own business: their profile,
  the clients they sourced (and those clients' portfolios), and their payout
  statements.

  ## Governing principle
  Table policies ONLY where the partner needs raw rows of a table that contains
  nothing beyond their own. Everything touching nw_clients / nw_holdings /
  nw_transactions goes through SECURITY DEFINER RPCs with an explicit column
  projection. The reasons:

    1. RLS grants ROWS, not COLUMNS. PostgREST lets the caller choose columns, so
       `?select=pan,dob,bank_account` works the moment a row is visible. The only
       column mechanism, GRANT SELECT (cols), is role-wide on `authenticated` and
       would break the CRM and the client portal simultaneously.
    2. Policy subqueries are themselves RLS-filtered, so adding a partner branch
       to nw_clients would change the row set that OTHER tables' policies
       evaluate over (e.g. "Clients can read own holdings" is an EXISTS over
       nw_clients). Reasoning about that across 65+ policies is not safe.
    3. nw_transactions.snapshot (NOT NULL jsonb) embeds the client's PAN, and
       both nw_holdings and nw_transactions carry landing_cost / trail_rate /
       trail_percent / insurance_revenue — the firm's own margin fields.

  So: 2 new table policies, 1 storage policy, 6 RPCs.

  ## What partners can see (agreed with the business)
    - Their own profile, with PAN and bank account MASKED, and their RM's card.
    - Clients they sourced: name, code, city, masked mobile, onboarding status,
      and the client's COMPLETE PORTFOLIO (holdings + transactions), view-only.
      NOT: PAN, DOB, email, address, bank details, or any firm-margin field.
    - Their debit notes (payout statements) and the PDFs attached to them.

  ## Payout figures
  Every monetary figure in nw_partner_payout_summary() is read from a debit note
  that has already been raised and frozen. The payout formula lives solely in
  src/crm/DSAPayout.tsx and is deliberately NOT reimplemented here: two
  implementations diverge, and the divergent number is the one shown to a
  counterparty. dsa_debit_notes is already the legal artefact (signed, immutable
  per 20260625120300, with a pdf_snapshot).

  ## Security
    - Every RPC resolves nw_current_dsa_id() and RAISEs 'Partner access required'
      when it is NULL, so an employee or client token cannot call them.
    - The per-client RPCs re-check `c.dsa_id = v_dsa AND c.sourced_via = 'dsa'`,
      so a partner cannot enumerate clients by passing an arbitrary id.
    - Partners get NO INSERT/UPDATE/DELETE anywhere in the debit-note subsystem.
      dsa_debit_note_lines writes were made explicitly employee-only in
      20260730130000 and are untouched here.
    - Helper calls are written (SELECT fn()) for once-per-query InitPlan
      evaluation, per the 2026-07 RLS perf audit.

  ## Safety
    Idempotent (DROP ... IF EXISTS + CREATE, CREATE OR REPLACE). No DDL on
    tables, no data change. Purely additive for employees and clients: no
    existing policy is modified.
*/

-- ---------------------------------------------------------------------------
-- 1. Debit notes — the row IS the partner's own statement.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Partners can read own debit notes" ON dsa_debit_notes;
CREATE POLICY "Partners can read own debit notes"
  ON dsa_debit_notes FOR SELECT TO authenticated
  USING (dsa_id = (SELECT nw_current_dsa_id()));

-- Lines: the predicate names all three readers explicitly rather than
-- inheriting parent visibility, so a future change to the parent can never
-- silently widen this.
DROP POLICY IF EXISTS "Access lines via parent note (select)"    ON dsa_debit_note_lines;
DROP POLICY IF EXISTS "Read debit note lines for accessible notes" ON dsa_debit_note_lines;
CREATE POLICY "Read debit note lines for accessible notes"
  ON dsa_debit_note_lines FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM dsa_debit_notes n
      WHERE n.id = dsa_debit_note_lines.debit_note_id
        AND (
          nw_emp_owns_dsa(n.dsa_id)
          OR (SELECT nw_current_emp_is_admin())
          OR n.dsa_id = (SELECT nw_current_dsa_id())
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Storage — the private dsa-debit-notes bucket.
--    Read-only, and only objects referenced by one of the partner's own notes.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Partners can read own dsa debit note objects" ON storage.objects;
CREATE POLICY "Partners can read own dsa debit note objects"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'dsa-debit-notes'
    AND EXISTS (
      SELECT 1 FROM dsa_debit_notes n
      WHERE (
              n.pdf_url             = storage.objects.name
           OR n.signed_pdf_url      = storage.objects.name
           OR n.signature_image_path = storage.objects.name
            )
        AND n.dsa_id = (SELECT public.nw_current_dsa_id())
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Projection RPCs.
-- ---------------------------------------------------------------------------

-- 3a. Profile + RM card. No table policy on nw_dsa is needed or wanted:
--     `select *` there would expose `notes` (internal RM commentary) and the raw
--     bank_account. The RM join is also something an RLS'd query could not do,
--     since partners have no nw_employees access.
CREATE OR REPLACE FUNCTION nw_partner_profile()
RETURNS TABLE (
  dsa_id uuid, dsa_code text, full_name text, email text, mobile text,
  pan_masked text, address text, bank_name text, bank_account_masked text,
  bank_ifsc text, status text, photo_url text,
  login_enabled boolean, password_changed boolean, partner_since date,
  rm_name text, rm_email text, rm_mobile text, rm_avatar_url text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_dsa uuid;
BEGIN
  v_dsa := nw_current_dsa_id();
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;

  -- NOTE: the RM's contact column on nw_employees is `phone` (nw_dsa uses
  -- `mobile`). The avatar comes from the PUBLIC employee-avatars bucket, so
  -- exposing the URL grants nothing that a public URL did not already.
  RETURN QUERY
  SELECT d.id, d.dsa_code, d.full_name, d.email, d.mobile,
         'XXXXX' || right(d.pan, 5),
         d.address, d.bank_name,
         CASE WHEN length(d.bank_account) >= 4
              THEN 'XXXXXX' || right(d.bank_account, 4) ELSE 'XXXXXX' END,
         d.bank_ifsc, d.status, d.photo_url,
         d.dsa_login_enabled, d.dsa_password_changed, d.created_at::date,
         e.full_name, e.email, e.phone, e.avatar_url
  FROM nw_dsa d
  LEFT JOIN nw_employees e ON e.id = d.employee_id
  WHERE d.id = v_dsa;
END $fn$;

-- 3b. Clients sourced by this partner. No PAN, DOB, email, address or bank.
CREATE OR REPLACE FUNCTION nw_partner_clients()
RETURNS TABLE (
  client_id uuid, client_code text, full_name text, city text,
  mobile_masked text, onboarding_status text, verification_status text,
  sourced_on date, invested_amount numeric, current_value numeric,
  holdings_count int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_dsa uuid;
BEGIN
  v_dsa := nw_current_dsa_id();
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;

  RETURN QUERY
  SELECT c.id, c.client_code, c.full_name, COALESCE(c.city, ''),
         CASE WHEN length(c.phone) >= 4 THEN 'XXXXXX' || right(c.phone, 4) ELSE '' END,
         COALESCE(c.onboarding_status, ''), COALESCE(c.verification_status, ''),
         c.created_at::date,
         COALESCE(SUM(h.invested_amount), 0)::numeric,
         COALESCE(SUM(h.current_value), 0)::numeric,
         COUNT(h.id)::int
  FROM nw_clients c
  LEFT JOIN nw_holdings h ON h.client_id = c.id
  WHERE c.dsa_id = v_dsa AND c.sourced_via = 'dsa'
  GROUP BY c.id, c.client_code, c.full_name, c.city, c.phone,
           c.onboarding_status, c.verification_status, c.created_at
  ORDER BY c.full_name;
END $fn$;

-- 3c. One sourced client's complete portfolio (view-only).
--     Excludes landing_cost / trail_rate / trail_percent / insurance_revenue.
CREATE OR REPLACE FUNCTION nw_partner_client_portfolio(p_client_id uuid)
RETURNS TABLE (
  holding_id uuid, product_type text, product_name text,
  quantity numeric, avg_price numeric, invested_amount numeric,
  current_value numeric, gain_loss numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_dsa uuid;
BEGIN
  v_dsa := nw_current_dsa_id();
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;

  -- Ownership re-check: without this a partner could enumerate every client
  -- in the firm by guessing ids.
  IF NOT EXISTS (
    SELECT 1 FROM nw_clients c
    WHERE c.id = p_client_id AND c.dsa_id = v_dsa AND c.sourced_via = 'dsa'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT h.id, h.product_type, COALESCE(h.product_name, ''),
         COALESCE(h.quantity, 0), COALESCE(h.avg_cost, 0),
         COALESCE(h.invested_amount, 0), COALESCE(h.current_value, 0),
         COALESCE(h.current_value, 0) - COALESCE(h.invested_amount, 0)
  FROM nw_holdings h
  WHERE h.client_id = p_client_id
  ORDER BY h.product_type, h.product_name;
END $fn$;

-- 3d. One sourced client's transaction history. dsa_price / client_price ARE
--     included: that is the partner's own deal economics and the basis of the
--     payout they already see on their signed debit notes. snapshot (which
--     embeds the client's PAN) and every firm-margin column are excluded.
CREATE OR REPLACE FUNCTION nw_partner_client_transactions(p_client_id uuid)
RETURNS TABLE (
  txn_id uuid, txn_date date, txn_type text, product_type text,
  product_name text, quantity numeric, amount numeric,
  dsa_price numeric, client_price numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_dsa uuid;
BEGIN
  v_dsa := nw_current_dsa_id();
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM nw_clients c
    WHERE c.id = p_client_id AND c.dsa_id = v_dsa AND c.sourced_via = 'dsa'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT t.id, t.txn_date, t.txn_type, t.product_type,
         COALESCE(t.product_name, ''), COALESCE(t.quantity, 0),
         COALESCE(t.consolidated_amount, 0), t.dsa_price, t.client_price
  FROM nw_transactions t
  WHERE t.client_id = p_client_id
  ORDER BY t.txn_date DESC, t.created_at DESC;
END $fn$;

-- 3e. Payout summary — aggregates over FROZEN debit notes only.
--     Labels in the UI say "statements raised", never "payout MTD/YTD": notes
--     are keyed (dsa_id, month, year), so an accrual figure does not exist until
--     the month's note is actually raised.
CREATE OR REPLACE FUNCTION nw_partner_payout_summary()
RETURNS TABLE (
  fy_label text, fy_gross numeric, fy_tds numeric, fy_net numeric,
  lifetime_gross numeric, lifetime_tds numeric, lifetime_net numeric,
  paid_net numeric, awaiting_signature_count int, awaiting_payment_net numeric,
  latest_note_number text, latest_note_period text, latest_note_net numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_dsa      uuid;
  v_fy_start int;   -- Indian FY starts 1 April
BEGIN
  v_dsa := nw_current_dsa_id();
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;

  v_fy_start := CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
                     THEN EXTRACT(YEAR FROM CURRENT_DATE)::int
                     ELSE EXTRACT(YEAR FROM CURRENT_DATE)::int - 1 END;

  RETURN QUERY
  WITH live AS (
    SELECT * FROM dsa_debit_notes
    WHERE dsa_id = v_dsa AND status <> 'cancelled'
  ),
  fy AS (
    SELECT * FROM live
    WHERE (year = v_fy_start AND month >= 4)
       OR (year = v_fy_start + 1 AND month <= 3)
  ),
  latest AS (
    SELECT debit_note_number, month, year, net_payable_amount
    FROM live ORDER BY year DESC, month DESC, created_at DESC LIMIT 1
  )
  SELECT
    v_fy_start::text || '-' || right((v_fy_start + 1)::text, 2),
    COALESCE((SELECT SUM(payout_amount)      FROM fy), 0)::numeric,
    COALESCE((SELECT SUM(tds_amount)         FROM fy), 0)::numeric,
    COALESCE((SELECT SUM(net_payable_amount) FROM fy), 0)::numeric,
    COALESCE((SELECT SUM(payout_amount)      FROM live), 0)::numeric,
    COALESCE((SELECT SUM(tds_amount)         FROM live), 0)::numeric,
    COALESCE((SELECT SUM(net_payable_amount) FROM live), 0)::numeric,
    COALESCE((SELECT SUM(net_payable_amount) FROM live WHERE status = 'paid'), 0)::numeric,
    COALESCE((SELECT COUNT(*) FROM live WHERE signature_status <> 'signed'), 0)::int,
    COALESCE((SELECT SUM(net_payable_amount) FROM live WHERE status <> 'paid'), 0)::numeric,
    (SELECT debit_note_number FROM latest),
    (SELECT to_char(make_date(year, month, 1), 'Mon YYYY') FROM latest),
    (SELECT net_payable_amount FROM latest);
END $fn$;

-- 3f. Statement list. Excludes secure_token and pdf_snapshot, which `select *`
--     on the table would otherwise expose.
CREATE OR REPLACE FUNCTION nw_partner_debit_notes()
RETURNS TABLE (
  id uuid, debit_note_number text, month int, year int,
  payout_amount numeric, tds_amount numeric, net_payable_amount numeric,
  status text, signature_status text,
  pdf_url text, signed_pdf_url text,
  signed_at timestamptz, paid_at timestamptz, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_dsa uuid;
BEGIN
  v_dsa := nw_current_dsa_id();
  IF v_dsa IS NULL THEN RAISE EXCEPTION 'Partner access required'; END IF;

  RETURN QUERY
  SELECT n.id, n.debit_note_number, n.month, n.year,
         n.payout_amount, n.tds_amount, n.net_payable_amount,
         n.status, n.signature_status,
         n.pdf_url, n.signed_pdf_url,
         n.signed_at, n.paid_at, n.created_at
  FROM dsa_debit_notes n
  WHERE n.dsa_id = v_dsa AND n.status <> 'cancelled'
  ORDER BY n.year DESC, n.month DESC, n.created_at DESC;
END $fn$;

-- ---------------------------------------------------------------------------
-- 4. Grants. anon must never reach these.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION nw_partner_profile()                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_partner_clients()                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_partner_client_portfolio(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_partner_client_transactions(uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_partner_payout_summary()                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION nw_partner_debit_notes()                   FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION nw_partner_profile()                    TO authenticated;
GRANT EXECUTE ON FUNCTION nw_partner_clients()                    TO authenticated;
GRANT EXECUTE ON FUNCTION nw_partner_client_portfolio(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION nw_partner_client_transactions(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION nw_partner_payout_summary()             TO authenticated;
GRANT EXECUTE ON FUNCTION nw_partner_debit_notes()                TO authenticated;
