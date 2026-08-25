-- Coupon-entitlement fields for the entitlement-first accrued-interest engine.
-- Optional and nullable — existing rows stay NULL (no default), so the analytics
-- engine keeps its exact cum-interest behaviour until a security carries real values.
-- These are populated ONLY from reliable security-specific information; they are never
-- inferred from coupon frequency, IP dates, maturity, the coupon date, or a generic
-- N-day rule. record_date is treated as the ex-interest date ONLY when
-- coupon_entitlement_rule = 'ex_on_record_date' (or an actual ex_interest_date is set).
ALTER TABLE bm_bonds
  ADD COLUMN IF NOT EXISTS record_date date,
  ADD COLUMN IF NOT EXISTS ex_interest_date date,
  ADD COLUMN IF NOT EXISTS coupon_entitlement_rule text;
