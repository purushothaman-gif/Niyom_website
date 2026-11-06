import { useMemo, useState } from 'react';
import type { PortalHolding } from '../../types/cas';
import { applyMfScope, isHeldAwayMf, type MfScope } from '../../../../shared/portal/investments/mfScope';

/**
 * Which mutual funds the portfolio shows. Defaults to ALL distributors — the
 * same complete book the dashboard shows. "Through Niyom" filters that book
 * down; it never re-reads or re-prices anything, so a fund we service has the
 * same figures in both views (see shared/portal/investments/mfScope.ts).
 */
export function useMfScope(holdings: PortalHolding[]) {
  const [scope, setScope] = useState<MfScope>('all');

  const heldAwayCount = useMemo(() => holdings.filter(isHeldAwayMf).length, [holdings]);
  const filtered = useMemo(() => applyMfScope(holdings, scope), [holdings, scope]);
  // The newest statement any held-away fund came from — its units are as of then.
  const casStatementTo = useMemo(
    () =>
      holdings
        .filter(isHeldAwayMf)
        .map((h) => h.cas?.statementTo ?? '')
        .filter(Boolean)
        .sort()
        .pop() ?? null,
    [holdings],
  );

  return { scope, setScope, holdings: filtered, heldAwayCount, casStatementTo };
}
