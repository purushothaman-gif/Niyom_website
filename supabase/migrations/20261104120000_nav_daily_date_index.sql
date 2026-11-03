-- Portal fund matching reads only the most recent NAV dates by scheme name;
-- without this the query seq-scans every NAV ever stored (~2.3s).
-- Applied to the hosted DB via MCP apply_migration on 2026-11-04.
create index if not exists idx_nav_daily_nav_date on public.nav_daily (nav_date desc);
