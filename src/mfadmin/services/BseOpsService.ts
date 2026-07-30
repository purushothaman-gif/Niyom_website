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

/** Per-transaction-type limits BSE publishes for a scheme. */
export interface SchemeTxnRule {
  min: number;
  max: number;
  minAdditional: number;
  /** e.g. "14:30:00" — orders after this hit the next NAV. */
  cutoffTime: string;
}

export interface BseSchemeRow {
  schemeCode: string;
  name: string;
  amc: string;
  category: string;
  isin: string;
  minLumpsum: number;
  /** BSE rejects a physical UCC on a demat-only scheme, so the form gates on this. */
  allowsPhysical: boolean;
  allowsDemat: boolean;
  isOpen: boolean;
  purchase: SchemeTxnRule | null;
  redemption: SchemeTxnRule | null;
  isMock: boolean;
}

export interface PlaceOrderInput {
  clientCode: string;
  schemeCode: string;
  schemeName: string;
  amount: number;
}

export interface PlaceOrderResult {
  orderId: string;
  schemeCode: string;
  schemeName: string;
  amount: number;
  status: string;
  placedAt: string;
  expectedNavDate: string;
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

async function post<T>(route: string, body: unknown): Promise<T> {
  const baseUrl = proxyBaseUrl();
  if (!baseUrl) throw new Error('BSE proxy is not configured (VITE_BSE_PROXY_URL).');

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired — please sign in again.');

  const res = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { error?: string; details?: unknown };
      detail = parsed.error ?? text;
      // BSE's own validation messages are far more useful than a bare status.
      if (Array.isArray(parsed.details) && parsed.details.length) {
        const first = parsed.details[0] as { errcode?: string; field?: string; vals?: unknown[] };
        const bits = [first.field, first.errcode, (first.vals ?? []).join(', ')].filter(Boolean);
        if (bits.length) detail = `${detail} — ${bits.join(': ')}`;
      }
    } catch {
      /* non-JSON body — use it verbatim */
    }
    throw new Error(detail || `BSE request failed (${res.status})`);
  }
  return JSON.parse(text) as T;
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

  /** Scheme master, with the trading rules the order form gates on. */
  schemes: (limit = 500) => get<BseSchemeRow[]>(`/schemes?limit=${limit}`),

  /**
   * Place a real lumpsum purchase. The proxy fails loudly if BSE returns
   * success without an order id, so a resolved promise here means BSE really
   * accepted the order.
   */
  placeOrder: (input: PlaceOrderInput) =>
    post<PlaceOrderResult>('/order', {
      clientId: input.clientCode,
      clientCode: input.clientCode,
      schemeCode: input.schemeCode,
      schemeName: input.schemeName,
      type: 'lumpsum',
      plan: 'Growth',
      amount: input.amount,
    }),
};
