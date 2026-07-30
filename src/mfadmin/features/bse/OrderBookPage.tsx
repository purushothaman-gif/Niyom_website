/** Order Book — live orders from BSE StAR MF via the NIYOM proxy. */
import { ListChecks } from 'lucide-react';
import { fmt } from '../../../crm/utils';
import { StatusPill } from '../../../portal/components/StatusPill';
import { BseOpsService, type BseOrderRow } from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { BsePanel, TableScroll, TH, TD } from './BsePanel';

/** BSE order lifecycle -> pill tone. Terminal-good = success, rejects = danger. */
function tone(status: string): 'success' | 'warning' | 'danger' | 'muted' {
  const s = status.toLowerCase();
  if (s === 'done' || s.includes('settled') || s.includes('matched')) return 'success';
  if (s.includes('reject') || s.includes('failed') || s.includes('cancel')) return 'danger';
  if (s.includes('pending') || s === 'received' || s.includes('queued') || s.includes('sent'))
    return 'warning';
  return 'muted';
}

const ORDER_TYPE: Record<string, string> = { p: 'Purchase', r: 'Redemption', s: 'Switch' };

export function OrderBookPage() {
  const { data, loading, error, refresh } = useBseData<BseOrderRow[]>(() => BseOpsService.orders());
  const rows = data ?? [];

  return (
    <BsePanel
      title="Order Book"
      icon={ListChecks}
      loading={loading}
      error={error}
      isEmpty={rows.length === 0}
      emptyText="No orders placed at BSE yet."
      onRefresh={refresh}
    >
      <TableScroll>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <TH>Order ID</TH>
              <TH>UCC</TH>
              <TH>Scheme</TH>
              <TH>Type</TH>
              <TH right>Amount</TH>
              <TH>Folio</TH>
              <TH>Status</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.orderId} className="hover:bg-bg-base/50">
                <TD>
                  <span className="font-mono">{o.orderId}</span>
                </TD>
                <TD>{o.clientCode || '—'}</TD>
                <TD>{o.schemeCode || '—'}</TD>
                <TD>{ORDER_TYPE[o.type] ?? o.type ?? '—'}</TD>
                <TD right>{fmt(o.amount)}</TD>
                <TD>{o.folio || '—'}</TD>
                <TD>
                  <StatusPill tone={tone(o.status)}>{o.status || 'unknown'}</StatusPill>
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p className="mt-3 text-[11px] text-text-faint">
        {rows.length} order{rows.length === 1 ? '' : 's'} · live from BSE StAR MF
      </p>
    </BsePanel>
  );
}
