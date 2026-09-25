/*
  # Sell deals are never transferred

  A Sell deal is stock Niyom BUYS from the client: nothing leaves our demat, so
  there is no registrar transfer to perform. Sells therefore drop out of the
  Transfer Queue. They are still booked into the ledger the normal way —
  Transactions -> "Book a confirmed deal" -> the sell disposal prompt reduces
  the client's holding — and MIS counts them from deal_confirmation_id, not
  from transfer_stage.

  Deliberately NOT touched: the nw_deal_transfer_eligible view. It is shared
  with that booking picker (src/crm/Transactions.tsx), so filtering sells there
  would leave a sell deal with no way to become a transaction. The queue-side
  rule lives in the two places that are only about transferring:

    1. nw_deal_in_transfer_queue() — what a transfer_admin login may read
       (see 20260911120000_transfer_admin_role.sql)
    2. nw_transfer_deal()          — the trust boundary, so a stale tab or a
       direct call cannot transfer a sell either

  The two sells transferred before this rule (DC-1782278007563 Jun 2026,
  DC-1786968152819 Aug 2026) are left as they are; nw_reverse_transfer can
  still undo them.
*/

-- 1. The transfer login sees queued BUY deals only.
CREATE OR REPLACE FUNCTION public.nw_deal_in_transfer_queue(p_deal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM nw_deal_transfer_eligible
    WHERE deal_id = p_deal_id
      AND LOWER(COALESCE(transaction_type, '')) <> 'sell'
  );
$$;

-- 2. Refuse a sell at the transfer boundary. Patched in place from the live
--    definition (last full rewrite: 20260903120000_transfer_deal_transfer_date.sql)
--    so nothing else in the body can drift; the assertion fails loudly if the
--    anchor ever changes shape.
DO $$
DECLARE
  v_def text := pg_get_functiondef(
    'public.nw_transfer_deal(uuid,uuid,text,text,boolean,timestamptz)'::regprocedure);
  v_anchor text := $q$  v_is_sell := LOWER(COALESCE(v_deal.transaction_type, '')) = 'sell';$q$;
  v_new    text := $q$  v_is_sell := LOWER(COALESCE(v_deal.transaction_type, '')) = 'sell';
  IF v_is_sell THEN
    RAISE EXCEPTION 'A Sell deal is not transferred - the stock is bought from the client. Book it from Transactions instead.'
      USING ERRCODE = 'check_violation';
  END IF;$q$;
BEGIN
  IF position('A Sell deal is not transferred' IN v_def) > 0 THEN
    RETURN; -- already applied
  END IF;
  IF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'nw_transfer_deal sell anchor not found - update this migration';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_new);
END $$;
