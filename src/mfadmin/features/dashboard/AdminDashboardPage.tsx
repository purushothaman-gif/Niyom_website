/**
 * Operations Overview — the console's landing screen.
 *
 * Every figure comes from the BSE proxy. There is deliberately no AUM or
 * brokerage tile: BSE reports neither to our member tier, and an earlier
 * version filled that gap from CRM tables, which made non-BSE numbers look
 * like BSE ones. Where a figure genuinely is not available the tile says so,
 * rather than showing a zero that reads as fact.
 */
import { ArrowUpRight, CalendarClock, Clock, Hash, ListChecks, TrendingUp } from 'lucide-react';
import type { AdminDashboardData, AdminOrderRow } from '../../types';
import { Chip, PageHead, Panel, PanelHead, StatTile, statusTone } from '../../ui/Surface';
import { DataTable, type Column } from '../../ui/DataTable';
import { humanise, inr, inrCompact, num, shortDate } from '../../ui/format';
import type { AdminView } from '../../layout/adminNav';

export function AdminDashboardPage({
  data,
  onNavigate,
}: {
  data: AdminDashboardData;
  onNavigate?: (v: AdminView) => void;
}) {
  const orderCols: Column<AdminOrderRow>[] = [
    {
      key: 'client',
      header: 'Client',
      value: (r) => r.clientName || r.clientCode,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-text-primary">{r.clientName || r.clientCode}</p>
          <p className="truncate font-mono text-[10px] text-text-faint">{r.clientCode}</p>
        </div>
      ),
    },
    {
      key: 'scheme',
      header: 'Scheme',
      value: (r) => r.scheme,
      render: (r) => <span className="line-clamp-2 text-text-secondary">{r.scheme}</span>,
    },
    {
      key: 'type',
      header: 'Type',
      value: (r) => r.type,
      render: (r) => (
        <Chip tone={r.type === 'sell' ? 'warning' : 'info'}>
          {r.type === 'sell' ? 'Sell' : 'Buy'}
        </Chip>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      value: (r) => r.amount,
      render: (r) => <span className="font-semibold text-text-primary">{inr(r.amount)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      value: (r) => r.status,
      render: (r) => <Chip tone={statusTone(r.status)}>{humanise(r.status)}</Chip>,
    },
    {
      key: 'date',
      header: 'Placed',
      align: 'right',
      value: (r) => r.date,
      render: (r) => <span className="whitespace-nowrap text-text-faint">{shortDate(r.date)}</span>,
    },
  ];

  const topSchemes = [...data.schemeSplit].sort((a, b) => b.value - a.value).slice(0, 6);
  const splitTotal = topSchemes.reduce((s, b) => s + b.value, 0);

  return (
    <>
      <PageHead
        title="Operations Overview"
        subtitle="Live from BSE StAR MF — order book, UCC book and systematic plans."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Traded value"
          value={inrCompact(data.tradedValue)}
          sub={`${num(data.totalOrders)} orders placed`}
          icon={TrendingUp}
        />
        <StatTile
          label="Clients at BSE"
          value={num(data.uccTotal)}
          sub={`${num(data.uccActive)} able to transact`}
          icon={Hash}
        />
        <StatTile
          label="Live SIPs"
          value={num(data.liveSips)}
          sub={`of ${num(data.sxpTotal)} systematic plans`}
          icon={CalendarClock}
        />
        <StatTile
          label="Pending orders"
          value={num(data.pendingOrders)}
          tone={data.pendingOrders > 0 ? 'warning' : 'default'}
          sub={`${num(data.todaysOrders)} placed today`}
          icon={Clock}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <StatTile
          label="Assets under management"
          value="—"
          unavailable="BSE does not report AUM to our member tier. Settled book is shown alongside."
        />
        <StatTile
          label="Settled book"
          value={data.bookValue > 0 ? inrCompact(data.bookValue) : '₹0'}
          sub={
            data.bookValue > 0
              ? `Invested ${inrCompact(data.invested)}`
              : 'Nothing allotted yet — an order settles before a folio exists.'
          }
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-sm font-bold text-text-primary">Recent orders</h2>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('orders')}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
              >
                Full order book <ArrowUpRight className="h-3 w-3" />
              </button>
            )}
          </div>
          <DataTable
            rows={data.recentOrders}
            columns={orderCols}
            rowKey={(r) => r.id}
            searchable={false}
            empty={{
              title: 'No orders yet',
              hint: 'Orders placed through the console appear here as soon as BSE accepts them.',
            }}
          />
        </div>

        <Panel>
          <PanelHead
            title="Traded value by scheme"
            hint="Gross value of orders placed — not holdings."
            icon={ListChecks}
          />
          {topSchemes.length === 0 ? (
            <p className="py-10 text-center text-xs text-text-faint">Nothing traded yet.</p>
          ) : (
            <ul className="space-y-3.5">
              {topSchemes.map((b) => {
                const share = splitTotal > 0 ? (b.value / splitTotal) * 100 : 0;
                return (
                  <li key={b.key}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-[11px] text-text-secondary">
                        {b.label}
                      </span>
                      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-text-primary">
                        {inrCompact(b.value)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-bg-surface">
                      <div
                        className="h-full rounded-full bg-accent transition-all"
                        style={{ width: `${Math.max(share, 2)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
