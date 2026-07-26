import { fmtDate } from '../../../crm/utils';
import type { NWClient } from '../../../crm/types';
import type { DashboardData } from '../../types';
import type { PortalView } from '../../layout/navigation';
import { NetWorthHero } from './sections/NetWorthHero';
import { AllocationCard } from './sections/AllocationCard';
import { AccountSummaryCard } from './sections/AccountSummaryCard';
import { MutualFundSummaryCard } from './sections/MutualFundSummaryCard';
import { GoalProgressCard } from './sections/GoalProgressCard';
import { RecentTransactionsCard } from './sections/RecentTransactionsCard';
import { UpcomingSipCard } from './sections/UpcomingSipCard';
import { QuickActions } from './sections/QuickActions';
import { MarketUpdatesCard } from './sections/MarketUpdatesCard';
import { NoticesCard } from './sections/NoticesCard';
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

export function DashboardPage({ client, data, refreshedAt, onNavigate, onActivateProducts }: DashboardPageProps) {
  const firstName = client?.full_name?.split(' ')[0] || 'Investor';

  return (
    <div className="space-y-6">
      {/* Welcome strip */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-widest text-accent">Wealth Overview</p>
          <h1 className="mt-0.5 font-display text-2xl font-bold text-text-primary">
            {greeting()}, {firstName}
          </h1>
        </div>
        {refreshedAt && (
          <p className="text-xs text-text-muted">
            Updated {fmtDate(refreshedAt.toISOString())} ·{' '}
            {refreshedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>

      {/* Onboarding checklist — only while the account is still being activated */}
      {onboardingIncomplete(client) && (
        <OnboardingChecklistCard client={client} onNavigate={onNavigate} />
      )}

      {/* Post-onboarding: prompt to enable Bonds / Unlisted Shares (demat + CML) */}
      {canActivateMoreProducts(client) && (
        <ActivateProductsCard client={client} onActivate={onActivateProducts} />
      )}

      {/* Row 1 — Net worth hero */}
      <NetWorthHero summary={data.summary} dailyChange={data.dailyChange} xirr={data.xirr} />

      {/* Row 2 — Allocation + Account */}
      <div className="grid gap-6 lg:grid-cols-2">
        <AllocationCard summary={data.summary} />
        <AccountSummaryCard client={client} />
      </div>

      {/* Row 3 — MF summary + Goals */}
      <div className="grid gap-6 lg:grid-cols-2">
        <MutualFundSummaryCard mf={data.mutualFunds} onViewAll={() => onNavigate('mutual-funds')} />
        <GoalProgressCard goals={data.goals} />
      </div>

      {/* Row 4 — Transactions + SIPs */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RecentTransactionsCard
          transactions={data.recentTransactions}
          onViewAll={() => onNavigate('transactions')}
        />
        <UpcomingSipCard sips={data.upcomingSips} />
      </div>

      {/* Row 5 — Quick actions */}
      <QuickActions onNavigate={onNavigate} />

      {/* Row 6 — Market + Notices */}
      <div className="grid gap-6 lg:grid-cols-2">
        <MarketUpdatesCard updates={data.marketUpdates} />
        <NoticesCard notices={data.notices} />
      </div>

      {/* Row 7 — Support */}
      <SupportCard />

      <p className="py-2 text-center text-xs text-border-strong">
        Niyom Wealth Distribution · Confidential · For your eyes only
      </p>
    </div>
  );
}
