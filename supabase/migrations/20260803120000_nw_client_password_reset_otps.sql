-- Isolated OTP store for the CLIENT (wealth-portal) password reset. Kept fully
-- separate from the staff table (nw_password_reset_otps) so the two flows can
-- never interfere. Service-role only (RLS on, no policies → anon/authenticated
-- are denied; edge functions using the service key bypass RLS).
--
-- Applied to the hosted DB via the migration API on 2026-08-03 (local/remote
-- migration history has diverged, so `db push` is not used — see repo notes).
create table if not exists nw_client_password_reset_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  client_id uuid references nw_clients(id) on delete cascade,
  otp_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_nw_client_pw_reset_otps_email
  on nw_client_password_reset_otps (email);
create index if not exists idx_nw_client_pw_reset_otps_created_at
  on nw_client_password_reset_otps (created_at);

alter table nw_client_password_reset_otps enable row level security;
-- No policies on purpose: only the service role (edge functions) may touch it.
