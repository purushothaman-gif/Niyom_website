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
  /** PAN-exempt holders have no PAN to verify — never show them as "pending". */
  isPanExempt: boolean;
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
  /** BSE-hosted approval page. The order does not progress until the investor completes it. */
  twoFaUrl?: string | null;
  isMock: boolean;
}

export interface PaymentLinkResult {
  paymentUrl: string;
  modes: { mode: string; label: string; banks: number }[];
  noBankOnFile: boolean;
  isMock: boolean;
}

/**
 * A netted position. BSE gives us no holdings API (get_mis_detail is not
 * entitled to our member tier), so the proxy derives these from allotted
 * orders — meaning a position only appears once an order has SETTLED.
 */
export interface BseHoldingRow {
  clientCode: string;
  folio: string;
  schemeCode: string;
  schemeName: string;
  units: number;
  invested: number;
  lastNav: number;
  lastDate: string;
  value: number;
  isMock: boolean;
}

/** What the proxy's toAddUcc mapper needs to register a client at BSE. */
/** One verification step BSE runs on a UCC. */
export interface UccCheck {
  key: string;
  label: string;
  /** Whether failing this prevents the UCC going ACTIVE. */
  blocking: boolean;
  state: 'pass' | 'fail' | 'pending';
  reason: string;
  at: string;
}

export interface UccDetail {
  clientCode: string;
  status: string;
  pan: string;
  mode: string;
  transactionReady: boolean;
  transactionReadyReason: string;
  checks: UccCheck[];
  /** Labels of the blocking checks not yet passed — empty means good to go. */
  blockedBy: string[];
  isMock: boolean;
}

/** A scan sent to BSE inline as base64 — capped at 3 MB by the proxy. */
export interface UccDocumentInput {
  docNumber: string;
  fileName: string;
  fileSize: number;
  fileBlob: string;
}

/**
 * A nominee. BSE takes at most 3, their percentages must total exactly 100,
 * and `relation` is a code from BSE's nomination_relation enum, not a label.
 */
export interface NomineeInput {
  firstName: string;
  middleName?: string;
  lastName?: string;
  dob?: string;
  relation: string;
  percent: number;
  identifierType: 'pan' | 'aadhaar' | 'passport';
  identifierNumber: string;
  isMinor?: boolean;
  guardian?: { firstName: string; middleName?: string; lastName?: string; dob: string; pan: string };
}

export interface RegisterUccInput {
  clientCode: string;
  pan: string;
  firstName: string;
  middleName?: string;
  lastName?: string;
  dob: string;
  gender: 'M' | 'F' | 'O';
  email: string;
  mobile: string;
  address: { line1: string; city: string; state: string; pincode: string };
  bank: { accountNumber: string; ifsc: string; accountType?: string };
  fatca?: { fatherName?: string; spouseName?: string };
  /** Empty means the client has declined to nominate — a recorded opt-out. */
  nominees?: NomineeInput[];
  documents?: {
    bankProof?: UccDocumentInput;
    bankProofType?: 'cancel_cheque' | 'bank_statement';
    aof?: UccDocumentInput;
  };
}

/** BSE's nomination_relation codes (§7.4.18) — the value sent is the code. */
export const NOMINEE_RELATIONS: { code: string; label: string }[] = [
  { code: '1', label: 'Aunt' },
  { code: '2', label: 'Brother' },
  { code: '3', label: 'Daughter' },
  { code: '4', label: 'Daughter in law' },
  { code: '5', label: 'Father' },
  { code: '6', label: 'Father in law' },
  { code: '7', label: 'Grand daughter' },
  { code: '8', label: 'Grand son' },
  { code: '9', label: 'Grand father' },
  { code: '10', label: 'Grand mother' },
  { code: '11', label: 'Husband' },
  { code: '12', label: 'Mother' },
  { code: '13', label: 'Mother in law' },
  { code: '14', label: 'Nephew' },
  { code: '15', label: 'Niece' },
  { code: '16', label: 'Friend' },
  { code: '17', label: 'Sister' },
  { code: '18', label: 'Son' },
  { code: '19', label: 'Son in law' },
  { code: '20', label: 'Uncle' },
  { code: '21', label: 'Wife' },
  { code: '22', label: 'Others' },
];

export type RedeemMode = 'amount' | 'units' | 'all';

export interface RedeemInput {
  clientCode: string;
  schemeCode: string;
  schemeName: string;
  folio: string;
  mode: RedeemMode;
  amount: number;
  units: number;
}

export interface SwitchInput {
  clientCode: string;
  fromSchemeCode: string;
  fromSchemeName: string;
  toSchemeCode: string;
  toSchemeName: string;
  folio: string;
  mode: RedeemMode;
  amount: number;
  units: number;
}

export interface TxnResultRow {
  orderId: string;
  kind: string;
  schemeName: string;
  detail: string;
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

/**
 * Where the NIYOM BSE proxy lives.
 *
 * Defaults to the production droplet because that host is the ONLY BSE proxy we
 * run, it is not a secret (this value ships inside the client bundle either
 * way), and requiring a build-time env var meant the deployed console showed
 * "not connected" until someone remembered to set it in Vercel.
 *
 * Override with VITE_BSE_PROXY_URL to point at a different proxy; set it to
 * "none" to deliberately run the console with BSE panels disabled.
 */
const DEFAULT_PROXY_URL = 'https://api.niyomwealth.com';

function proxyBaseUrl(): string | null {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const configured = env.VITE_BSE_PROXY_URL?.trim();
  if (configured?.toLowerCase() === 'none') return null;
  return (configured || DEFAULT_PROXY_URL).replace(/\/$/, '');
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

/**
 * Which BSE environment the proxy is actually pointed at.
 *
 * Read from the proxy rather than hardcoded, so the console can never claim to
 * be live while talking to the sandbox — or keep saying "Demo" after we cut
 * over to production. `/health` is public (it sits before the auth gate), so
 * this works before any BSE call is made.
 */
export type BseEnv = 'demo' | 'prod' | 'unknown';

let envCache: { at: number; env: BseEnv } | null = null;

export async function bseEnvironment(): Promise<BseEnv> {
  if (envCache && Date.now() - envCache.at < 5 * 60 * 1000) return envCache.env;
  const baseUrl = proxyBaseUrl();
  if (!baseUrl) return 'unknown';
  try {
    const res = await fetch(`${baseUrl}/health`);
    if (!res.ok) return 'unknown';
    const body = (await res.json()) as { env?: string };
    const env: BseEnv = body.env === 'prod' ? 'prod' : body.env === 'demo' ? 'demo' : 'unknown';
    envCache = { at: Date.now(), env };
    return env;
  } catch {
    return 'unknown';
  }
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
   * Netted positions, derived by the proxy from allotted orders. Empty until an
   * order actually settles — redemption and switch both need a real folio.
   */
  holdings: (clientCode?: string) =>
    get<BseHoldingRow[]>(
      `/holdings${clientCode ? `?clientCode=${encodeURIComponent(clientCode)}` : ''}`,
    ),

  /**
   * Register a client at BSE as a physical, resident-individual UCC.
   * Returns the assigned client code and its initial status (PENDING_AUTH —
   * the investor must then complete a 2FA link before verification starts).
   */
  registerUcc: (input: RegisterUccInput) =>
    post<{ clientCode: string; status: string; isMock: boolean }>('/ucc', input),

  /** One UCC with its full verification breakdown (what's blocking activation). */
  uccDetail: (clientCode: string) =>
    get<UccDetail>(`/ucc/${encodeURIComponent(clientCode)}`),

  /** Investor 2FA approval link(s) for a UCC — needed to progress onboarding. */
  uccTwoFaLink: (clientCode: string, event = 'ucc_auth') =>
    post<{ clientCode: string; links: { event: string; pan: string; url: string }[] }>(
      '/ucc/2fa-link',
      { clientCode, event },
    ),

  /** Redeem units or rupees from a folio. */
  redeem: (input: RedeemInput) =>
    post<TxnResultRow>('/redemption', {
      clientId: input.clientCode,
      clientCode: input.clientCode,
      schemeCode: input.schemeCode,
      schemeName: input.schemeName,
      folioNumber: input.folio,
      mode: input.mode,
      amount: input.amount,
      units: input.units,
    }),

  /** Switch between two schemes of the SAME AMC (BSE rejects cross-AMC). */
  switch: (input: SwitchInput) =>
    post<TxnResultRow>('/switch', {
      clientId: input.clientCode,
      clientCode: input.clientCode,
      fromSchemeCode: input.fromSchemeCode,
      fromSchemeName: input.fromSchemeName,
      toSchemeCode: input.toSchemeCode,
      toSchemeName: input.toSchemeName,
      folioNumber: input.folio,
      mode: input.mode,
      amount: input.amount,
      units: input.units,
    }),

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

  /**
   * BSE's hosted payment page for placed orders. Only available once the
   * investor has approved them — BSE returns record_not_found before that.
   */
  paymentLink: (clientCode: string, orderIds: (string | number)[]) =>
    post<PaymentLinkResult>('/payment/link', {
      clientCode,
      orderIds,
      returnUrl: `${window.location.origin}/mf-admin`,
    }),
};

/* ------------------------------ Ops surfaces ------------------------------- */

/** One callback BSE sent us — the audit trail of what BSE reported. */
export interface BseEventRow {
  received_at: string;
  event_type: string | null;
  event: string | null;
  client_code: string | null;
  order_id: string | null;
  sxp_reg_num: string | null;
  mandate_id: string | null;
  msgcode: number | null;
  request_id: string | null;
}

export interface BseDiagnostics {
  environment: string;
  bseBaseUrl: string;
  memberCode: string;
  credentialsConfigured: boolean;
  /** Our outbound IP — the one BSE whitelists. */
  egressIp: string;
  bseReachable: boolean;
  bseError: string;
  webhookUrl: string;
  webhookPersistence: boolean;
  requireAuth: boolean;
  allowedOrigins: string[];
  serverTime: string;
}

export interface PanVerifyResult {
  valid: boolean;
  /** The name the PAN is registered under — what BSE's KYC check compares to. */
  registered_name: string | null;
  message: string | null;
}

export const BseOpsExtra = {
  /**
   * Verify a PAN and get the name it is registered under. Worth doing before
   * registering a UCC: BSE's KYC check compares the holder name against this
   * exact value, so a mismatch is the difference between ACTIVE and stuck.
   */
  verifyPan: (pan: string, name?: string) =>
    post<PanVerifyResult>('/pan/verify', name ? { pan, name } : { pan }),

  events: (limit = 200) => get<BseEventRow[]>(`/webhooks/events?limit=${limit}`),
  diagnostics: () => get<BseDiagnostics>('/diagnostics'),
};
