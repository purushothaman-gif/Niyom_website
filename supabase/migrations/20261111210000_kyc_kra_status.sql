/*
  # KRA KYC status on nw_clients

  A client's KYC registration status across the five SEBI KRAs (CVL, NDML,
  CAMS, Karvy, KFin), fetched on demand from CASParser's KYC PAN Status API and
  cached here so an RM sees it without a fresh lookup every time.

  ## Why separate from the existing kyc_status

  nw_clients already has `kyc_status` (pending | submitted | approved |
  rejected) — that is OUR onboarding workflow state, the steps a client has
  completed with us. These `kra_*` columns are the REGISTRAR'S verdict, an
  external fact about whether the investor is KYC-compliant in the KRA system at
  all. They answer different questions and must not be conflated: a client can
  be 'approved' in our flow and still have a KRA record that is on_hold.

  All nullable and additive — nothing is computed until the first check runs.
*/

ALTER TABLE nw_clients
  ADD COLUMN IF NOT EXISTS kra_status text,          -- normalised enum from the API, e.g. validated | registered | on_hold | rejected | not_available
  ADD COLUMN IF NOT EXISTS kra_compliant boolean,    -- the single gate the API returns
  ADD COLUMN IF NOT EXISTS kra_active text,          -- which KRA holds the active record, e.g. 'cvl'
  ADD COLUMN IF NOT EXISTS kra_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS kra_detail jsonb;         -- the full per-KRA breakdown, verbatim

COMMENT ON COLUMN nw_clients.kra_status IS
  'KRA KYC status from the KYC PAN Status API (external registrar fact), distinct from kyc_status which is our own onboarding workflow state.';
COMMENT ON COLUMN nw_clients.kra_compliant IS
  'True when the KRA system reports this PAN as KYC-compliant. Null until checked.';
