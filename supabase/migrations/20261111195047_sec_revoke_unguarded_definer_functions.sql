-- Close SECURITY DEFINER functions that were executable without signing in.
--
-- Supabase grants EXECUTE on every new public function to anon and
-- authenticated directly, so "REVOKE ... FROM PUBLIC" alone leaves them open.
-- Each role is named explicitly here.

-- 1. Internal helpers. Reached only from SECURITY DEFINER triggers/functions
--    (which run as the owner) or from pg_cron; no client ever calls them.
--    nw_apply_txn_holding had no caller check and wrote nw_holdings for any
--    client_id, so it was the dangerous one.
REVOKE ALL ON FUNCTION public.nw_apply_txn_holding(public.nw_transactions) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nw_deal_recompute_from_items(uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nw_emit_outstanding_updated(uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_mf_returns_backfill()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trigger_bond_yield_refresh()                  FROM PUBLIC, anon, authenticated;

-- 2. Trigger functions. Firing a trigger never checks EXECUTE, so these lose
--    nothing; the grant only made them reachable as RPCs.
REVOKE ALL ON FUNCTION public.nw_deal_item_recompute_trigger()   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nw_notify_rm_on_bond_order()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nw_notify_rm_on_share_order()      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nw_txn_apply_holding_on_transfer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.us_sync_latest_price()             FROM PUBLIC, anon, authenticated;

-- 3. RPCs the apps do call. They check the caller themselves, but none has a
--    reason to be reachable without a session.
REVOKE ALL ON FUNCTION public.nw_amend_payment(uuid, jsonb, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nw_cancel_payment(uuid, text)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nw_client_bonds()                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nw_partner_bonds()                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nw_ensure_partner_ref_links()                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.nw_lead_dashboard(text)                      FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nw_amend_payment(uuid, jsonb, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nw_cancel_payment(uuid, text)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.nw_client_bonds()                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.nw_partner_bonds()                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.nw_ensure_partner_ref_links()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.nw_lead_dashboard(text)                      TO authenticated;
