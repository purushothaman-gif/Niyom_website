-- =============================================================================
-- Client profile self-service (approved 2026-11-06)
--
-- Clients may change their mobile, email, address, nominees and bank accounts
-- from the portal. Every write goes through the client-profile-update edge
-- function (service role) AFTER an email OTP to the registered address; the
-- client never gets direct write access to these tables, so the existing
-- self-update guard on nw_clients stays intact. Because the portal and the CRM
-- read the same rows, a change is visible in the CRM the moment it saves; each
-- one is also logged (nw_client_profile_changes) and alerts the RM.
-- =============================================================================

-- 1. Bank accounts: verification + provenance; clients may READ their own -----
alter table public.nw_client_bank_accounts
  add column if not exists verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'failed')),
  add column if not exists verified_at      timestamptz,
  add column if not exists name_at_bank     text,
  add column if not exists name_match       text,      -- Cashfree name_match_result
  add column if not exists verification_ref text,      -- Cashfree reference_id
  add column if not exists added_via        text not null default 'crm'
    check (added_via in ('crm', 'client_portal'));

drop policy if exists nw_cba_client_select on public.nw_client_bank_accounts;
create policy nw_cba_client_select on public.nw_client_bank_accounts
  for select to authenticated
  using (client_id = (select public.nw_current_client_id()));

-- 2. Nominees ----------------------------------------------------------------
create table if not exists public.nw_client_nominees (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.nw_clients(id) on delete cascade,
  full_name      text not null check (length(trim(full_name)) between 2 and 120),
  relationship   text not null check (length(trim(relationship)) between 2 and 40),
  dob            date,
  share_percent  numeric(5,2) not null check (share_percent > 0 and share_percent <= 100),
  guardian_name  text,
  mobile         text,
  email          text,
  address        text,
  added_via      text not null default 'crm' check (added_via in ('crm', 'client_portal')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_nw_client_nominees_client on public.nw_client_nominees (client_id);

-- Shares for one client may never exceed 100%. Deferred so a full replace
-- (delete + insert in one transaction) is checked once, at commit.
create or replace function public.nw_check_nominee_shares()
returns trigger language plpgsql set search_path = public as $$
declare total numeric;
begin
  select coalesce(sum(share_percent), 0) into total
  from nw_client_nominees where client_id = coalesce(new.client_id, old.client_id);
  if total > 100 then
    raise exception 'Nominee shares add up to % percent, more than 100 percent', total;
  end if;
  return null;
end $$;
drop trigger if exists trg_nw_nominee_shares on public.nw_client_nominees;
create constraint trigger trg_nw_nominee_shares
  after insert or update on public.nw_client_nominees
  deferrable initially deferred
  for each row execute function public.nw_check_nominee_shares();

alter table public.nw_client_nominees enable row level security;
create policy nw_nominees_client_select on public.nw_client_nominees
  for select to authenticated using (client_id = (select public.nw_current_client_id()));
create policy nw_nominees_staff_all on public.nw_client_nominees
  for all to authenticated
  using (exists (select 1 from public.nw_clients c where c.id = client_id
                 and (c.employee_id = (select public.nw_current_employee_id()) or (select public.nw_current_emp_is_admin()))))
  with check (exists (select 1 from public.nw_clients c where c.id = client_id
                 and (c.employee_id = (select public.nw_current_employee_id()) or (select public.nw_current_emp_is_admin()))));
revoke all on public.nw_client_nominees from anon, public;
grant select, insert, update, delete on public.nw_client_nominees to authenticated;
grant all on public.nw_client_nominees to service_role;

-- 3. Change log (written by the edge function only) --------------------------
create table if not exists public.nw_client_profile_changes (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.nw_clients(id) on delete cascade,
  field       text not null,
  old_value   text,
  new_value   text,
  source      text not null default 'client_portal',
  created_at  timestamptz not null default now()
);
create index if not exists idx_nw_profile_changes_client on public.nw_client_profile_changes (client_id, created_at desc);
alter table public.nw_client_profile_changes enable row level security;
create policy nw_profile_changes_client_select on public.nw_client_profile_changes
  for select to authenticated using (client_id = (select public.nw_current_client_id()));
create policy nw_profile_changes_staff_select on public.nw_client_profile_changes
  for select to authenticated
  using (exists (select 1 from public.nw_clients c where c.id = client_id
                 and (c.employee_id = (select public.nw_current_employee_id()) or (select public.nw_current_emp_is_admin()))));
revoke all on public.nw_client_profile_changes from anon, public;
grant select on public.nw_client_profile_changes to authenticated;
grant all on public.nw_client_profile_changes to service_role;

-- 4. OTPs for profile changes (service role only — no policies) --------------
create table if not exists public.nw_client_profile_otps (
  client_id   uuid primary key references public.nw_clients(id) on delete cascade,
  otp_hash    text not null,
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
alter table public.nw_client_profile_otps enable row level security;
revoke all on public.nw_client_profile_otps from anon, authenticated, public;
grant all on public.nw_client_profile_otps to service_role;
