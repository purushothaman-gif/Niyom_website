/*
  # Remove G kavita Sri's test-data orphaned holdings

  Owner-approved 2026-07-25. G kavita Sri (PAN ABCDE1234F — a placeholder/test
  PAN) has two holdings with no backing transaction, identified as test data:
    csk  (unlisted_share)  ₹11,240
    NSI  (unlisted_share)  ₹240
  Remove both and recompute portfolio_value. Guarded to run only while the
  client still has zero transactions, so a real position can never be dropped.
  No other client is touched — the remaining orphaned holdings on other clients
  are directly-entered portfolios and are intentionally left in place.
*/

DO $$
DECLARE
  v_client uuid := 'cf7f0b14-035e-4cb7-b74a-cdb60064423e';  -- G kavita Sri
  v_txns   int;
  v_removed int;
BEGIN
  SELECT count(*) INTO v_txns FROM nw_transactions WHERE client_id = v_client;
  IF v_txns > 0 THEN
    RAISE NOTICE 'G kavita Sri now has % transaction(s) — skipping cleanup.', v_txns;
    RETURN;
  END IF;

  DELETE FROM nw_holdings WHERE client_id = v_client;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  PERFORM nw_recompute_portfolio_value(v_client);

  RAISE NOTICE 'Removed % test holding(s) for G kavita Sri; portfolio_value recomputed.', v_removed;
END $$;
