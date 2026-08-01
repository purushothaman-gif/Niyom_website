/**
 * CasRequestService — the tracked journey around an import.
 *
 * A "request" records that the client set out to import a statement. It does
 * NOT ask CAMS for anything; no distributor may. What it buys is everything
 * after: a live status instead of a dead end, the exact form values echoed back
 * from the server, and a link from the eventual import to the intent that
 * produced it.
 *
 * Reads go through the proxy rather than straight to Supabase — unlike
 * `CasImportService.listImports`, which reads a table the client owns under RLS.
 * The status of a request is decided server-side (an expired request is marked
 * expired when someone looks), so a direct table read would show a status the
 * server has not yet agreed to.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import type { ConsentType } from '../types/consent';

/** Mirrors cas_requests.status. */
export type CasRequestStatus =
  | 'draft'
  | 'awaiting_statement'
  | 'received'
  | 'imported'
  | 'failed'
  | 'cancelled'
  | 'expired';

/**
 * The values the client must enter on the registrar's form — and ONLY fields
 * that form actually has, in its own order and using its own labels.
 *
 * There is no date of birth here because CAMS does not ask for one. Showing a
 * value the page has no field for makes a client hunt for it and doubt the rest
 * of the instructions.
 */
export interface CasFormGuidance {
  url: string;
  statementType: string;
  period: string;
  fromDate: string;
  toDate: string;
  folioListing: string;
  email: string;
  /** Optional on the CAMS form; blank when we hold no PAN. */
  pan: string;
}

export interface CasRequest {
  requestId: string;
  status: CasRequestStatus;
  requestedEmail: string | null;
  statementFrom: string | null;
  statementTo: string | null;
  expectedBy: string | null;
  importId: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CasRequestCreated {
  requestId: string;
  status: CasRequestStatus;
  expectedBy: string;
  form: CasFormGuidance;
}

export type CasRequestResponse =
  | { ok: true; request: CasRequestCreated }
  | { ok: false; error: string };

function proxyBaseUrl(): string | null {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const configured = env.VITE_BSE_PROXY_URL?.trim();
  if (configured?.toLowerCase() === 'none') return null;
  return (configured || 'https://api.niyomwealth.com').replace(/\/$/, '');
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export const CasRequestService = {
  /**
   * Begin a tracked request.
   *
   * `email` is worth letting the client override even though we hold one: a CAS
   * is consolidated by EMAIL, not PAN, so folios registered under an older
   * address simply will not appear. Getting this wrong produces a statement that
   * looks complete and is not.
   */
  async start(args: {
    email: string;
    consents: ConsentType[];
  }): Promise<CasRequestResponse> {
    const baseUrl = proxyBaseUrl();
    if (!baseUrl) return { ok: false, error: 'Portfolio import is not enabled here yet.' };
    const headers = await authHeaders();
    if (!headers) return { ok: false, error: 'Your session has expired. Please sign in again.' };

    try {
      const res = await fetch(`${baseUrl}/cas/requests`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: args.email, consents: args.consents }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        return { ok: false, error: (body.error as string) || 'We could not start your import.' };
      }
      return { ok: true, request: body as unknown as CasRequestCreated };
    } catch {
      return { ok: false, error: 'We could not reach the server. Please check your connection.' };
    }
  },

  /** The most recent request, for the awaiting screen to poll. Null if none. */
  async latest(): Promise<CasRequest | null> {
    const baseUrl = proxyBaseUrl();
    if (!baseUrl) return null;
    const headers = await authHeaders();
    if (!headers) return null;
    try {
      const res = await fetch(`${baseUrl}/cas/requests/latest`, { headers });
      if (!res.ok) return null;
      return (await res.json()) as CasRequest | null;
    } catch {
      return null;
    }
  },

  /** Abandon an open request so a fresh one can be started. */
  async cancel(requestId: string): Promise<boolean> {
    const baseUrl = proxyBaseUrl();
    if (!baseUrl) return false;
    const headers = await authHeaders();
    if (!headers) return false;
    try {
      const res = await fetch(`${baseUrl}/cas/requests/${requestId}/cancel`, {
        method: 'POST',
        headers,
        body: '{}',
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};

/** Statuses where the client is still waiting for something to happen. */
export const isOpenRequest = (s: CasRequestStatus): boolean =>
  s === 'draft' || s === 'awaiting_statement' || s === 'received';
