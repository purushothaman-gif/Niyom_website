import {
  ArrowLeftRight,
  Coins,
  ListChecks,
  PieChart,
  Users,
  Wallet,
} from 'lucide-react';
import { fmt, fmtDate } from '../../../crm/utils';
import { Card } from '../../../portal/components/Card';
import { KpiStat } from '../../../portal/components/KpiStat';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { DonutChart } from '../../../portal/components/DonutChart';
import { StatusPill } from '../../../portal/components/StatusPill';
import { EmptyState } from '../../../portal/components/EmptyState';
import type { AdminDashboardData } from '../../types';

export function AdminDashboardPage({ data }: { data: AdminDashboardData }) {
  const gainUp = data.mfGainPercent >= 0;

  return (
    <div className="space-y-6">
      {/* Primary KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card padding="md" accent>
          <KpiStat label="MF AUM" value={fmt(data.mfAum)} color="var(--accent)" sub={`${fmt(data.mfInvested)} invested`} />
        </Card>
        <Card padding="md">
          <KpiStat label="Active MF Clients" value={String(data.activeClients)} sub={`${data.totalClients} total`} />
        </Card>
        <Card padding="md">
          <KpiStat label="Live SIPs" value={String(data.liveSips)} />
        </Card>
        <Card padding="md">
          <KpiStat label="Pending Orders" value={String(data.pendingOrders)} color={data.pendingOrders > 0 ? 'var(--warning)' : 'var(--text-primary)'} />
        </Card>
      </div>

      {/* Secondary KPIs */}
      <Card padding="lg">
        <div className="flex items-start justify-between gap-4">
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <KpiStat label="Overall Return" value={`${gainUp ? '+' : ''}${data.mfGainPercent.toFixed(2)}%`} color={gainUp ? 'var(--success)' : 'var(--danger)'} />
            <KpiStat label="Orders Today" value={String(data.todaysOrders)} />
            <KpiStat label="Trail Brokerage (MTD)" value={fmt(data.trailMtd)} color="var(--accent)" sub="estimated" />
            <KpiStat
              label="UCCs at BSE"
              value={data.isMockOps ? '—' : String(data.uccTotal)}
              sub={data.isMockOps ? undefined : `${data.uccActive} able to transact`}
            />
          </div>
          {data.isMockOps ? (
            <StatusPill tone="warning">Ops metrics sample</StatusPill>
          ) : (
            <StatusPill tone="success">Live from BSE</StatusPill>
          )}
        </div>
        {data.isMockOps && data.opsError && (
          <p className="mt-3 border-t border-border pt-3 text-[11px] text-text-faint">
            SIP, order and UCC figures are illustrative — BSE could not be reached: {data.opsError}
          </p>
        )}
      </Card>

      {/* AMC AUM + Recent orders */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionHeader title="AUM by AMC" icon={PieChart} />
          {data.amcSplit.length === 0 ? (
            <EmptyState icon={PieChart} title="No mutual fund AUM yet." compact />
          ) : (
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
              <DonutChart segments={data.amcSplit.map((a) => ({ label: a.label, value: a.value, color: a.color }))} centerLabel={fmt(data.mfAum)} centerSub="AUM" />
              <ul className="w-full flex-1 space-y-2.5">
                {data.amcSplit.slice(0, 6).map((a) => (
                  <li key={a.key} className="flex items-center gap-3">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: a.color }} />
                    <span className="flex-1 truncate text-xs font-medium text-text-primary">{a.label}</span>
                    <span className="text-xs font-semibold text-text-primary">{fmt(a.value)}</span>
                    <span className="w-12 text-right text-xs text-text-secondary">{a.percent.toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader title="Recent Orders" icon={ListChecks} />
          {data.recentOrders.length === 0 ? (
            <EmptyState icon={ListChecks} title="No recent orders." compact />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {data.recentOrders.map((o) => {
                const isBuy = o.type === 'buy';
                return (
                  <li key={o.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-token-md text-[10px] font-bold uppercase" style={{ color: isBuy ? 'var(--success)' : 'var(--danger)', background: isBuy ? 'rgba(var(--success-rgb),0.1)' : 'rgba(var(--danger-rgb),0.1)' }}>
                      {isBuy ? 'Buy' : 'Sell'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-text-primary">{o.scheme}</p>
                      <p className="truncate text-[11px] text-text-secondary">{o.clientName} · {o.clientCode} · {fmtDate(o.date)}</p>
                    </div>
                    <p className="shrink-0 text-xs font-bold text-text-primary">{fmt(o.amount)}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Top clients */}
      <Card>
        <SectionHeader title="Top Clients by AUM" icon={Users} />
        {data.topClients.length === 0 ? (
          <EmptyState icon={Wallet} title="No clients with mutual fund holdings yet." compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-border-subtle">
                  {['Client', 'Holdings', 'Invested', 'AUM', 'Return'].map((h, i) => (
                    <th key={h} className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-text-secondary ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.topClients.map((c) => {
                  const up = c.gainPercent >= 0;
                  return (
                    <tr key={c.clientId} className="border-b border-border-subtle last:border-0 hover:bg-hover">
                      <td className="px-3 py-3">
                        <p className="text-sm font-medium text-text-primary">{c.name}</p>
                        <p className="font-mono text-[11px] text-text-secondary">{c.code}</p>
                      </td>
                      <td className="px-3 py-3 text-right text-sm text-text-primary">{c.holdings}</td>
                      <td className="px-3 py-3 text-right text-sm text-text-primary">{fmt(c.invested)}</td>
                      <td className="px-3 py-3 text-right text-sm font-bold text-text-primary">{fmt(c.aum)}</td>
                      <td className="px-3 py-3 text-right text-sm font-semibold" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>
                        {up ? '+' : ''}{c.gainPercent.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="flex items-center gap-1.5 px-1 text-[11px] text-text-faint">
        <Coins className="h-3.5 w-3.5" /> AUM, clients and orders are live from your book.
        SIP count, pending orders and trail brokerage are indicative until the BSE StAR MF gateway is connected.
        <ArrowLeftRight className="hidden h-3 w-3" />
      </p>
    </div>
  );
}
