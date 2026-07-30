/**
 * Operations dashboard — BSE StAR MF only.
 *
 * Every figure comes from the BSE proxy. There is deliberately no AUM or
 * brokerage tile: BSE reports neither to our member tier, and the previous
 * version filled that gap from CRM tables, which made non-BSE numbers look like
 * BSE ones.
 */
import { CalendarClock, Hash, ListChecks, PieChart, ShoppingCart, Wallet } from 'lucide-react';
import { fmt, fmtDate } from '../../../crm/utils';
import { Card } from '../../../portal/components/Card';
import { KpiStat } from '../../../portal/components/KpiStat';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { DonutChart } from '../../../portal/components/DonutChart';
import { StatusPill } from '../../../portal/components/StatusPill';
import { EmptyState } from '../../../portal/components/EmptyState';
import { EnvBadge, useBseEnv } from '../bse/EnvBadge';
import type { AdminDashboardData } from '../../types';

export function AdminDashboardPage({ data }: { data: AdminDashboardData }) {
  const env = useBseEnv();

  return (
    <div className="space-y-6">
      {/* Primary KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card padding="md" accent>
          <KpiStat
            label="Clients at BSE"
            value={String(data.uccTotal)}
            color="var(--accent)"
            sub={`${data.uccActive} able to transact`}
          />
        </Card>
        <Card padding="md">
          <KpiStat label="Orders placed" value={String(data.totalOrders)} sub={fmt(data.tradedValue)} />
        </Card>
        <Card padding="md">
          <KpiStat label="Live SIPs" value={String(data.liveSips)} sub={`${data.sxpTotal} registered`} />
        </Card>
        <Card padding="md">
          <KpiStat
            label="Pending Orders"
            value={String(data.pendingOrders)}
            color={data.pendingOrders > 0 ? 'var(--warning)' : 'var(--text-primary)'}
          />
        </Card>
      </div>

      {/* Secondary KPIs */}
      <Card padding="lg">
        <div className="flex items-start justify-between gap-4">
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <KpiStat label="Orders Today" value={String(data.todaysOrders)} />
            <KpiStat
              label="Settled Book"
              value={fmt(data.bookValue)}
              sub={data.bookValue === 0 ? 'nothing allotted yet' : `${fmt(data.invested)} invested`}
            />
            <KpiStat label="Schemes Traded" value={String(data.schemeSplit.length)} />
            <KpiStat
              label="Transaction-ready"
              value={data.uccTotal > 0 ? `${Math.round((data.uccActive / data.uccTotal) * 100)}%` : '—'}
              sub="of clients"
            />
          </div>
          <EnvBadge env={env} />
        </div>
      </Card>

      {/* Traded value by scheme + recent orders */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader title="Traded value by scheme" icon={PieChart} />
          {data.schemeSplit.length === 0 ? (
            <EmptyState icon={PieChart} title="No orders placed at BSE yet." compact />
          ) : (
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
              <DonutChart
                segments={data.schemeSplit.map((s) => ({
                  label: s.label,
                  value: s.value,
                  color: s.color,
                }))}
                centerLabel={fmt(data.tradedValue)}
                centerSub="traded"
              />
              <ul className="w-full flex-1 space-y-2.5">
                {data.schemeSplit.slice(0, 6).map((s) => (
                  <li key={s.key} className="flex items-center gap-3">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                    <span className="flex-1 truncate text-xs font-medium text-text-primary" title={s.label}>
                      {s.label}
                    </span>
                    <span className="text-xs font-semibold text-text-primary">{fmt(s.value)}</span>
                    <span className="w-12 text-right text-xs text-text-secondary">
                      {s.percent.toFixed(1)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader title="Recent orders" icon={ListChecks} />
          {data.recentOrders.length === 0 ? (
            <EmptyState icon={ListChecks} title="No orders yet." compact />
          ) : (
            <ul className="divide-y divide-border/60">
              {data.recentOrders.map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-token-md bg-bg-base">
                    {o.type === 'buy' ? (
                      <ShoppingCart className="h-3.5 w-3.5 text-accent" />
                    ) : (
                      <Wallet className="h-3.5 w-3.5 text-text-secondary" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text-primary">
                      {o.clientName}
                    </span>
                    <span className="block truncate text-[11px] text-text-faint" title={o.scheme}>
                      {o.scheme}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xs font-semibold text-text-primary">
                      {fmt(o.amount)}
                    </span>
                    <span className="block text-[10px] text-text-faint">
                      {o.date ? fmtDate(o.date) : ''}
                    </span>
                  </span>
                  <StatusPill tone={o.status === 'pending' ? 'warning' : 'success'}>
                    {o.status}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* What BSE does not give us — stated, not silently filled from elsewhere. */}
      <p className="text-center text-[11px] text-text-faint">
        <Hash className="mr-1 inline h-3 w-3 align-[-2px]" />
        BSE reports no AUM or brokerage to this member code, so those are not shown here.
        <CalendarClock className="ml-3 mr-1 inline h-3 w-3 align-[-2px]" />
        Settled book stays zero until orders are allotted.
      </p>
    </div>
  );
}
