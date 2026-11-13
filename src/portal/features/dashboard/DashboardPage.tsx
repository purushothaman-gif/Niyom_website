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
import { useMemo, type ReactNode } from 'react';
import type { PortalHolding } from '../../types/cas';
import { fromClientHoldings, summarise } from '../../../../shared/portal/investments/model';
import { YourInvestmentsCard } from '../explore/YourInvestmentsCard';
import { TopHoldingsCard } from '../investments/TopHoldingsCard';
import { useInvestmentRows } from '../investments/useInvestmentRows';
import { SipsCard } from '../investments/SipsCard';
import { fmtDate } from '../../../crm/utils';
import { AccountSummaryCard } from './sections/AccountSummaryCard';
import { MutualFundSummaryCard } from './sections/MutualFundSummaryCard';
import { mfSsoEnabled } from '../../../../shared/platform/env';
import { useRtaMf } from '../../hooks/useRtaMf';
import { RecentTransactionsCard } from './sections/RecentTransactionsCard';
import { QuickActions } from './sections/QuickActions';
import { SupportCard } from './sections/SupportCard';
import { OnboardingChecklistCard } from '../onboarding/OnboardingChecklistCard';
import { ActivateProductsCard } from './sections/ActivateProductsCard';
import { ImportHubBanner } from '../portfolio/ImportHubBanner';
import { onboardingIncomplete, canActivateMoreProducts } from '../onboarding/onboardingSteps';

interface DashboardPageProps {
  /** The Explore rails (popular bonds, funds, collections, shares), Groww-style. */
  explore?: ReactNode;
  client: NWClient | null;
  /** For reading the client's registrar-fed mutual funds. */
  clientId: string;
  data: DashboardData;
  /** Every holding in the snapshot, for the portfolio board. */
  holdings: PortalHolding[];
  refreshedAt: Date | null;
  onNavigate: (view: PortalView) => void;
  onActivateProducts: () => void;
  /** Opens the import wizard, owned by PortalApp. */
  onImport: () => void;
  /** Opens the import hub — every route for bringing outside holdings in. */
  onOpenImportHub: () => void;
  /** Value change across the last published NAV move; null until there is one. */
  dayChange?: number | null;
  /** False when the imported statement starts mid-history, so no return is shown. */
  historyComplete?: boolean;
  /** Where that statement's period begins, so the explanation can be concrete. */
  statementFrom?: string | null;
  /** False until a reconciled statement exists — drives the import prompt. */
  hasImportedStatement?: boolean;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardPage({
  explore,
  client,
  clientId,
  data,
  holdings,
  refreshedAt,
  onNavigate,
  onActivateProducts,
  onImport,
  onOpenImportHub,
  hasImportedStatement = false,
  historyComplete = true,
  statementFrom = null,
}: DashboardPageProps) {
  const firstName = client?.full_name?.split(' ')[0] || 'Investor';
  // MF holdings + SIPs for the dashboard card only. The headline totals already
  // include the registrar MF (folded into the snapshot in HoldingService), so
  // this must not be re-added to any total.
  const mfSsoOn = mfSsoEnabled();
  const rta = useRtaMf(clientId);
  const baseRows = useMemo(() => fromClientHoldings(holdings), [holdings]);
  const { rows } = useInvestmentRows('client', baseRows);
  // XIRR now covers only holdings whose cash flows explain them (registrar
  // funds whose transactions reconcile to the units held); the rest are left
  // out and the coverage is shown — see dashboardModel.xirrFor.
  const xirr = data.xirrPercent;
  const xirrCoverage = data.xirrCoveragePct ?? null;
  const xirrNote = data.xirrNote ?? null;

  // On a phone the client's own money comes first — before promos and the
  // Explore rails — once there is any. A client with nothing yet still sees the
  // setup steps first, and the empty card stays further down.
  const hasMoney = rows.length > 0;
  const investmentsCard = (
    <YourInvestmentsCard summary={hasMoney ? summarise(rows) : null} xirr={xirr} xirrCoveragePct={xirrCoverage} xirrNote={xirrNote} onOpen={() => onNavigate('portfolio')} />
  );

  const exploreBlockNode = (
    <>
      {explore && (
        <section className="space-y-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-bold tracking-tight text-text-primary">Explore</h2>
              <p className="mt-0.5 text-sm text-text-secondary">Popular bonds, mutual funds and unlisted shares — picked for you.</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('explore')}
              className="shrink-0 text-xs font-semibold text-accent hover:text-accent-soft"
            >
              Open Explore →
            </button>
          </div>
          <div className="pt-4">{explore}</div>
        </section>
      )}
    </>
  );

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

      {hasMoney && <div className="lg:hidden">{investmentsCard}</div>}

      {onboardingIncomplete(client) && (
        <OnboardingChecklistCard client={client} onNavigate={onNavigate} />
      )}

      {canActivateMoreProducts(client) && (
        <ActivateProductsCard client={client} onActivate={onActivateProducts} />
      )}

      {/*
        The import offer sits above the fold on purpose: a client who holds
        funds or shares elsewhere is looking at a partial portfolio and has no
        way to know it. Full-size until something is imported, one row after.
      */}
      <ImportHubBanner onOpen={onOpenImportHub} compact={hasImportedStatement} />

      {/*
        Groww-style: discovery on the left (bonds, then mutual funds, then
        unlisted shares), the client's own money in the right-hand column.
      */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">{exploreBlockNode}</div>
        <aside className="space-y-8">
          <div className={hasMoney ? 'hidden lg:block' : ''}>{investmentsCard}</div>
          <TopHoldingsCard rows={rows} onOpen={() => onNavigate('portfolio')} />
          {mfSsoOn ? (
            <SipsCard sips={rta.data?.sips ?? []} onOpen={() => onNavigate('mutual-funds')} />
          ) : (
            <MutualFundSummaryCard mf={data.mutualFunds} onViewAll={() => onNavigate('mutual-funds')} />
          )}
          <RecentTransactionsCard
            transactions={data.recentTransactions}
            onViewAll={() => onNavigate('transactions')}
          />
        </aside>
      </div>

      {!historyComplete && (
        <p className="rounded-token-lg border border-border-subtle bg-bg-surface px-4 py-3 text-[11px] leading-relaxed text-text-secondary">
          Your return needs your full investing history. The statement you imported
          {statementFrom ? ` begins on ${fmtDate(statementFrom)}` : ' begins part-way through'}, so
          anything you bought before that is missing from it.{' '}
          <button type="button" onClick={onImport} className="font-semibold text-accent underline underline-offset-2">
            Import one from the earliest available date
          </button>
          .
        </p>
      )}


      <AccountSummaryCard client={client} />

      <QuickActions onNavigate={onNavigate} />

      <SupportCard onNavigate={onNavigate} />

      <p className="py-2 text-center text-[11px] text-text-faint">
        Niyom Wealth Distribution · Confidential · For your eyes only
      </p>
    </div>
  );
}
