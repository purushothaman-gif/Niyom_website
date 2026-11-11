/**
 * DematImportService — the client's side of a CDSL eCAS OTP import.
 *
 * Two steps against the droplet, which holds the vendor key and does the fetch,
 * parse and store. The browser only carries an opaque session id between them
 * and never sees the PAN (it is read server-side from the client's record) or
 * the statement password.
 *
 *   start()  -> sends the OTP to the client's depository-registered mobile
 *   verify() -> the OTP, returns a stored summary of what was imported
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import { bseProxyBaseUrl } from '../../platform/env';

const proxyBaseUrl = bseProxyBaseUrl;

async function authHeaders(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export interface DematImportSummary {
  importId: string;
  status: 'parsed';
  statementDate: string | null;
  totalValue: number | null;
  accounts: number;
  holdings: number;
  byClass: Record<string, number>;
  duplicate?: boolean;
}

export type StartResult = { ok: true; sessionId: string } | { ok: false; error: string };
export type VerifyResult = { ok: true; summary: DematImportSummary } | { ok: false; error: string };

export const DematImportService = {
  /** Is demat import available at all (the server has a vendor key)? */
  async enabled(): Promise<boolean> {
    const baseUrl = proxyBaseUrl();
    if (!baseUrl) return false;
    const headers = await authHeaders();
    if (!headers) return false;
    try {
      const res = await fetch(`${baseUrl}/cas/demat/mode`, { headers });
      if (!res.ok) return false;
      const body = (await res.json()) as { enabled?: boolean };
      return body.enabled === true;
    } catch {
      return false;
    }
  },

  /** Step 1 — ask the depository to send the OTP. */
  async start(): Promise<StartResult> {
    const baseUrl = proxyBaseUrl();
    if (!baseUrl) return { ok: false, error: 'Demat import is not enabled here yet.' };
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: 'Your session has expired. Please sign in again.' };
    try {
      const res = await fetch(`${baseUrl}/cas/demat/fetch`, { method: 'POST', headers, body: '{}' });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { ok: false, error: (body.error as string) || 'We could not start the import.' };
      return { ok: true, sessionId: String(body.sessionId ?? '') };
    } catch {
      return { ok: false, error: 'We could not reach the server. Please check your connection.' };
    }
  },

  /** Step 2 — submit the OTP; the server parses and stores the statement. */
  async verify(sessionId: string, otp: string): Promise<VerifyResult> {
    const baseUrl = proxyBaseUrl();
    if (!baseUrl) return { ok: false, error: 'Demat import is not enabled here yet.' };
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: 'Your session has expired. Please sign in again.' };
    try {
      const res = await fetch(`${baseUrl}/cas/demat/verify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId, otp }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { ok: false, error: (body.error as string) || 'We could not read the statement.' };
      return { ok: true, summary: body as unknown as DematImportSummary };
    } catch {
      return { ok: false, error: 'We could not reach the server. Please check your connection.' };
    }
  },
};
