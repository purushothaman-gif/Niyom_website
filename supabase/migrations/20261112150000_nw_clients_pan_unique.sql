/*
  # One client per PAN

  Every path that creates a client already refuses a PAN that is on file
  (CRM onboarding, partner-onboard-client, public-digilocker-apply) — except
  public-onboard-start, the anonymous website signup, which stored whatever PAN
  the request carried as verified. That function now makes the check too; this
  index is the backstop so no path, present or future, can put the same PAN on
  two clients (and it closes the check-then-insert race).

  Partial: clients without a PAN yet (NULL or blank) are unaffected. The key is
  normalised so 'abcde1234f ' cannot sit beside 'ABCDE1234F'. Verified before
  applying: 0 duplicate PANs in production on the normalised key.
*/

CREATE UNIQUE INDEX IF NOT EXISTS nw_clients_pan_unique
  ON nw_clients (upper(btrim(pan)))
  WHERE pan IS NOT NULL AND btrim(pan) <> '';
