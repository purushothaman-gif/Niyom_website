/**
 * Explore — the Mutual Funds landing.
 * -----------------------------------------------------------------------------
 * Replaces the flat scheme grid that used to open this tab. That grid listed a
 * page of the BSE master, which carries no NAV and no returns, so every card
 * read "₹0.00 / 0%" — a wall of zeros is not a place to start investing from.
 *
 * What a client actually arrives wanting is one of three things: a fund we
 * suggest, a kind of fund ("small cap", "tax saver"), or a specific fund by
 * name. Those are the three routes off this page, in that order.
 */
import { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ArrowRight,
  CalendarClock,
  Compass,
  Download,
  Search,
  SearchX,
  Sparkles,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { fmt } from '../../../../crm/utils';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { SectionHeader } from '../../../components/SectionHeader';
import type { PortalView } from '../../../layout/navigation';
import type { CatalogFund, FundRecommendation } from '../../../types/funds';
import type { MfHolding } from '../mappers';
import { CatalogFundCard } from './CatalogFundCard';
import { FundTable } from './FundTable';
import { FUND_COLLECTIONS, byReturn, fundsIn, searchFunds, type ReturnKey } from './collections';

/** Rows rendered for a search. The match COUNT shown to the user is never capped. */
const SEARCH_RENDER_CAP = 100;

interface Props {
  funds: CatalogFund[];
  recommendations: FundRecommendation[];
  holdings: MfHolding[];
  onOpenFund: (amfiCode: string) => void;
  onOpenCollection: (id: string) => void;
  /** Sends the client to the full BSE scheme master (everything we can trade). */
  onAllFunds: () => void;
  onNavigate: (view: PortalView) => void;
  /** Comparison shortlist, by AMFI code. */
  compare: string[];
  onToggleCompare: (amfiCode: string) => void;
  onOpenCompare: () => void;
  onClearCompare: () => void;
}

export function ExploreHome({
  funds,
  recommendations,
  holdings,
  onOpenFund,
  compare,
  onToggleCompare,
  onOpenCompare,
  onClearCompare,
  onOpenCollection,
  onAllFunds,
  onNavigate,
}: Props) {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<ReturnKey>('3Y');

  const results = useMemo(() => searchFunds(funds, query), [funds, query]);
  /*
   * The catalog is the whole AMFI universe now, so a one-letter query matches
   * well over a thousand schemes. Rendering them all locks up a phone, and an
   * endless table is not browsable anyway. The count above the table is always
   * the TRUE total — only the rows are capped, and the screen says so, because
   * a client who searches "HDFC" and counts 100 would otherwise conclude that
   * is all there is.
   */
  const shown = useMemo(() => results.slice(0, SEARCH_RENDER_CAP), [results]);
  const searching = query.trim().length > 0;

  /* Recommendations are stored as codes; a pick whose catalog row has gone
     (a refresh dropped it) is skipped rather than shown without its numbers. */
  const recoCards = useMemo(
    () =>
      recommendations
        .map((r) => ({ reco: r, fund: funds.find((f) => f.amfiCode === r.amfiCode) }))
        .filter((x): x is { reco: FundRecommendation; fund: CatalogFund } => !!x.fund),
    [recommendations, funds],
  );

  const topPerformers = useMemo(() => [...funds].sort(byReturn('3Y')).slice(0, 4), [funds]);

  const collections = useMemo(
    () =>
      FUND_COLLECTIONS.map((c) => ({ collection: c, count: fundsIn(c, funds).length })).filter(
        (c) => c.count > 0,
      ),
    [funds],
  );

  const amcs = useMemo(() => {
    const counts = new Map<string, number>();
    funds.forEach((f) => counts.set(f.amc, (counts.get(f.amc) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [funds]);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        {/* Search — the third route in, and the one people reach for by name. */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search funds, fund houses or categories…"
            className="w-full rounded-token-lg border border-border bg-bg-surface py-3 pl-10 pr-4 text-sm text-text-primary outline-none transition-colors focus:border-accent"
            aria-label="Search funds"
          />
        </div>

        {searching ? (
          results.length === 0 ? (
            <Card>
              <EmptyState
                icon={SearchX}
                title="No fund matches that."
                hint="Try a fund house, a category, or browse every tradable scheme."
              />
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={onAllFunds}
                  className="mt-4 inline-flex items-center gap-2 rounded-token-md border border-border px-4 py-2 text-xs font-semibold text-text-primary hover:text-accent"
                >
                  <Compass className="h-4 w-4" /> Browse all schemes
                </button>
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-text-secondary">
                <span className="font-bold text-text-primary">{results.length}</span>{' '}
                {results.length === 1 ? 'fund' : 'funds'} matching “{query.trim()}”
              </p>
              <FundTable funds={shown} sortBy={sortBy} onSort={setSortBy} onOpen={onOpenFund} />
              {results.length > shown.length && (
                <p className="text-xs text-text-secondary">
                  Showing the first {shown.length}. Add the fund house or category to
                  narrow it down.
                </p>
              )}
            </div>
          )
        ) : (
          <>
            {recoCards.length > 0 && (
              <section>
                <SectionHeader title="Recommended by Niyom" icon={Sparkles} />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {recoCards.map(({ reco, fund }) => (
                    <CatalogFundCard
                      key={fund.amfiCode}
                      fund={fund}
                      headline={reco.headline}
                      rationale={reco.rationale}
                      onOpen={() => onOpenFund(fund.amfiCode)}
                    />
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-text-faint">
                  Picked by your Niyom advisory team. A recommendation is not a guarantee — mutual
                  fund investments carry market risk.
                </p>
              </section>
            )}

            {topPerformers.length > 0 && (
              <section>
                <SectionHeader
                  title="Top performers"
                  icon={TrendingUp}
                  action={
                    <button
                      type="button"
                      onClick={() => onOpenCollection('high-return')}
                      className="flex items-center gap-1 text-xs font-semibold text-accent hover:opacity-80"
                    >
                      See all <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  }
                />
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {topPerformers.map((f) => (
                    <CatalogFundCard key={f.amfiCode} fund={f} onOpen={() => onOpenFund(f.amfiCode)}
                      selected={compare.includes(f.amfiCode)}
                      compareDisabled={compare.length >= 3}
                      onToggleCompare={() => onToggleCompare(f.amfiCode)} />
                  ))}
                </div>
              </section>
            )}

            <section>
              <SectionHeader title="Collections" icon={Compass} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {collections.map(({ collection, count }) => {
                  const Icon = collection.icon;
                  return (
                    <button
                      key={collection.id}
                      type="button"
                      onClick={() => onOpenCollection(collection.id)}
                      className="lift rounded-token-xl border border-border bg-bg-elevated p-4 text-left shadow-token-card"
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-token-lg bg-accent/10">
                        <Icon className="h-4 w-4 text-accent" />
                      </span>
                      <p className="mt-3 text-sm font-bold text-text-primary">{collection.label}</p>
                      <p className="mt-0.5 text-[11px] text-text-faint">
                        {count} {count === 1 ? 'fund' : 'funds'}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>

            {amcs.length > 0 && (
              <section>
                <SectionHeader title="Fund houses" />
                <div className="flex flex-wrap gap-2">
                  {amcs.map(([amc, count]) => (
                    <button
                      key={amc}
                      type="button"
                      onClick={() => setQuery(amc)}
                      className="rounded-token-md border border-border bg-bg-raised px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-accent/30 hover:text-accent"
                    >
                      {amc}
                      <span className="ml-1.5 text-text-faint">{count}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <aside className="space-y-4">
        <InvestmentsPanel holdings={holdings} onNavigate={onNavigate} />
        <ToolsPanel onAllFunds={onAllFunds} onNavigate={onNavigate} />
      </aside>

      {compare.length > 0 && (
        <div className="fixed bottom-20 left-1/2 z-40 flex max-w-[94vw] -translate-x-1/2 items-center gap-2 rounded-token-lg border border-accent bg-surface px-3 py-2 shadow-lg md:bottom-6">
          <span className="text-xs font-semibold text-text-primary">
            {compare.length} selected
          </span>
          <button
            type="button"
            onClick={onClearCompare}
            className="text-xs text-text-secondary hover:text-text-primary"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onOpenCompare}
            disabled={compare.length < 2}
            className="rounded-token-sm bg-accent px-3 py-1.5 text-xs font-bold text-on-accent disabled:opacity-40"
          >
            {compare.length < 2 ? 'Pick 2 to compare' : `Compare ${compare.length}`}
          </button>
        </div>
      )}
    </div>
  );
}

/** The client's own mutual fund position, so Explore is not a context switch. */
function InvestmentsPanel({
  holdings,
  onNavigate,
}: {
  holdings: MfHolding[];
  onNavigate: (view: PortalView) => void;
}) {
  if (holdings.length === 0) {
    return (
      <Card padding="md">
        <SectionHeader title="Your investments" icon={Wallet} />
        <p className="text-xs leading-relaxed text-text-secondary">
          You have no mutual fund holdings with us yet. Already invested elsewhere? Import your
          consolidated statement and the whole portfolio shows up here.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('portfolio')}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-token-md border border-border py-2 text-xs font-semibold text-text-primary hover:text-accent"
        >
          <Download className="h-3.5 w-3.5" /> Import portfolio
        </button>
      </Card>
    );
  }

  const value = holdings.reduce((s, h) => s + h.value, 0);
  const invested = holdings.reduce((s, h) => s + h.invested, 0);
  const gain = value - invested;
  const pct = invested > 0 ? (gain / invested) * 100 : 0;
  const up = gain >= 0;

  return (
    <Card padding="md">
      <SectionHeader title="Your investments" icon={Wallet} />
      <p className="text-[10px] uppercase tracking-wide text-text-faint">Current value</p>
      <p className="font-display text-2xl font-bold text-text-primary">{fmt(value)}</p>

      <dl className="mt-4 space-y-2 border-t border-border-subtle pt-3 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">Invested</dt>
          <dd className="font-semibold text-text-primary">{fmt(invested)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">Total returns</dt>
          <dd className="font-semibold" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>
            {up ? '+' : ''}
            {fmt(gain)} ({up ? '+' : ''}
            {pct.toFixed(2)}%)
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-text-secondary">Funds held</dt>
          <dd className="font-semibold text-text-primary">{holdings.length}</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={() => onNavigate('portfolio')}
        className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-token-md border border-border py-2 text-xs font-semibold text-text-primary hover:text-accent"
      >
        View portfolio <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </Card>
  );
}

interface Tool {
  label: string;
  hint: string;
  icon: LucideIcon;
  onClick: () => void;
}

function ToolsPanel({
  onAllFunds,
  onNavigate,
}: {
  onAllFunds: () => void;
  onNavigate: (view: PortalView) => void;
}) {
  const tools: Tool[] = [
    {
      label: 'All schemes',
      hint: 'Everything tradable, straight from the exchange',
      icon: Compass,
      onClick: onAllFunds,
    },
    {
      label: 'My SIPs',
      hint: 'Registered systematic plans',
      icon: CalendarClock,
      onClick: () => onNavigate('sip'),
    },
    {
      label: 'Transactions',
      hint: 'Every purchase, switch and redemption',
      icon: ArrowLeftRight,
      onClick: () => onNavigate('transactions'),
    },
  ];

  return (
    <Card padding="md">
      <SectionHeader title="Tools" />
      <ul className="space-y-1">
        {tools.map((t) => (
          <li key={t.label}>
            <button
              type="button"
              onClick={t.onClick}
              className="flex w-full items-center gap-3 rounded-token-md px-2 py-2.5 text-left transition-colors hover:bg-bg-surface"
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-token-md bg-bg-surface">
                <t.icon className="h-4 w-4 text-accent" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-text-primary">{t.label}</span>
                <span className="block truncate text-[11px] text-text-faint">{t.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
