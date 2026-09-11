/*
  # Close anon EXECUTE on nw_transfer_deal

  20260903120000 revoked PUBLIC and authenticated but not anon (the same
  REVOKE gotcha that leaked client emails), so the transfer RPC was callable
  with the public anon key from 2026-09-03 to 2026-09-11. Audit at close: all
  10 transfers in that window carry application_version
  'niyom-crm/transfer-v1 (phase-3)' from the transfer-deal edge function.

  Only transfer-deal (service role) may call it.
*/

REVOKE ALL ON FUNCTION public.nw_transfer_deal(uuid, uuid, text, text, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nw_transfer_deal(uuid, uuid, text, text, boolean, timestamptz) TO service_role;
