-- =============================================================================
-- Restore the CRLF line endings inside the BLKPAY instruction row.
--
-- The issued sheet wraps its guidance with CRLF ("Enter beneficiary name.\r\n
-- MANDATORY"). Those carriage returns were stripped somewhere between reading
-- the file and reaching Postgres, leaving bare LFs, so the generated sheet was
-- byte-for-byte different from the bank's in a way no one would ever see by
-- looking at it.
--
-- Almost certainly harmless to the bank's parser -- it reads cell values, not
-- their internal wrapping. Fixed anyway, because "matches the bank's template"
-- is either true or it is not, and a test that asserts it should not have to
-- carve out an exception.
--
-- Built with chr(13) so the carriage returns are constructed inside the
-- database and cannot be stripped in transit again. Collapses first, then
-- expands, so running it twice changes nothing.
-- =============================================================================

UPDATE public.hr_bank_payment_template_columns
   SET instruction_text = replace(
         replace(instruction_text, chr(13) || chr(10), chr(10)),
         chr(10), chr(13) || chr(10))
 WHERE instruction_text <> ''
   AND position(chr(10) in instruction_text) > 0;
