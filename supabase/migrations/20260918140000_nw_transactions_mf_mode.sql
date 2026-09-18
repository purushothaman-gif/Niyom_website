-- =============================================================================
-- Mutual fund investment mode on a transaction: SIP or lumpsum.
--
-- Chosen in CRM → Transactions → Add New Business. For a SIP the amount is the
-- instalment. NULL means "not recorded" (every MF row booked before this
-- column existed, and anything that is not a mutual fund); readers treat a
-- NULL mutual fund row as lumpsum.
--
-- The Incentive tool reads it: SIP rows count towards the SIP product, the
-- rest towards Mutual Fund. Additive only.
-- =============================================================================

ALTER TABLE public.nw_transactions
  ADD COLUMN IF NOT EXISTS mf_mode text
    CHECK (mf_mode IN ('lumpsum', 'sip'));

COMMENT ON COLUMN public.nw_transactions.mf_mode IS
  'Mutual funds only: lumpsum or sip (amount = the SIP instalment). NULL = not recorded, treated as lumpsum.';
