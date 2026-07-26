-- Per-IP throttle log for the anonymous public PAN-verify endpoint
-- (public-onboard-pan-verify). Each row is one verify attempt; the edge function
-- counts recent rows per IP before calling the paid Cashfree verify and sweeps
-- rows older than the window. Service-role only (RLS on, no policies) — the
-- endpoint uses the service client, and nothing anon/authenticated may read it.

create table if not exists public.nw_pan_verify_attempts (
  id         uuid primary key default gen_random_uuid(),
  ip         text not null,
  created_at timestamptz not null default now()
);

create index if not exists nw_pan_verify_attempts_ip_created_idx
  on public.nw_pan_verify_attempts (ip, created_at);

alter table public.nw_pan_verify_attempts enable row level security;
