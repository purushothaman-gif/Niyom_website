-- Client-wise monthly MF brokerage, uploaded from the registrar/AMC brokerage
-- report. Feeds MIS as actual MF revenue (ex-GST), credited to the client's RM.
create table if not exists public.mf_brokerage (
  id uuid primary key default gen_random_uuid(),
  raw_name text not null,
  client_id uuid references public.nw_clients(id) on delete set null,
  period_month date not null,
  period_label text,
  brokerage numeric(18,4) not null default 0,  -- ex-GST = the revenue
  gst numeric(18,4) not null default 0,        -- pass-through; not counted
  source_file text,
  imported_by uuid,
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (raw_name, period_month)
);
create index if not exists mf_brokerage_client_idx on public.mf_brokerage(client_id);
create index if not exists mf_brokerage_month_idx on public.mf_brokerage(period_month);

create table if not exists public.mf_brokerage_imports (
  id uuid primary key default gen_random_uuid(),
  source_file text, months_covered text,
  rows_total int not null default 0, matched int not null default 0, unmatched int not null default 0,
  amount_total numeric(18,4) not null default 0, imported_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists mf_brokerage_imports_created_idx on public.mf_brokerage_imports(created_at desc);

alter table public.mf_brokerage enable row level security;
alter table public.mf_brokerage_imports enable row level security;
create policy mf_brokerage_read on public.mf_brokerage for select to authenticated
  using ((select nw_current_emp_is_admin())
    or client_id in (select id from public.nw_clients where employee_id = (select nw_current_employee_id())));
create policy mf_brokerage_admin_write on public.mf_brokerage for all to authenticated
  using ((select nw_current_emp_is_admin())) with check ((select nw_current_emp_is_admin()));
create policy mf_brokerage_imports_read on public.mf_brokerage_imports for select to authenticated
  using ((select nw_current_emp_is_admin()));
create policy mf_brokerage_imports_write on public.mf_brokerage_imports for all to authenticated
  using ((select nw_current_emp_is_admin())) with check ((select nw_current_emp_is_admin()));
grant select, insert, update, delete on public.mf_brokerage, public.mf_brokerage_imports to authenticated;
grant all on public.mf_brokerage, public.mf_brokerage_imports to service_role;
revoke all on public.mf_brokerage, public.mf_brokerage_imports from anon;
