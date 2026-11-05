import { useEffect, useMemo, useState } from 'react';
import type { PortalHolding } from '../../types/cas';
import { CasPortfolioService } from '../../../../shared/portal/services/CasPortfolioService';
import { isDemoClientSession } from '../../../../shared/portal/demo/demoClient';
import type { MfScope } from './portfolioStatementPdf';

/**
 * Which mutual funds the portfolio shows:
 *
 *   'niyom'  funds held through Niyom's ARN — the registrar feed (default)
 *   'all'    every fund with every distributor, from the client's uploaded
 *            CAS. Only offered once a CAS exists; it REPLACES the registrar
 *            rows (a fund bought through us appears in both, so adding them
 *            would count it twice).
 *
 * Non-MF holdings are the same in both.
 */
export function useMfScope(clientId: string, holdings: PortalHolding[]) {
  const [scope, setScope] = useState<MfScope>('niyom');
  const [cas, setCas] = useState<{ holdings: PortalHolding[]; statementTo: string | null } | null>(null);
  const [casChecked, setCasChecked] = useState(false);

  useEffect(() => {
    let alive = true;
    if (isDemoClientSession()) {
      setCasChecked(true);
      return;
    }
    CasPortfolioService.getPortfolio(clientId)
      .then((p) => {
        if (!alive) return;
        setCas(p && p.holdings.length ? { holdings: p.holdings, statementTo: p.statementTo } : null);
      })
      .catch(() => alive && setCas(null))
      .finally(() => alive && setCasChecked(true));
    return () => {
      alive = false;
    };
  }, [clientId]);

  const effective = useMemo(() => {
    if (scope !== 'all' || !cas) return holdings;
    return [...holdings.filter((h) => h.product_type !== 'mutual_fund'), ...cas.holdings];
  }, [scope, cas, holdings]);

  return {
    scope: cas ? scope : ('niyom' as MfScope),
    setScope,
    holdings: effective,
    casAvailable: !!cas,
    casChecked,
    casStatementTo: cas?.statementTo ?? null,
  };
}
