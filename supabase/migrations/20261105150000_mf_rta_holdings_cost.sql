-- CAMS WBR53 ("Valuation of all non-zero folios as of a Date") carries the
-- registrar's own cost of acquisition per holding — the authoritative invested
-- amount that survives a broker change. The transaction feed (WBR2) cannot see
-- cost for units transferred in from a prior distributor, which left folios like
-- a client's PPFAS transfer-in showing value-but-no-return. Store the valuation
-- cost on the holding so the read model can prefer it over the transaction-
-- derived figure. Additive, nullable — existing holdings are unaffected until a
-- valuation feed populates them.
alter table public.mf_rta_holdings
  add column if not exists invested_cost numeric,
  add column if not exists cost_date date;

comment on column public.mf_rta_holdings.invested_cost is
  'Registrar cost of acquisition for the held units (CAMS WBR53 valuation feed). Authoritative invested amount; includes pre-transfer purchases the WBR2 transaction feed lacks. Null until a valuation feed has been imported for this holding.';
comment on column public.mf_rta_holdings.cost_date is
  'As-on date of the valuation feed that set invested_cost.';
