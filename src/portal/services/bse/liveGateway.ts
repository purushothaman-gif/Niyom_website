/**
 * liveGateway — real BSE StAR MF via the NIYOM proxy
 * -----------------------------------------------------------------------------
 * Implements the same `BseGateway` as the mock, but by calling NIYOM's
 * server-side proxy (which holds BSE member creds, runs `getPassword`, builds
 * SOAP, and is IP-whitelisted). The browser sends only view models — never BSE
 * credentials or session tokens.
 *
 * The proxy implementation lives in server/bse-proxy (deployed on the
 * DigitalOcean droplet whose static IP BSE whitelists). `createLiveGateway`
 * refuses to run until VITE_BSE_MODE=live + VITE_BSE_PROXY_URL are configured —
 * "not wired yet" stays a loud, safe failure rather than a silent wrong call.
 *
 * Every request carries the caller's Supabase session JWT; the proxy verifies
 * it before touching BSE, so only signed-in NIYOM users can transact.
 */
import { clientSupabase as supabase } from '../../../lib/supabase';
import type {
  FundScheme,
  OrderRequest,
  OrderResult,
  RedemptionRequest,
  SwitchRequest,
  TxnResult,
} from '../../types/funds';
import {
  BSE_PROXY_ROUTES,
  type SystematicPlan,
  type BseGateway,
  type MandateRegistrationRequest,
  type MandateRegistrationResult,
  type PaymentLinkRequest,
  type PaymentLinkResult,
  type PaymentStatusResult,
  type UccRegistrationRequest,
  type UccRegistrationResult,
} from './contract';

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function proxyPost<T>(baseUrl: string, route: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`BSE proxy ${route} failed (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

async function proxyGet<T>(baseUrl: string, route: string): Promise<T> {
  const res = await fetch(`${baseUrl}${route}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`BSE proxy ${route} failed (${res.status})`);
  return (await res.json()) as T;
}

/**
 * Build the live gateway. Throws if the proxy isn't configured, so we never
 * pretend to reach BSE. `baseUrl` comes from BseProxyConfig (env).
 */
export function createLiveGateway(baseUrl: string | null): BseGateway {
  if (!baseUrl) {
    throw new Error(
      'BSE live mode requested but VITE_BSE_PROXY_URL is not set. The server-side ' +
        'BSE proxy must be configured before live mode can run (see dossier §5/§7).',
    );
  }

  return {
    getSchemes: () => proxyGet<FundScheme[]>(baseUrl, BSE_PROXY_ROUTES.schemes),
    searchSchemes: (query: string, limit = 100) =>
      proxyGet<FundScheme[]>(
        baseUrl,
        `${BSE_PROXY_ROUTES.schemes}?q=${encodeURIComponent(query)}&limit=${limit}`,
      ),
    // No client code in the request: the proxy resolves the caller's own UCC
    // from their session and ignores anything the browser might send.
    getSystematicPlans: () => proxyGet<SystematicPlan[]>(baseUrl, BSE_PROXY_ROUTES.sxp),
    getScheme: async (schemeCode) =>
      proxyGet<FundScheme | null>(baseUrl, `${BSE_PROXY_ROUTES.schemes}/${schemeCode}`),
    placeOrder: (req: OrderRequest) =>
      proxyPost<OrderResult>(baseUrl, BSE_PROXY_ROUTES.order, req),
    placeRedemption: (req: RedemptionRequest) =>
      proxyPost<TxnResult>(baseUrl, BSE_PROXY_ROUTES.redemption, req),
    placeSwitch: (req: SwitchRequest) =>
      proxyPost<TxnResult>(baseUrl, BSE_PROXY_ROUTES.switch, req),
    cancelOrder: (orderId: string) =>
      proxyPost<TxnResult>(baseUrl, BSE_PROXY_ROUTES.cancel, { orderId }),
    registerUcc: (req: UccRegistrationRequest) =>
      proxyPost<UccRegistrationResult>(baseUrl, BSE_PROXY_ROUTES.ucc, req),
    registerMandate: (req: MandateRegistrationRequest) =>
      proxyPost<MandateRegistrationResult>(baseUrl, BSE_PROXY_ROUTES.mandate, req),
    getPaymentLink: (req: PaymentLinkRequest) =>
      proxyPost<PaymentLinkResult>(baseUrl, BSE_PROXY_ROUTES.paymentLink, req),
    getPaymentStatus: (orderId: string) =>
      proxyPost<PaymentStatusResult>(baseUrl, BSE_PROXY_ROUTES.paymentStatus, { orderId }),
  };
}
