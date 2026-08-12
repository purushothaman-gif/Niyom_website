/**
 * BSEService — the single BSE StAR MF boundary (facade)
 * =============================================================================
 * NO other module in the portal talks to BSE. Callers depend only on these
 * method signatures; the actual work is delegated to a swappable `BseGateway`:
 *
 *   - `mockGateway` (default) — illustrative scheme master + simulated orders.
 *   - `liveGateway` — the NIYOM server-side proxy → BSE (enabled via env).
 *
 * Switching mock → live is a config change (VITE_BSE_MODE=live), not a rewrite
 * of any caller. See `bse/contract.ts` for the full contract and why a proxy is
 * mandatory (session tokens, IP whitelist, SOAP, credentials).
 */
import type {
  FundScheme,
  OrderRequest,
  OrderResult,
  RedemptionRequest,
  SwitchRequest,
  TxnResult,
} from '../types/funds';
import { bseGateway, isBseMock } from './bse/gateway';

export const BSEService = {
  /** True while the app runs on the illustrative mock (no real BSE). */
  isMock: isBseMock,

  /** Full scheme master. */
  getSchemes(): Promise<FundScheme[]> {
    return bseGateway().getSchemes();
  },

  /** Schemes matching a name fragment (the master is far larger than one page). */
  searchSchemes(query: string, limit?: number): Promise<FundScheme[]> {
    return bseGateway().searchSchemes(query, limit);
  },

  /** A single scheme by BSE code. */
  getScheme(schemeCode: string): Promise<FundScheme | null> {
    return bseGateway().getScheme(schemeCode);
  },

  /** Place a lumpsum / SIP purchase order. */
  placeOrder(req: OrderRequest): Promise<OrderResult> {
    return bseGateway().placeOrder(req);
  },

  /** Redeem from an existing holding. */
  placeRedemption(req: RedemptionRequest): Promise<TxnResult> {
    return bseGateway().placeRedemption(req);
  },

  /** Switch between schemes. */
  placeSwitch(req: SwitchRequest): Promise<TxnResult> {
    return bseGateway().placeSwitch(req);
  },

  /** Cancel a pending order by BSE order id. */
  cancelOrder(orderId: string): Promise<TxnResult> {
    return bseGateway().cancelOrder(orderId);
  },
};
