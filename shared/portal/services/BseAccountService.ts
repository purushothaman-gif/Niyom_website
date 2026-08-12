/**
 * BseAccountService — the client's own BSE investment account.
 *
 * Everything here is scoped by the PROXY, not by us: it resolves the signed-in
 * client from their token and answers only for their own UCC, ignoring anything
 * we send. So this service never passes a client code — there is nothing useful
 * it could pass, and nothing it sends could widen what comes back.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import { bseProxyBaseUrl } from '../../platform/env';

/** One verification step BSE runs before a client may transact. */
export interface AccountCheck {
  key: string;
  label: string;
  blocking: boolean;
  state: 'pass' | 'fail' | 'pending';
  reason: string;
}

export type AccountState =
  /** No UCC on file — BSE registration has not been started for them. */
  | { status: 'not_registered' }
  /** Registered, but BSE will not let them transact yet. */
  | { status: 'pending'; clientCode: string; uccStatus: string; blockedBy: string[]; checks: AccountCheck[] }
  /** Good to invest. */
  | { status: 'ready'; clientCode: string; uccStatus: string; checks: AccountCheck[] }
  /** We could not ask BSE — distinct from "not registered", which is a fact. */
  | { status: 'unavailable'; message: string };

/** The droplet's origin, resolved once in shared/platform/env.ts. */
const proxyBaseUrl = bseProxyBaseUrl;

export const BseAccountService = {
  /**
   * The client's BSE account state.
   *
   * The path segment is a placeholder: the proxy substitutes the caller's own
   * UCC. A 403 means no UCC is linked to them yet — which is "not registered",
   * not an error to show as a failure.
   */
  async getState(): Promise<AccountState> {
    const baseUrl = proxyBaseUrl();
    if (!baseUrl) return { status: 'unavailable', message: 'Investing is not enabled here yet.' };

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { status: 'unavailable', message: 'Please sign in again.' };

    try {
      const res = await fetch(`${baseUrl}/ucc/self`, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      if (res.status === 403) return { status: 'not_registered' };
      if (!res.ok) {
        return { status: 'unavailable', message: 'We could not reach the exchange just now.' };
      }
      const d = (await res.json()) as {
        clientCode: string;
        status: string;
        transactionReady: boolean;
        blockedBy: string[];
        checks: AccountCheck[];
      };
      return d.transactionReady
        ? { status: 'ready', clientCode: d.clientCode, uccStatus: d.status, checks: d.checks ?? [] }
        : {
            status: 'pending',
            clientCode: d.clientCode,
            uccStatus: d.status,
            blockedBy: d.blockedBy ?? [],
            checks: d.checks ?? [],
          };
    } catch {
      return { status: 'unavailable', message: 'We could not reach the exchange just now.' };
    }
  },

  /**
   * The BSE-hosted link the investor must approve to move onboarding forward.
   * Only meaningful while the account is pending.
   */
  async getApprovalLink(): Promise<string | null> {
    const baseUrl = proxyBaseUrl();
    if (!baseUrl) return null;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    try {
      const res = await fetch(`${baseUrl}/ucc/2fa-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ event: 'ucc_auth' }),
      });
      if (!res.ok) return null;
      const d = (await res.json()) as { links?: { url: string }[] };
      return d.links?.[0]?.url ?? null;
    } catch {
      return null;
    }
  },
};
