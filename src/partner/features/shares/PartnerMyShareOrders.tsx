// Unlisted-share orders the partner has raised for their clients, newest first,
// with the RM's progress (Submitted → Deal sent → Accepted).

import { Gem } from 'lucide-react';
import { inr, dateTime, pct } from '../../../lib/money';
import type { PartnerShareOrder, PartnerBondOrderStatus } from '../../services/PartnerService';

const STATUS: Record<PartnerBondOrderStatus, { label: string; cls: string }> = {
  submitted: { label: 'Submitted', cls: 'border-accent/25 bg-accent/10 text-accent' },
  deal_sent: { label: 'Deal sent', cls: 'border-info/25 bg-info/10 text-info' },
  accepted: { label: 'Accepted', cls: 'border-success/25 bg-success/10 text-success' },
  cancelled: { label: 'Cancelled', cls: 'border-border bg-bg-surface text-text-muted' },
};

export function PartnerMyShareOrders({ orders, onExplore }: { orders: PartnerShareOrder[]; onExplore: () => void }) {
  if (orders.length === 0) {
    return (
      <div className="rounded-token-xl border border-border bg-bg-elevated py-16 text-center">
        <Gem className="mx-auto mb-3 h-8 w-8 text-text-faint" />
        <p className="text-base font-semibold text-text-primary">No orders yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
          Unlisted-share orders you place for your clients appear here, so you can track the RM's confirmation.
        </p>
        <button type="button" onClick={onExplore} className="mt-4 rounded-token-md bg-accent px-4 py-2 text-sm font-bold text-on-accent">
          Explore unlisted shares
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map((o) => {
        const s = STATUS[o.status] ?? STATUS.submitted;
        return (
          <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-bold text-text-primary">{o.company_name || o.isin}</p>
                <span className={`rounded-token-sm border px-1.5 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-text-faint">
                {o.ref} · {o.client?.full_name ?? '—'} · {o.qty} share{o.qty === 1 ? '' : 's'} @ {inr(o.price_per_share)}
                {o.partner_markup_percent != null ? ` · margin ${pct(o.partner_markup_percent)}` : ''} · {dateTime(o.created_at)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Indicative</p>
              <p className="font-display text-base font-bold tabular-nums text-text-primary">{inr(o.amount ?? 0)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
