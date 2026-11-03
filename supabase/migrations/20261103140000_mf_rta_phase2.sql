-- MF registrar mailback feeds, Phase 2: SIP registrations (CAMS WBR49),
-- client-facing read access, automated-ingest dedupe, and a feed-health view.
-- See docs/mf-rta-feeds-plan.md. The daily feeds are now pulled automatically
-- by a Google Apps Script that POSTs each encrypted ZIP to the mf-rta-ingest
-- edge function (shared-secret auth); mf-rta-import stays for manual re-imports.

-- --- SIP registrations (WBR49) --------------------------------------------
-- One row per active systematic registration (SIP / STP / SWP). WBR49 is a
-- point-in-time dump of live registrations; status is derived from the dates
-- (cease/to/pause) rather than from a row's presence or absence, so a partial
-- per-AMC file never wrongly "ceases" a registration it simply didn't list.
create table if not exists public.mf_rta_sips (
  id uuid primary key default gen_random_uuid(),
  registrar text not null,                 -- 'CAMS' | 'KFINTECH'
  folio text not null,
  scheme_code text not null,               -- PRODUCT
  sip_ref text not null,                   -- AUTO_TRNO, or a composite when absent
  folio_id uuid references public.mf_rta_folios(id) on delete set null,
  scheme_name text,
  amc_code text,
  holder_name text,
  pan text,                                -- first-holder PAN; client match key
  txn_type text,                           -- SIP | STP | SWP (AUT_TRNTYP)
  amount numeric(22,6),                    -- AUTO_AMOUN (per instalment)
  frequency text,                          -- PERIODICIT (MONTHLY, WEEKLY, ...)
  sip_day text,                            -- PERIOD_DAY (the mandate day(s))
  payment_mode text,                       -- PAYMENT_MO
  from_date date,
  to_date date,
  cease_date date,
  reg_date date,
  pause_from date,
  pause_to date,
  top_up_amount numeric(22,6),
  top_up_frequency text,
  top_up_percent numeric(9,4),
  bank text,
  branch text,
  ac_type text,
  euin text,
  sub_arn text,
  sub_broker text,
  target_scheme_code text,                 -- STP target (best-effort)
  status text not null default 'active',   -- active | paused | ceased (derived)
  client_id uuid references public.nw_clients(id) on delete set null,
  matched_at timestamptz,
  snapshot_date date,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registrar, sip_ref)
);
create index if not exists mf_rta_sips_client_idx on public.mf_rta_sips(client_id);
create index if not exists mf_rta_sips_folio_idx on public.mf_rta_sips(folio_id);
create index if not exists mf_rta_sips_pan_idx on public.mf_rta_sips(pan);

-- --- Automated-ingest dedupe + traceability -------------------------------
-- The Apps Script also tags each POST with the Gmail message id it came from.
-- Dedupe in the edge function is by file_hash (content), with message_id kept
-- for an audit trail; index both so the lookups are cheap.
alter table public.mf_rta_import_log add column if not exists message_id text;
alter table public.mf_rta_import_log add column if not exists source text; -- 'manual' | 'auto'
alter table public.mf_rta_import_log add column if not exists sips_upserted int not null default 0;
create index if not exists mf_rta_import_log_file_hash_idx on public.mf_rta_import_log(file_hash);
create index if not exists mf_rta_import_log_message_idx on public.mf_rta_import_log(message_id);

-- --- RLS: let a client read their own folios / holdings / SIPs -------------
-- Phase 1 scoped reads to staff only (admins all, RM own clients). Clients log
-- in as `authenticated` too but have no employee row, so they saw nothing.
-- Add a client clause via nw_current_client_id() (the logged-in client's id).
-- Policies are recreated (not just added) so the staff clause is preserved.

drop policy if exists mf_rta_folios_read on public.mf_rta_folios;
create policy mf_rta_folios_read on public.mf_rta_folios
  for select to authenticated
  using (
    (select nw_current_emp_is_admin())
    or client_id = (select nw_current_client_id())
    or client_id in (
      select id from public.nw_clients where employee_id = (select nw_current_employee_id())
    )
  );

drop policy if exists mf_rta_holdings_read on public.mf_rta_holdings;
create policy mf_rta_holdings_read on public.mf_rta_holdings
  for select to authenticated
  using (
    (select nw_current_emp_is_admin())
    or folio_id in (
      select f.id from public.mf_rta_folios f
      where f.client_id = (select nw_current_client_id())
    )
    or folio_id in (
      select f.id from public.mf_rta_folios f
      join public.nw_clients c on c.id = f.client_id
      where c.employee_id = (select nw_current_employee_id())
    )
  );

alter table public.mf_rta_sips enable row level security;
create policy mf_rta_sips_read on public.mf_rta_sips
  for select to authenticated
  using (
    (select nw_current_emp_is_admin())
    or client_id = (select nw_current_client_id())
    or client_id in (
      select id from public.nw_clients where employee_id = (select nw_current_employee_id())
    )
  );

-- Grants: staff + clients read; the edge function (service role) writes.
grant select on public.mf_rta_sips to authenticated;
grant all on public.mf_rta_sips to service_role;
revoke all on public.mf_rta_sips from anon;

-- --- Feed-health (admin-only) ---------------------------------------------
-- Latest successful import per registrar+report, with its age in hours, so the
-- CRM and the daily alert can tell at a glance whether a feed has gone stale.
-- SECURITY INVOKER: it reads mf_rta_import_log under the caller's RLS, which is
-- admin-only, so the view is admin-only too.
create or replace view public.mf_rta_feed_health
with (security_invoker = true) as
select
  registrar,
  report,
  max(created_at) filter (where status = 'ok')               as last_ok_at,
  max(snapshot_date) filter (where status = 'ok')            as last_snapshot_date,
  round(extract(epoch from (now() - max(created_at) filter (where status = 'ok'))) / 3600.0, 1)
                                                             as hours_since_ok,
  max(created_at)                                            as last_attempt_at,
  (select status from public.mf_rta_import_log l2
    where l2.registrar = l.registrar and l2.report = l.report
    order by created_at desc limit 1)                        as last_status
from public.mf_rta_import_log l
where registrar is not null and report is not null
group by registrar, report;

grant select on public.mf_rta_feed_health to authenticated;
