/**
 * InboundEmailService — the client's side of forward-to-address import.
 *
 * The client gets a dedicated address and forwards their CAS statement to it;
 * the droplet does the rest. No OAuth and no provider consent screen — the
 * lightest return-path.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import { bseProxyBaseUrl } from '../../platform/env';

const proxyBaseUrl = bseProxyBaseUrl;

async function headers(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export interface InboundStatus {
  address: string | null;
  lastReceivedAt?: string | null;
}

export interface InboundCheck {
  imported: number;
  holdings: number;
  mfFound: number;
  filesSeen: number;
}

export const InboundEmailService = {
  async enabled(): Promise<boolean> {
    const base = proxyBaseUrl();
    const h = base ? await headers() : null;
    if (!base || !h) return false;
    try {
      const res = await fetch(`${base}/cas/inbound/mode`, { headers: h });
      return res.ok && ((await res.json()) as { enabled?: boolean }).enabled === true;
    } catch {
      return false;
    }
  },

  async status(): Promise<InboundStatus> {
    const base = proxyBaseUrl();
    const h = base ? await headers() : null;
    if (!base || !h) return { address: null };
    try {
      const res = await fetch(`${base}/cas/inbound/status`, { headers: h });
      if (!res.ok) return { address: null };
      return (await res.json()) as InboundStatus;
    } catch {
      return { address: null };
    }
  },

  /** Create (or return) the forward-to address. */
  async ensure(): Promise<{ ok: true; address: string } | { ok: false; error: string }> {
    const base = proxyBaseUrl();
    if (!base) return { ok: false, error: 'Email import is not enabled here yet.' };
    const h = await headers();
    if (!h) return { ok: false, error: 'Your session has expired. Please sign in again.' };
    try {
      const res = await fetch(`${base}/cas/inbound/ensure`, { method: 'POST', headers: h, body: '{}' });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !body.address) return { ok: false, error: (body.error as string) || 'We could not set that up.' };
      return { ok: true, address: String(body.address) };
    } catch {
      return { ok: false, error: 'We could not reach the server. Please check your connection.' };
    }
  },

  async check(): Promise<{ ok: true; result: InboundCheck } | { ok: false; error: string }> {
    const base = proxyBaseUrl();
    if (!base) return { ok: false, error: 'Email import is not enabled here yet.' };
    const h = await headers();
    if (!h) return { ok: false, error: 'Your session has expired. Please sign in again.' };
    try {
      const res = await fetch(`${base}/cas/inbound/check`, { method: 'POST', headers: h, body: '{}' });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { ok: false, error: (body.error as string) || 'We could not check for statements.' };
      return { ok: true, result: body as unknown as InboundCheck };
    } catch {
      return { ok: false, error: 'We could not reach the server. Please check your connection.' };
    }
  },
};
