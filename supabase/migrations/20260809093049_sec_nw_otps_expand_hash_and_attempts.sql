-- Security fix (finding 3), EXPAND step. nw_otps is the only OTP table that
-- stores its code in cleartext and has no attempt counter -- every other OTP
-- table (nw_password_reset_otps, nw_client_password_reset_otps, nw_deal_otps,
-- dsa_debit_note_otps) already uses otp_hash + attempts.
--
-- Expand only: add the replacement columns and relax the old one. The cleartext
-- `otp` column is NOT dropped here -- edge functions deploy separately, so the
-- contract step (DROP COLUMN otp) follows once the new code is live and verified.

ALTER TABLE public.nw_otps
  ADD COLUMN IF NOT EXISTS otp_hash text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.nw_otps ALTER COLUMN otp DROP NOT NULL;

COMMENT ON COLUMN public.nw_otps.otp IS
  'DEPRECATED cleartext code. Superseded by otp_hash; drop after the hashed flow has been live and verified.';
COMMENT ON COLUMN public.nw_otps.otp_hash IS
  'SHA-256 of `${otp}:${phone}:${ONBOARDING_OTP_PEPPER}`.';
COMMENT ON COLUMN public.nw_otps.attempts IS
  'Failed verification attempts against this code. Capped in checkOtp().';
