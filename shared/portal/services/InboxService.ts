/**
 * InboxService — the client's side of email inbox import.
 *
 * Connect once (OAuth, handled on the droplet), then statements the registrars
 * email are pulled and imported on demand. The browser never sees the mailbox
 * token; it only opens the consent URL and later asks the proxy to sync.
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

export interface InboxStatus {
  connected: boolean;
  provider?: string;
  email?: string | null;
  lastSyncedAt?: string | null;
}

export interface SyncSummary {
  imported: number;
  holdings: number;
  duplicates: number;
  /** Mutual-fund statements imported through our own parser. */
  mfImported: number;
  /** MF statements we could not open automatically (e.g. a KFintech password). */
  mfManual: number;
  filesSeen: number;
  reconnectNeeded?: boolean;
}

export const InboxService = {
  async enabled(): Promise<boolean> {
    const base = proxyBaseUrl();
    if (!base) return false;
    const h = await headers();
    if (!h) return false;
    try {
      const res = await fetch(`${base}/cas/inbox/mode`, { headers: h });
      if (!res.ok) return false;
      return ((await res.json()) as { enabled?: boolean }).enabled === true;
    } catch {
      return false;
    }
  },

  async status(): Promise<InboxStatus> {
    const base = proxyBaseUrl();
    const h = base ? await headers() : null;
    if (!base || !h) return { connected: false };
    try {
      const res = await fetch(`${base}/cas/inbox/status`, { headers: h });
      if (!res.ok) return { connected: false };
      return (await res.json()) as InboxStatus;
    } catch {
      return { connected: false };
    }
  },

  /** Returns the provider consent URL for the caller to navigate to. */
  async connect(provider: string): Promise<{ ok: true; oauthUrl: string } | { ok: false; error: string }> {
    const base = proxyBaseUrl();
    if (!base) return { ok: false, error: 'Email import is not enabled here yet.' };
    const h = await headers();
    if (!h) return { ok: false, error: 'Your session has expired. Please sign in again.' };
    try {
      const res = await fetch(`${base}/cas/inbox/connect`, { method: 'POST', headers: h, body: JSON.stringify({ provider }) });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !body.oauthUrl) return { ok: false, error: (body.error as string) || 'We could not start the connection.' };
      return { ok: true, oauthUrl: String(body.oauthUrl) };
    } catch {
      return { ok: false, error: 'We could not reach the server. Please check your connection.' };
    }
  },

  async sync(): Promise<{ ok: true; summary: SyncSummary } | { ok: false; error: string }> {
    const base = proxyBaseUrl();
    if (!base) return { ok: false, error: 'Email import is not enabled here yet.' };
    const h = await headers();
    if (!h) return { ok: false, error: 'Your session has expired. Please sign in again.' };
    try {
      const res = await fetch(`${base}/cas/inbox/sync`, { method: 'POST', headers: h, body: '{}' });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { ok: false, error: (body.error as string) || 'We could not check your email.' };
      return { ok: true, summary: body as unknown as SyncSummary };
    } catch {
      return { ok: false, error: 'We could not reach the server. Please check your connection.' };
    }
  },

  async disconnect(): Promise<boolean> {
    const base = proxyBaseUrl();
    const h = base ? await headers() : null;
    if (!base || !h) return false;
    try {
      const res = await fetch(`${base}/cas/inbox/disconnect`, { method: 'POST', headers: h, body: '{}' });
      return res.ok;
    } catch {
      return false;
    }
  },
};
