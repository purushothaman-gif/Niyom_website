-- Phone (push) notifications for employees using the mobile app (1.3.0+).
-- ---------------------------------------------------------------------------
-- Every row added to nw_alerts — the CRM's bell — is ALSO sent to that
-- employee's phone. Nothing that creates alerts (leads, HR, orders, tickets…)
-- has to change: the trigger below picks them up.
--
--   app (Expo push token) ─▶ CRM page in the WebView ─▶ nw_register_push_token
--   insert into nw_alerts ─▶ trigger ─▶ pg_net ─▶ edge fn send-push ─▶ Expo ─▶ FCM
--
-- The token reaches the database from the CRM web page (signed in as the
-- employee), not from the app itself, so the app never holds a CRM session.

create table if not exists public.nw_push_tokens (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.nw_employees(id) on delete cascade,
  token text not null unique,
  platform text not null default 'android' check (platform in ('android', 'ios')),
  app_version text,
  device_name text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists nw_push_tokens_employee_idx on public.nw_push_tokens (employee_id);

alter table public.nw_push_tokens enable row level security;
-- Reads for the admin list only; all writes go through the functions below.
drop policy if exists "Admins read push tokens" on public.nw_push_tokens;
create policy "Admins read push tokens" on public.nw_push_tokens
  for select to authenticated using ((select public.nw_current_emp_is_admin()));
revoke all on public.nw_push_tokens from anon;

-- Called by the CRM page when it runs inside the app. A phone that another
-- employee signs in on moves to that employee (the token is per install).
create or replace function public.nw_register_push_token(
  p_token text, p_platform text default 'android', p_app_version text default null, p_device text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select id into v_emp from nw_employees where auth_user_id = auth.uid() and status = 'active';
  if v_emp is null then raise exception 'not an active employee'; end if;
  if p_token is null or p_token !~ '^ExponentPushToken\[[A-Za-z0-9_-]+\]$' then
    raise exception 'invalid push token';
  end if;
  insert into nw_push_tokens (employee_id, token, platform, app_version, device_name)
  values (v_emp, p_token, coalesce(nullif(p_platform, ''), 'android'), left(p_app_version, 20), left(p_device, 80))
  on conflict (token) do update
    set employee_id = excluded.employee_id, platform = excluded.platform,
        app_version = excluded.app_version, device_name = excluded.device_name, last_seen_at = now();
end $$;

-- Called on CRM sign-out inside the app, so the phone stops getting that
-- employee's notifications.
create or replace function public.nw_unregister_push_token(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from nw_push_tokens t using nw_employees e
   where t.token = p_token and e.id = t.employee_id and e.auth_user_id = auth.uid();
end $$;

-- Admin list: who gets phone notifications.
create or replace function public.nw_push_devices()
returns table (employee_id uuid, full_name text, app_version text, device_name text, last_seen_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not nw_current_emp_is_admin() then raise exception 'admins only'; end if;
  return query
    select e.id, e.full_name, t.app_version, t.device_name, t.last_seen_at
      from nw_push_tokens t join nw_employees e on e.id = t.employee_id
     where e.status = 'active'
     order by e.full_name, t.last_seen_at desc;
end $$;

-- Admin: send a notification to all active employees, or to the ones chosen.
-- It lands in each bell AND on each phone that has the app.
create or replace function public.nw_send_staff_notification(
  p_title text, p_message text, p_employee_ids uuid[] default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not nw_current_emp_is_admin() then raise exception 'admins only'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'title is required'; end if;
  insert into nw_alerts (employee_id, title, message, category, action_url)
  select e.id, left(trim(p_title), 120), left(coalesce(trim(p_message), ''), 1000), 'announcement', null
    from nw_employees e
   where e.status = 'active' and (p_employee_ids is null or e.id = any (p_employee_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.nw_register_push_token(text, text, text, text) from public, anon;
revoke execute on function public.nw_unregister_push_token(text) from public, anon;
revoke execute on function public.nw_push_devices() from public, anon;
revoke execute on function public.nw_send_staff_notification(text, text, uuid[]) from public, anon;
grant execute on function public.nw_register_push_token(text, text, text, text) to authenticated;
grant execute on function public.nw_unregister_push_token(text) to authenticated;
grant execute on function public.nw_push_devices() to authenticated;
grant execute on function public.nw_send_staff_notification(text, text, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Delivery. The edge function is deployed with verify_jwt=false (see the
-- cron GUC note) and authenticates the call with a vault secret, which it
-- checks through nw_push_secret_ok — service role only.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'push_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'push_secret');
  end if;
end $$;

create or replace function public.nw_push_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'push_secret' and decrypted_secret = p_secret);
$$;
revoke execute on function public.nw_push_secret_ok(text) from public, anon, authenticated;
grant execute on function public.nw_push_secret_ok(text) to service_role;

-- One call per INSERT statement (a broadcast to 40 people is one request).
-- Never lets a delivery problem block the alert itself.
create or replace function public.nw_push_new_alerts() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_secret text;
begin
  select array_agg(n.id) into v_ids
    from new_rows n
   where exists (select 1 from nw_push_tokens t where t.employee_id = n.employee_id)
     and coalesce(n.read, false) = false;
  if v_ids is null then return null; end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_secret';
  if v_secret is null then return null; end if;

  perform net.http_post(
    url := 'https://jlmwazuwjnhoqqloyeoj.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('alert_ids', to_jsonb(v_ids)),
    timeout_milliseconds := 30000
  );
  return null;
exception when others then
  raise warning 'nw_push_new_alerts: %', sqlerrm;
  return null;
end $$;

drop trigger if exists nw_alerts_push on public.nw_alerts;
create trigger nw_alerts_push
  after insert on public.nw_alerts
  referencing new table as new_rows
  for each statement execute function public.nw_push_new_alerts();

-- A new app version → a bell alert (and so a phone notification) for every
-- employee who has the app with notifications on.
create or replace function public.nw_app_release_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.audience <> 'employee' or not new.is_active then return new; end if;
  insert into nw_alerts (employee_id, title, message, category, action_url)
  select distinct t.employee_id,
         'App update: version ' || new.version_name,
         coalesce(nullif(trim(new.notes), ''), 'A new version of the Niyom Wealth app is ready. Tap to update.'),
         'app_update', '/crm/mobile_app'
    from nw_push_tokens t join nw_employees e on e.id = t.employee_id
   where e.status = 'active' and coalesce(t.app_version, '0') <> new.version_name;
  return new;
end $$;

drop trigger if exists nw_app_releases_alert on public.nw_app_releases;
create trigger nw_app_releases_alert
  after insert on public.nw_app_releases
  for each row execute function public.nw_app_release_alert();

revoke execute on function public.nw_push_new_alerts() from public, anon, authenticated;
revoke execute on function public.nw_app_release_alert() from public, anon, authenticated;
