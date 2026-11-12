-- KFintech mailback feeds arrive as download LINKS, and KFintech's WAF blocks
-- every datacenter IP (Google Apps Script, the droplet, Supabase) with a
-- "Request Rejected" page. So the Gmail sync decodes the link but cannot fetch
-- it; it drops the link here, and a residential-IP agent (the user's Mac) drains
-- the queue, downloads the ZIP where the WAF allows it, and posts the bytes to
-- mf-rta-ingest on the normal path. CAMS (attachment-based) is unaffected.
create table if not exists public.mf_rta_pending_downloads (
  id uuid primary key default gen_random_uuid(),
  -- The Gmail message id; dedupes re-enqueues of the same feed email.
  message_id text unique not null,
  registrar text,
  report_hint text,
  subject text,
  -- The decoded dss.kfintech.com URL (preferred) and the raw /c/ tracker link.
  direct_url text not null,
  tracker_url text,
  status text not null default 'pending', -- pending | done
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  fetched_at timestamptz
);

create index if not exists mf_rta_pending_downloads_status_idx
  on public.mf_rta_pending_downloads (status, created_at);

comment on table public.mf_rta_pending_downloads is
  'Queue of KFintech mailback download links the Gmail sync decoded but cannot fetch (datacenter IPs are WAF-blocked); drained by a residential-IP Mac agent that posts the bytes to mf-rta-ingest.';

-- Only the service role (the edge function) touches this. RLS on with no policy
-- blocks anon and authenticated entirely; the service role bypasses RLS.
alter table public.mf_rta_pending_downloads enable row level security;
