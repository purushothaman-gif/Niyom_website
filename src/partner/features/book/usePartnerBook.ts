import { useEffect, useMemo, useState } from 'react';
import { PartnerService } from '../../services/PartnerService';
import type { PartnerClientRow } from '../../types';
import { mfSsoEnabled } from '../../../../shared/platform/env';
import { fromPartnerHoldings, type InvestmentRow } from '../../../../shared/portal/investments/model';
import { useInvestmentRows } from '../../../portal/features/investments/useInvestmentRows';

/**
 * Every sourced client's holdings, flattened into one book for the partner
 * dashboard. Goes through the same ownership-checked RPC as the drill-down
 * (nw_partner_client_portfolio / _mf), a few clients at a time.
 */
export function usePartnerBook(clients: PartnerClientRow[]) {
  const [base, setBase] = useState<InvestmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const ids = useMemo(() => clients.filter((c) => Number(c.holdings_count) > 0 || Number(c.current_value) > 0), [clients]);
  const key = ids.map((c) => c.client_id).join(',');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const out: InvestmentRow[] = [];
      const queue = [...ids];
      const worker = async () => {
        while (queue.length) {
          const c = queue.shift()!;
          try {
            const h = await PartnerService.getClientPortfolio(c.client_id);
            out.push(
              ...fromPartnerHoldings(h, {
                registrarMf: mfSsoEnabled(),
                clientName: c.full_name,
                clientId: c.client_id,
              }),
            );
          } catch {
            /* one client failing shouldn't blank the book */
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(5, queue.length) }, worker));
      if (!cancelled) {
        setBase(out.sort((a, b) => b.value - a.value));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const { rows, enriching } = useInvestmentRows('partner', base);
  return { rows, loading, enriching };
}
