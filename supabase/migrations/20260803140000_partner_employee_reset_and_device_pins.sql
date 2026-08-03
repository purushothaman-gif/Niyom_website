-- Self-serve reset (Partner) + device-PIN quick-login (Partner + Employee).
-- Applied to the hosted DB via the migration API on 2026-08-03 (local/remote
-- migration history has diverged, so `db push` is not used).
--
-- All three tables: RLS on, NO policies → only the service role (edge functions)
-- may read/write, exactly like nw_client_device_pins / nw_client_password_reset_otps.

-- Partner (DSA) self-serve reset OTP store — mirrors nw_client_password_reset_otps.
create table if not exists nw_dsa_password_reset_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  dsa_id uuid references nw_dsa(id) on delete cascade,
  otp_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_nw_dsa_pw_reset_otps_dsa on nw_dsa_password_reset_otps (dsa_id);
create index if not exists idx_nw_dsa_pw_reset_otps_created on nw_dsa_password_reset_otps (created_at);
alter table nw_dsa_password_reset_otps enable row level security;

-- Partner (DSA) device PIN store — mirrors nw_client_device_pins.
create table if not exists nw_dsa_device_pins (
  id uuid primary key default gen_random_uuid(),
  dsa_id uuid not null references nw_dsa(id) on delete cascade,
  device_id text not null,
  device_label text,
  pin_hash text not null,
  pin_salt text not null,
  pin_iterations integer not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dsa_id, device_id)
);
create index if not exists idx_nw_dsa_device_pins_device on nw_dsa_device_pins (device_id);
alter table nw_dsa_device_pins enable row level security;

-- Employee (CRM) device PIN store — mirrors nw_client_device_pins. Only regular
-- employees are ever offered a PIN (admins/super_admins keep password + 2FA);
-- both the set and login edge functions enforce role = 'employee'.
create table if not exists nw_employee_device_pins (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references nw_employees(id) on delete cascade,
  device_id text not null,
  device_label text,
  pin_hash text not null,
  pin_salt text not null,
  pin_iterations integer not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, device_id)
);
create index if not exists idx_nw_employee_device_pins_device on nw_employee_device_pins (device_id);
alter table nw_employee_device_pins enable row level security;
