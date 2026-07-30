/**
 * BseOpsService — the MF Admin console's window onto live BSE StAR MF.
 * -----------------------------------------------------------------------------
 * Calls the NIYOM BSE proxy (the whitelisted droplet), never BSE directly: BSE
 * only accepts requests from that static IP and the member credentials live
 * there, never in the browser. Every call carries the employee's Supabase
 * session JWT, which the proxy verifies before it will talk to BSE.
 *
 * Configure with VITE_BSE_PROXY_URL (same var the portal's liveGateway uses).
 * When it is unset the console shows real CRM data with BSE panels marked
 * unavailable, rather than inventing numbers.
 */
import { supabase } from '../../lib/supabase';

export interface BseOrderRow {
  orderId: string;
  memberRef: string;
  clientCode: string;
  clientName: string;
  schemeCode: string;
  schemeName: string;
  amount: number;
  type: string;
  status: string;
  side: string;
  folio: string;
  /** ISO timestamp from BSE's `placed_at`. */
  placedAt: string;
  rejectionReason: string;
  isMock: boolean;
}

export interface BseUccRow {
  clientCode: string;
  name: string;
  pan: string;
  status: string;
  holdingNature: string;
  isPanVerified: boolean;
  isMock: boolean;
}

export interface BseSxpRow {
  sxpRegNum: string;
  clientCode: string;
  type: string;
  schemeCode: string;
  amount: number;
  frequency: string;
  startDate: string;
  status: string;
  isMock: boolean;
}

function proxyBaseUrl(): string | null {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_BSE_PROXY_URL?.replace(/\/$/, '') || null;
}

/** True when the console can reach BSE at all — drives the "not wired" notices. */
export function isBseConfigured(): boolean {
  return proxyBaseUrl() !== null;
}

async function get<T>(route: string): Promise<T> {
  const baseUrl = proxyBaseUrl();
  if (!baseUrl) throw new Error('BSE proxy is not configured (VITE_BSE_PROXY_URL).');

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired — please sign in again.');

  const res = await fetch(`${baseUrl}${route}`, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try {
      detail = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* non-JSON body — use it verbatim */
    }
    throw new Error(detail || `BSE request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const BseOpsService = {
  /** Order book across all clients (open + closed), newest first. */
  orders: (clientCode?: string) =>
    get<BseOrderRow[]>(`/orders${clientCode ? `?clientCode=${encodeURIComponent(clientCode)}` : ''}`),

  /** Every UCC registered under the NIYOM member code, with verification state. */
  uccs: () => get<BseUccRow[]>('/uccs'),

  /** Systematic plans — SIP / SWP / STP. */
  sxp: (clientCode?: string) =>
    get<BseSxpRow[]>(`/sxp${clientCode ? `?clientCode=${encodeURIComponent(clientCode)}` : ''}`),
};
