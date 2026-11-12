/*
  # Investor profile: align the occupation list with BSE's

  BSE StAR MF API v2 (§7.4.8 occ_code) also lists Doctor and Forex Dealer.
  Everything else collected in onboarding already matched its code lists.

  Country of birth and foreign tax residence now hold ISO 3166-1 alpha-3 codes
  ('IND') instead of free text — BSE asks for the code (§7.4.21). No constraint
  is added for them: the list lives in _shared/profile/countries.ts and the
  save function validates against it. No rows held a value when this ran.
*/
ALTER TABLE nw_clients DROP CONSTRAINT IF EXISTS nw_clients_occupation_check;
ALTER TABLE nw_clients ADD CONSTRAINT nw_clients_occupation_check CHECK (
  occupation IN ('private_sector_service','public_sector_service','government_service','business',
                 'professional','doctor','forex_dealer','agriculturist','retired','housewife','student','others')
);
