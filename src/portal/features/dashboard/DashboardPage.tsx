/**
 * Wealth Dashboard — the client's own money, and only that.
 *
 * Every figure here is derived from their real holdings and transactions. The
 * cards that used to sit alongside them — a simulated daily movement, goals
 * nobody had set, market indices we don't subscribe to, notices with no author
 * — are gone. On a screen where someone checks their savings, a plausible
 * invented number is worse than an absent one.
 */
import type { NWClient } from '../../../crm/types';
import type { DashboardData } from '../../types';
import type { PortalView } from '../../layout/navigation';
import { inr, inrCompact, pct } from '../../../lib/money';
import { Figure, MiniStat, Tile } from '../../ui/kit';
import { AllocationCard } from './sections/AllocationCard';
import { AccountSummaryCard } from './sections/AccountSummaryCard';
import { MutualFundSummaryCard } from './sections/MutualFundSummaryCard';
import { RecentTransactionsCard } from './sections/RecentTransactionsCard';
import { QuickActions } from './sections/QuickActions';
import { SupportCard } from './sections/SupportCard';
import { OnboardingChecklistCard } from '../onboarding/OnboardingChecklistCard';
import { ActivateProductsCard } from './sections/ActivateProductsCard';
import { onboardingIncomplete, canActivateMoreProducts } from '../onboarding/onboardingSteps';

interface DashboardPageProps {
  client: NWClient | null;
  data: DashboardData;
  refreshedAt: Date | null;
  onNavigate: (view: PortalView) => void;
  onActivateProducts: () => void;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardPage({
  client,
  data,
  refreshedAt,
  onNavigate,
  onActivateProducts,
}: DashboardPageProps) {
  const firstName = client?.full_name?.split(' ')[0] || 'Investor';
  const { summary } = data;

  return (
    <div className="space-y-5">
      {/* Welcome strip */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary">
          {greeting()}, {firstName}
        </h1>
        {refreshedAt && (
          <p className="text-xs text-text-faint">
            Updated{' '}
            {refreshedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>

      {onboardingIncomplete(client) && (
        <OnboardingChecklistCard client={client} onNavigate={onNavigate} />
      )}

      {canActivateMoreProducts(client) && (
        <ActivateProductsCard client={client} onActivate={onActivateProducts} />
      )}

      {/* Net worth — the number they opened the app for. */}
      <Tile>
        <div className="grid gap-6 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] sm:items-end">
          <Figure
            label="Portfolio value"
            value={inr(summary.netWorth)}
            size="lg"
            delta={summary.gain}
            deltaLabel={`${inr(Math.abs(summary.gain))} · ${pct(summary.gainPercent)}`}
          />
          <div className="grid grid-cols-3 gap-4">
            <MiniStat label="Invested" value={inrCompact(summary.invested)} />
            <MiniStat
              label="Returns"
              value={pct(summary.gainPercent)}
              tone={summary.gainPercent >= 0 ? 'positive' : 'negative'}
            />
            {/* Null means not enough history to compute — showing 0% here
                would claim a flat return, which is a different statement. */}
            <MiniStat
              label="XIRR"
              value={data.xirrPercent === null ? '—' : pct(data.xirrPercent)}
              tone={
                data.xirrPercent === null
                  ? 'default'
                  : data.xirrPercent >= 0
                    ? 'positive'
                    : 'negative'
              }
            />
          </div>
        </div>
        {data.xirrPercent === null && summary.netWorth > 0 && (
          <p className="mt-4 border-t border-border-subtle pt-3 text-[11px] text-text-faint">
            XIRR appears once there is enough transaction history to calculate a
            money-weighted return.
          </p>
        )}
      </Tile>

      <div className="grid gap-5 lg:grid-cols-2">
        <AllocationCard summary={summary} />
        <AccountSummaryCard client={client} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <MutualFundSummaryCard mf={data.mutualFunds} onViewAll={() => onNavigate('mutual-funds')} />
        <RecentTransactionsCard
          transactions={data.recentTransactions}
          onViewAll={() => onNavigate('transactions')}
        />
      </div>

      <QuickActions onNavigate={onNavigate} />

      <SupportCard onNavigate={onNavigate} />

      <p className="py-2 text-center text-[11px] text-text-faint">
        Niyom Wealth Distribution · Confidential · For your eyes only
      </p>
    </div>
  );
}
