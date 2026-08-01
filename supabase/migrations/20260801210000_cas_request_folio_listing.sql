/*
  # Record which folio listing was asked for

  `include_zero_balance` was a boolean, which was wrong the moment we looked at
  the actual CAMS form: folio listing is a three-way choice, not a yes/no.

      With zero balance folios
      Without zero balance folios          <- the page's default
      Transacted folios and folios with balance

  We now ask for the third. Because the period we request runs from 1990,
  "transacted in the period" means "transacted ever", so it captures every folio
  the client has since exited — which is where realised capital gains live —
  alongside everything they still hold. It also leaves out folios opened and
  never funded, which the first option would have dragged in as noise.

  Existing rows are backfilled to what those clients were actually told at the
  time, not to the new answer. A request record is evidence of the instruction
  we gave; rewriting it to match current guidance would make it a record of
  nothing.
*/

ALTER TABLE cas_requests ADD COLUMN IF NOT EXISTS folio_listing text;

COMMENT ON COLUMN cas_requests.folio_listing IS
  'Which CAMS folio-listing option the client was told to pick: with_zero_balance | without_zero_balance | transacted_and_balance.';

/* Rows created before this change were guided to "With zero balance folios". */
UPDATE cas_requests
   SET folio_listing = 'with_zero_balance'
 WHERE folio_listing IS NULL;

ALTER TABLE cas_requests ALTER COLUMN folio_listing SET DEFAULT 'transacted_and_balance';

/*
 * Superseded by the column above. Written but never read, so dropping it costs
 * nothing and leaving it would leave a boolean that cannot express the choice
 * we now make.
 */
ALTER TABLE cas_requests DROP COLUMN IF EXISTS include_zero_balance;
