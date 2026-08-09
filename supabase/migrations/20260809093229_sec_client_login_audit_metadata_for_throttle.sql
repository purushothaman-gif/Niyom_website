-- Security fix (finding 5): client-pan-login had no rate limiting at all, so it
-- was an unthrottled PAN -> registered-email oracle. Give nw_client_login_audit
-- the same `metadata` shape nw_dsa_login_audit already has, so the client
-- endpoint can reuse the partner endpoint's IP-hash throttle verbatim.

ALTER TABLE public.nw_client_login_audit
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Supports the throttle's hot path: count failures for one ip_hash in a window.
CREATE INDEX IF NOT EXISTS nw_client_login_audit_throttle_idx
  ON public.nw_client_login_audit ((metadata->>'ip_hash'), created_at)
  WHERE action = 'login_failed';

COMMENT ON COLUMN public.nw_client_login_audit.metadata IS
  'Salted-SHA256 ip_hash and failure reason. Mirrors nw_dsa_login_audit.metadata.';
