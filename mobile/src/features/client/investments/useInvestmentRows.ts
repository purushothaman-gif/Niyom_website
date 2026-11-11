/**
 * Base rows render immediately; mutual funds are then enriched in the
 * background (1-day NAV move, category, fund returns) and swapped in. A failed
 * enrichment simply leaves the base rows.
 *
 * The app's copy of the website's hook of the same name — the work itself is
 * `enrichMutualFunds` in `shared/`, so both run one implementation.
 */
import { useEffect, useState } from 'react';
import { getDb, type DbSurface } from '@shared/platform/db';
import { enrichMutualFunds } from '@shared/mf/fundEnrich';
import type { InvestmentRow } from '@shared/portal/investments/model';

export function useInvestmentRows(surface: DbSurface, base: InvestmentRow[]) {
  const [rows, setRows] = useState<InvestmentRow[]>(base);
  const [enriching, setEnriching] = useState(false);

  // Key on content, not identity, so a parent re-render doesn't refetch.
  const key = base.map((r) => `${r.id}:${r.value}`).join('|');

  useEffect(() => {
    let cancelled = false;
    setRows(base);
    if (!base.some((r) => r.asset === 'mutual_fund')) return;
    setEnriching(true);
    enrichMutualFunds(getDb(surface), base)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        /* keep the base rows */
      })
      .finally(() => {
        if (!cancelled) setEnriching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, key]);

  return { rows, enriching };
}
