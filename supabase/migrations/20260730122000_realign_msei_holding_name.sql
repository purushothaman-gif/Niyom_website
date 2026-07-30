/*
  # Re-link MSEI holding after duplicate removal

  20260730120000 removed the manual MSEI duplicate for PANTHALLOORPARAM MANOJ
  KUMAR (NW-006-0007). That was the row whose product_name ("MSEI") matched the
  holding; the surviving deal-linked transaction spells the security out in
  full. nw_orphaned_holdings matches on exact lower(btrim(product_name)), so the
  holding started showing as orphaned even though it is properly backed.

  Align the holding's name with its backing transaction. Position, quantity and
  value are unchanged.
*/

UPDATE nw_holdings
   SET product_name = 'METROPOLITAN STOCK EXCHANGE OF INDIA LIMITED',
       updated_at = now()
 WHERE id = '0a122cf7-2ede-4628-95d6-e10053c94e1f'
   AND product_name = 'MSEI';

DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM nw_orphaned_holdings
   WHERE holding_id = '0a122cf7-2ede-4628-95d6-e10053c94e1f';
  IF v <> 0 THEN RAISE EXCEPTION 'MSEI holding still flagged as orphaned.'; END IF;
  RAISE NOTICE 'MSEI holding re-linked to its surviving transaction.';
END $$;
