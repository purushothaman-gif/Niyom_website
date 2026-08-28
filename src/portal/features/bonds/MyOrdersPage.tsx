// The client's own bond orders, newest first, with a status pill that tracks the
// RM's progress (Submitted → Deal sent → Accepted). Reads nw_bond_orders through
// clientSupabase (RLS scopes it to the signed-in client).

import { Landmark } from 'lucide-react';
import { inr, dateTime } from '../../../lib/money';
import { Card } from '../../components/Card';
import { StatusPill } from '../../components/StatusPill';
import { Blank, PortalButton } from '../../ui/kit';
import type { BondOrder, BondOrderStatus } from '../../../../shared/portal/services/BondOrderService';

const STATUS: Record<BondOrderStatus, { label: string; tone: 'accent' | 'info' | 'success' | 'muted' }> = {
  submitted: { label: 'Submitted', tone: 'accent' },
  deal_sent: { label: 'Deal sent — action needed', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export function MyOrdersPage({
  orders,
  onExplore,
}: {
  orders: BondOrder[];
  onExplore: () => void;
}) {
  if (orders.length === 0) {
    return (
      <Card padding="none">
        <Blank
          icon={Landmark}
          title="No orders yet"
          body="When you place a bond order it appears here, and you can track your relationship manager’s confirmation."
          action={<PortalButton variant="primary" onClick={onExplore}>Explore bonds</PortalButton>}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map((o) => {
        const s = STATUS[o.status] ?? STATUS.submitted;
        return (
          <Card key={o.id} padding="md" className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-bold text-text-primary">{o.bond_name || o.isin}</p>
                <StatusPill tone={s.tone}>{s.label}</StatusPill>
              </div>
              <p className="mt-0.5 text-[11px] text-text-faint">
                {o.ref} · {o.units} unit{o.units === 1 ? '' : 's'} @ {inr(o.price_per_100)}/₹100 · {dateTime(o.created_at)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Indicative</p>
              <p className="font-display text-base font-bold tabular-nums text-text-primary">{inr(o.amount ?? 0)}</p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
