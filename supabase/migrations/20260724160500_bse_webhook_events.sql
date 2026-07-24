-- BSE StAR MF 2.0 webhook events.
-- Written by the NIYOM BSE proxy (server/bse-proxy) using the service-role key,
-- which bypasses RLS. RLS is enabled with NO policies so anon/authenticated
-- clients get zero access — these are internal integration events.
create table if not exists public.bse_webhook_events (
  id             bigint generated always as identity primary key,
  received_at    timestamptz not null default now(),
  request_id     text,
  member_id      text,
  client_code    text,
  event_type     text,          -- UCC | ORDER | SXP | MANDATES | PAYMENT GATEWAY
  event          text,          -- e.g. match_pending, ACTIVE, initiated
  msgcode        integer,
  order_id       text,
  mem_ord_ref_id text,
  sxp_reg_num    text,
  mandate_id     text,
  event_at       text,          -- BSE's raw action.at string
  source_ip      text,
  payload        jsonb not null  -- full callback envelope for replay/debug
);

create index if not exists bse_webhook_events_client_idx
  on public.bse_webhook_events (client_code);
create index if not exists bse_webhook_events_type_event_idx
  on public.bse_webhook_events (event_type, event);
create index if not exists bse_webhook_events_received_idx
  on public.bse_webhook_events (received_at desc);

alter table public.bse_webhook_events enable row level security;
