-- URGENT: nw_orphaned_holdings was readable by `anon` over /rest/v1/*, and it
-- is a SECURITY DEFINER view (no security_invoker option => runs as postgres),
-- so RLS on nw_holdings/nw_clients was bypassed and the view's own definition
-- carries no caller check. Net effect: full_name + pan for real clients were
-- retrievable unauthenticated with only the public anon key. Verified live
-- before this migration.
--
-- This is an internal reconciliation/audit view. `anon` has no business
-- reading it under any circumstance, so the grant goes immediately; the
-- security_invoker conversion follows separately.

REVOKE ALL ON public.nw_orphaned_holdings FROM anon;
