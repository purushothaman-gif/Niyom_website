-- MF brokerage from the CAMS mailback reports (ARN-362707).
--
--   WBR77 "Consolidated Brokerage Payout Details": one row per brokerage line
--         (trail / upfront) per transaction per period, with the rate, average
--         assets, days, ex-GST brokerage and GST. No PAN, so rows are matched
--         to clients by FOLIO (registrar folio master, then transactions), with
--         an exact-name fallback. EUIN (ARN_EMP_CO) gives the selling employee.
--   WBR39 "Scheme master": AMC + scheme code -> scheme name, plan, asset
--         class, ISIN. WBR77 carries only codes, so this labels it.
--
-- mf_brokerage_receipts = what each AMC actually paid for a month (from the AMC
-- "brokerage payout" notification), so the CRM can reconcile computed (WBR77)
-- against received. The existing name-matched mf_brokerage (xlsx -> MIS) is
-- left untouched: MIS keeps reading it until the user decides otherwise.

-- ── Scheme master (WBR39) ────────────────────────────────────────────────────
create table if not exists public.mf_rta_schemes (
  registrar   text not null default 'CAMS',
  amc_code    text not null,
  scheme_code text not null,
  amc_name    text,
  scheme_name text,
  scheme_type text,
  plan_type   text,
  asset_class text,
  sebi_class  text,
  isin        text,
  parent_code text,
  last_seen_at timestamptz not null default now(),
  primary key (registrar, amc_code, scheme_code)
);
create index if not exists mf_rta_schemes_isin_idx on public.mf_rta_schemes(isin);

-- ── Brokerage lines (WBR77) ──────────────────────────────────────────────────
create table if not exists public.mf_rta_brokerage (
  id uuid primary key default gen_random_uuid(),
  registrar text not null default 'CAMS',
  row_key   text not null,               -- stable per-line key (idempotent upsert)
  amc_code  text,
  scheme_code text,                      -- SCHEME_COD (scheme the brokerage is on)
  txn_scheme_code text,                  -- TXN_SCH_CO
  folio     text not null,
  holder_name text,
  arn       text,
  sub_broker text,
  euin      text,
  euin_valid boolean,
  brokerage_type text,                   -- raw BRKAGE_TYP (e.g. TF)
  category  text not null default 'other' check (category in ('trail','upfront','other')),
  trxn_type text,
  trxn_desc text,
  trxn_no   text,
  trade_date date,
  txn_amount numeric(20,6),
  txn_units  numeric(20,6),
  rate       numeric(12,6),              -- % p.a. for trail
  avg_assets numeric(20,6),
  no_of_days int,
  brokerage  numeric(18,6) not null default 0,   -- ex-GST = the revenue
  igst numeric(18,6) not null default 0,
  cgst numeric(18,6) not null default 0,
  sgst numeric(18,6) not null default 0,
  gst_total numeric(18,6) generated always as (igst + cgst + sgst) stored,
  brokerage_from date,
  brokerage_to   date,
  process_from   date,
  process_to     date,
  posted_date    date,
  brokerage_month date not null,         -- first of the month the brokerage is for
  adj_flag text,
  rate_ref text,
  folio_id uuid references public.mf_rta_folios(id) on delete set null,
  client_id uuid references public.nw_clients(id) on delete set null,
  sold_by_employee_id uuid references public.nw_employees(id) on delete set null,
  match_method text,                     -- folio | txn_folio | name | manual
  matched_at timestamptz,
  source_file_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (registrar, row_key)
);
create index if not exists mf_rta_brokerage_month_idx  on public.mf_rta_brokerage(brokerage_month);
create index if not exists mf_rta_brokerage_client_idx on public.mf_rta_brokerage(client_id);
create index if not exists mf_rta_brokerage_folio_idx  on public.mf_rta_brokerage(folio_id);
create index if not exists mf_rta_brokerage_emp_idx    on public.mf_rta_brokerage(sold_by_employee_id);
create index if not exists mf_rta_brokerage_hash_idx   on public.mf_rta_brokerage(source_file_hash);

-- ── AMC payouts actually received (manual for now) ───────────────────────────
create table if not exists public.mf_brokerage_receipts (
  id uuid primary key default gen_random_uuid(),
  registrar text not null default 'CAMS',
  amc_code text not null,
  period_month date not null,
  amount numeric(18,4) not null,        -- as stated by the AMC payout notice
  notes text,
  entered_by uuid references public.nw_employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registrar, amc_code, period_month)
);

-- ── Import log: brokerage/scheme counters + the file's own amount totals ─────
alter table public.mf_rta_import_log
  add column if not exists brokerage_upserted int not null default 0,
  add column if not exists schemes_upserted int not null default 0,
  add column if not exists amount_total numeric(18,6),
  add column if not exists gst_total numeric(18,6);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.mf_rta_schemes enable row level security;
alter table public.mf_rta_brokerage enable row level security;
alter table public.mf_brokerage_receipts enable row level security;

-- Scheme master is public reference data (no client info): any employee reads.
create policy mf_rta_schemes_read on public.mf_rta_schemes for select to authenticated
  using ((select nw_current_employee_id()) is not null);

-- Brokerage: admins everything; an RM only lines on their own clients.
create policy mf_rta_brokerage_read on public.mf_rta_brokerage for select to authenticated
  using ((select nw_current_emp_is_admin())
    or client_id in (select id from public.nw_clients where employee_id = (select nw_current_employee_id())));
create policy mf_rta_brokerage_admin_update on public.mf_rta_brokerage for update to authenticated
  using ((select nw_current_emp_is_admin())) with check ((select nw_current_emp_is_admin()));

create policy mf_brokerage_receipts_admin on public.mf_brokerage_receipts for all to authenticated
  using ((select nw_current_emp_is_admin())) with check ((select nw_current_emp_is_admin()));

revoke all on public.mf_rta_schemes, public.mf_rta_brokerage, public.mf_brokerage_receipts from anon, public;
grant select on public.mf_rta_schemes to authenticated;
grant select, update on public.mf_rta_brokerage to authenticated;
grant select, insert, update, delete on public.mf_brokerage_receipts to authenticated;
grant all on public.mf_rta_schemes, public.mf_rta_brokerage, public.mf_brokerage_receipts to service_role;

-- ── Matching: folio -> client, EUIN -> selling employee ──────────────────────
-- Folio numbers arrive as "12345678", "12345678/12" or "12345678 / 0": compare
-- on the part before the slash, alphanumerics only, and within the same AMC
-- whenever both sides know it.
create or replace function public.mf_folio_base(p text)
returns text language sql immutable parallel safe as $$
  select nullif(upper(regexp_replace(split_part(coalesce(p, ''), '/', 1), '[^A-Za-z0-9]', '', 'g')), '')
$$;

create or replace function public.mf_rta_brokerage_match(p_only_unmatched boolean default true)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int := 0;
  k int;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or coalesce(nw_current_emp_is_admin(), false)) then
    raise exception 'Only admins can re-match brokerage.' using errcode = '42501';
  end if;

  -- 1) registrar folio master
  update mf_rta_brokerage b
     set folio_id = f.id, client_id = f.client_id, match_method = 'folio', matched_at = now()
    from mf_rta_folios f
   where f.registrar = b.registrar
     and f.client_id is not null
     and mf_folio_base(f.folio) = mf_folio_base(b.folio)
     and (f.amc_code is null or b.amc_code is null or upper(f.amc_code) = upper(b.amc_code))
     and (not p_only_unmatched or b.client_id is null)
     and b.match_method is distinct from 'manual';
  get diagnostics k = row_count; n := n + k;

  -- 2) folio seen in the transaction feeds
  update mf_rta_brokerage b
     set client_id = t.client_id, match_method = 'txn_folio', matched_at = now()
    from (select distinct on (registrar, mf_folio_base(folio), upper(coalesce(amc_code, '')))
                 registrar, mf_folio_base(folio) fb, upper(coalesce(amc_code, '')) amc, client_id
            from mf_rta_transactions where client_id is not null
           order by registrar, mf_folio_base(folio), upper(coalesce(amc_code, '')), last_seen_at desc) t
   where t.registrar = b.registrar and t.fb = mf_folio_base(b.folio)
     and (t.amc = '' or b.amc_code is null or t.amc = upper(b.amc_code))
     and b.client_id is null
     and b.match_method is distinct from 'manual';
  get diagnostics k = row_count; n := n + k;

  -- 3) exact holder name, only when exactly one client carries it
  update mf_rta_brokerage b
     set client_id = c.id, match_method = 'name', matched_at = now()
    from (select upper(regexp_replace(full_name, '\s+', ' ', 'g')) nm, min(id::text)::uuid id
            from nw_clients where full_name is not null
           group by 1 having count(*) = 1) c
   where b.client_id is null
     and b.holder_name is not null
     and c.nm = upper(regexp_replace(trim(b.holder_name), '\s+', ' ', 'g'))
     and b.match_method is distinct from 'manual';
  get diagnostics k = row_count; n := n + k;

  -- EUIN -> the employee who sold it (independent of the client's RM)
  update mf_rta_brokerage b
     set sold_by_employee_id = e.id
    from nw_employees e
   where e.euin is not null and upper(trim(e.euin)) = upper(trim(b.euin))
     and b.sold_by_employee_id is distinct from e.id;

  return n;
end;
$$;
revoke all on function public.mf_rta_brokerage_match(boolean) from public, anon;
grant execute on function public.mf_rta_brokerage_match(boolean) to authenticated, service_role;

-- ── Reporting view: brokerage line + scheme labels + client / RM / DSA ───────
-- security_invoker so the base-table RLS (admin all / RM own clients) applies.
create or replace view public.mf_rta_brokerage_mis
with (security_invoker = true) as
select
  b.id, b.registrar, b.brokerage_month, b.category, b.brokerage_type,
  b.amc_code, coalesce(s.amc_name, b.amc_code) as amc_name,
  b.scheme_code, coalesce(s.scheme_name, b.trxn_desc, b.scheme_code) as scheme_name,
  s.plan_type, s.asset_class, s.isin,
  b.folio, b.holder_name, b.trxn_type, b.trade_date, b.txn_amount,
  b.rate, b.avg_assets, b.no_of_days, b.brokerage, b.gst_total,
  b.brokerage_from, b.brokerage_to, b.posted_date,
  b.euin, b.euin_valid, b.match_method,
  b.client_id, c.full_name as client_name, c.client_code,
  c.employee_id as rm_id, rm.full_name as rm_name,
  c.dsa_id, d.full_name as dsa_name,
  b.sold_by_employee_id, sb.full_name as sold_by_name
from public.mf_rta_brokerage b
left join public.mf_rta_schemes s
  on s.registrar = b.registrar and s.amc_code = b.amc_code and s.scheme_code = b.scheme_code
left join public.nw_clients c on c.id = b.client_id
left join public.nw_employees rm on rm.id = c.employee_id
left join public.nw_dsa d on d.id = c.dsa_id
left join public.nw_employees sb on sb.id = b.sold_by_employee_id;

revoke all on public.mf_rta_brokerage_mis from anon, public;
grant select on public.mf_rta_brokerage_mis to authenticated, service_role;
