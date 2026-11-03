-- MF holdings & folios imported from the registrar (CAMS/KFintech) mailback
-- feeds. See docs/mf-rta-feeds-plan.md. Phase 1 is an admin CRM upload of the
-- CAMS WBR9 feed, which carries one row per scheme-folio with CLOS_BAL (units)
-- and RUPEE_BAL (the registrar's own valuation) — i.e. a daily holdings
-- snapshot plus the folio master.
--
-- These tables are deliberately separate from the retired in-house MF data
-- (hidden behind VITE_MF_SSO), so nothing is double-counted. Writes are done
-- only by the mf-rta-import edge function using the service role, which
-- bypasses RLS; authenticated staff get read-only access, scoped by role.

create table if not exists public.mf_rta_folios (
  id uuid primary key default gen_random_uuid(),
  registrar text not null,                 -- 'CAMS' | 'KFINTECH'
  folio text not null,
  amc_code text,
  holder_name text,
  pan text,                                -- first holder PAN; client match key
  joint_names text[] not null default '{}',
  joint_pans text[] not null default '{}',
  tax_status text,
  arn text,
  sub_broker text,
  email text,
  mobile text,
  demat text,
  folio_open_date date,
  client_id uuid references public.nw_clients(id) on delete set null,
  matched_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (registrar, folio)
);
create index if not exists mf_rta_folios_client_idx on public.mf_rta_folios(client_id);
create index if not exists mf_rta_folios_pan_idx on public.mf_rta_folios(pan);

create table if not exists public.mf_rta_holdings (
  id uuid primary key default gen_random_uuid(),
  folio_id uuid not null references public.mf_rta_folios(id) on delete cascade,
  registrar text not null,
  folio text not null,
  scheme_code text not null,
  scheme_name text,
  amc_code text,
  units numeric(22,6) not null default 0,
  rta_value numeric(22,4),                 -- registrar valuation (RUPEE_BAL)
  nav numeric(22,6),                       -- best-effort, name-matched to mf_scheme_cache
  nav_value numeric(22,4),                 -- units * nav when nav is known
  snapshot_date date,
  updated_at timestamptz not null default now(),
  unique (registrar, folio, scheme_code)
);
create index if not exists mf_rta_holdings_folio_idx on public.mf_rta_holdings(folio_id);

create table if not exists public.mf_rta_import_log (
  id uuid primary key default gen_random_uuid(),
  registrar text,
  report text,
  source_file text,
  file_hash text,
  snapshot_date date,
  rows_total int not null default 0,
  folios_upserted int not null default 0,
  holdings_upserted int not null default 0,
  matched int not null default 0,          -- folios newly linked to a client this run
  unmatched int not null default 0,        -- folios with no client after this run
  status text not null default 'ok',       -- 'ok' | 'error'
  error text,
  duration_ms int,
  imported_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists mf_rta_import_log_created_idx on public.mf_rta_import_log(created_at desc);

-- RLS. Admins see everything; an RM sees only the folios/holdings of their own
-- clients. The import log is admin-only. Helper calls are wrapped in (select …)
-- so the planner evaluates them once per query, not once per row (initplan).
alter table public.mf_rta_folios enable row level security;
alter table public.mf_rta_holdings enable row level security;
alter table public.mf_rta_import_log enable row level security;

create policy mf_rta_folios_read on public.mf_rta_folios
  for select to authenticated
  using (
    (select nw_current_emp_is_admin())
    or client_id in (
      select id from public.nw_clients where employee_id = (select nw_current_employee_id())
    )
  );

create policy mf_rta_holdings_read on public.mf_rta_holdings
  for select to authenticated
  using (
    (select nw_current_emp_is_admin())
    or folio_id in (
      select f.id from public.mf_rta_folios f
      join public.nw_clients c on c.id = f.client_id
      where c.employee_id = (select nw_current_employee_id())
    )
  );

create policy mf_rta_import_log_read on public.mf_rta_import_log
  for select to authenticated
  using ((select nw_current_emp_is_admin()));

-- Explicit grants (the implicit Data-API default is being tightened). Staff
-- read; the service role (edge function) writes; anon gets nothing.
grant select on public.mf_rta_folios, public.mf_rta_holdings, public.mf_rta_import_log to authenticated;
grant all on public.mf_rta_folios, public.mf_rta_holdings, public.mf_rta_import_log to service_role;
revoke all on public.mf_rta_folios, public.mf_rta_holdings, public.mf_rta_import_log from anon;
