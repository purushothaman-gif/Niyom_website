/**
 * "Through Niyom" vs "All distributors" for a client's mutual funds.
 *
 * HoldingService already returns the COMPLETE book: funds we service (registrar
 * feed, or the CAS rows attributed to our ARN) plus the client's held-away funds
 * from their imported CAS, each priced at the latest NAV. So "All" is that book
 * as-is, and "Through Niyom" is the same book minus the held-away funds — both
 * views are built from the same rows and the same prices, so a fund we service
 * shows identical figures in either.
 *
 * Held away = a CAS row whose statement does not attribute it to our ARN
 * (`is_ours` false — another distributor's ARN, or none stated). The same rule
 * HoldingService uses to fold held-away funds in, so the two never disagree.
 */
export type MfScope = 'niyom' | 'all';

export interface ScopeableHolding {
  product_type: string;
  cas?: { isOurs?: boolean | null } | null;
}

export function isHeldAwayMf(h: ScopeableHolding): boolean {
  return h.product_type === 'mutual_fund' && h.cas != null && !h.cas.isOurs;
}

export function applyMfScope<T extends ScopeableHolding>(holdings: T[], scope: MfScope): T[] {
  return scope === 'all' ? holdings : holdings.filter((h) => !isHeldAwayMf(h));
}
