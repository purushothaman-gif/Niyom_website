/*
  Authoritative cash-flow schedule from a licensed bond-data provider (Harmoney / InferEdge).

  source_cashflows = { provider, fetched_at, ref: { instrument_id }, flows: [
      { date, record_date, type: 'coupon'|'principal'|'other', amount_per_100, interest_days } ] }

  When present, bond-enrich builds coupon dates, outstanding principal and coupon entitlement
  (record dates → ex-interest) from it instead of inferring them from the SMC sheet's IP-date
  text. Written only by bond-enrich (service role). Additive: nothing reads it until the
  provider's API key is configured.

  Confidentiality: analytics.accrued_check (the provider's own accrued/yield at our base
  latest_price) is internal and is stripped from every client/partner projection alongside the
  existing base-price keys — its yield would let a client back out the base price.
*/
ALTER TABLE bm_bonds ADD COLUMN IF NOT EXISTS source_cashflows jsonb;

COMMENT ON COLUMN bm_bonds.source_cashflows IS
  'Licensed-provider cash-flow schedule incl. record dates (bond-enrich). Overrides the IP-date calendar when present.';

CREATE OR REPLACE FUNCTION bm_public_analytics(a jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN a IS NULL THEN NULL
              ELSE a - 'clean_price' - 'dirty_price' - 'current_yield' - 'accrued_check' END
$$;
