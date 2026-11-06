/**
 * Invest → Explore. The Groww-style discovery home across everything Niyom
 * offers: popular bonds, popular mutual funds, fund collections and unlisted
 * shares on the left; the client's own investments and a Products & Tools list
 * on the right.
 *
 * Fund research pages open in place (CatalogFundPage) with the platform's
 * invest action; bonds and shares hand off to their own modules, which own the
 * order flows and the demat/KYC gating.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowLeftRight,
  CalendarClock,
  FileBarChart,
  Gem,
  Landmark,
  LineChart,
  Search,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import type { PortalView } from '../../layout/navigation';
import type { PortalHolding } from '../../types/cas';
import { BondOrderService, type ClientBond } from '../../../../shared/portal/services/BondOrderService';
import { ShareOrderService, type ClientShare } from '../../../../shared/portal/services/ShareOrderService';
import { ratingGrade } from '../../../../shared/portal/bonds/bondFilters';
import { findLogo, issuerFromBondName, useBrandLogoMap } from '../../../components/brandLogos';
import { fromClientHoldings, summarise } from '../../../../shared/portal/investments/model';
import { useMfCatalog } from '../../hooks/useMfCatalog';
import type { CatalogFund } from '../../types/funds';
import { useInvestmentRows } from '../investments/useInvestmentRows';
import { CatalogFundPage } from '../mutual-funds/explore/CatalogFundPage';
import { CollectionPage } from '../mutual-funds/explore/CollectionPage';
import { FUND_COLLECTIONS, byReturn, collectionById, fundsIn, searchFunds, type ReturnKey } from '../mutual-funds/explore/collections';
import { FundTable } from '../mutual-funds/explore/FundTable';
import {
  BondCard,
  CardGrid,
  CollectionTile,
  FundCard,
  ProductsTools,
  Rail,
  RailSkeleton,
  ShareCard,
  bondYield,
  type BondLike,
  type ToolItem,
} from './cards';
import { YourInvestmentsCard } from './YourInvestmentsCard';

/** Popular funds: staff picks first, else the 3Y leader of four core categories. */
export function popularFunds(funds: CatalogFund[], picks: string[]): CatalogFund[] {
  const byCode = new Map(funds.map((f) => [f.amfiCode, f]));
  const picked = picks.map((c) => byCode.get(c)).filter((f): f is CatalogFund => !!f);
  if (picked.length >= 4) return picked.slice(0, 4);
  const out = [...picked];
  for (const id of ['flexi-cap', 'large-cap', 'mid-cap', 'small-cap', 'high-return', 'hybrid']) {
    if (out.length >= 4) break;
    const c = collectionById(id);
    const top = c ? fundsIn(c, funds).find((f) => !out.some((o) => o.amfiCode === f.amfiCode)) : undefined;
    if (top) out.push(top);
  }
  return out;
}

/** Credit grade bucket, best first: AAA 0 · AA 1 · A-category 2 · BBB and below 3. */
function bondGradeRank(b: BondLike): number {
  const g = ratingGrade(b.rating) ?? '';
  return g.startsWith('AAA') ? 0 : g.startsWith('AA') ? 1 : g.startsWith('A') ? 2 : 3;
}

/** Secured — collateral-backed, not a subordinated/unsecured instrument. */
function bondSecured(b: BondLike): boolean {
  const s = (b.security_type ?? '').toLowerCase();
  return s.includes('secured') && !s.includes('unsecured');
}

/** Popular bonds: investment-grade first (AA and above), then by yield. */
export function popularBonds<T extends BondLike & { maturity_date: string | null }>(bonds: T[], n = 4): T[] {
  const live = bonds.filter((b) => !b.maturity_date || new Date(b.maturity_date) > new Date());
  return [...live]
    .sort((a, b) => bondGradeRank(a) - bondGradeRank(b) || (bondYield(b) ?? 0) - (bondYield(a) ?? 0))
    .slice(0, n);
}

/**
 * The client "Popular Bonds" rail — the handful worth featuring, not the whole
 * book. Every bond shown must earn it: a real issuer logo on file (so the card
 * shows a brand, not a monogram), a secured instrument and a good credit grade
 * (A-category or better). Among those we lead with the ones yielding a decent
 * 10–13%, then top up with the next-best by yield so the rail stays full.
 *
 * If nothing clears the logo+secured+grade bar (e.g. the logo table hasn't
 * loaded yet) we fall back to the strongest secured, well-rated bonds rather
 * than leave the rail empty — a transient state that self-corrects on the next
 * render once logos arrive.
 */
export function curatedBonds<T extends BondLike & { maturity_date: string | null }>(
  bonds: T[],
  hasLogo: (b: T) => boolean,
  n = 4,
): T[] {
  const live = bonds.filter((b) => !b.maturity_date || new Date(b.maturity_date) > new Date());
  const byYield = (a: T, b: T) => (bondYield(b) ?? 0) - (bondYield(a) ?? 0);
  const byBest = (a: T, b: T) => bondGradeRank(a) - bondGradeRank(b) || byYield(a, b);
  const goodGrade = (b: T) => bondGradeRank(b) <= 2; // A-category and above
  const inBand = (b: T) => {
    const y = bondYield(b);
    return y != null && y >= 10 && y <= 13;
  };

  // The headline set: logo + secured + good rating. 10–13% yields first, then
  // the next-best by yield so four cards still show if few land exactly in band.
  const featured = live.filter((b) => hasLogo(b) && bondSecured(b) && goodGrade(b));
  if (featured.length) {
    const band = featured.filter(inBand).sort(byYield);
    const rest = featured.filter((b) => !inBand(b)).sort(byYield);
    return [...band, ...rest].slice(0, n);
  }

  // Fallbacks (nothing logo-matched yet): best secured/well-rated bonds we have.
  const secured = live.filter((b) => bondSecured(b) && goodGrade(b)).sort(byBest);
  if (secured.length) return secured.slice(0, n);
  return [...live].sort(byBest).slice(0, n);
}

/** Rows rendered in the all-funds list; search narrows the rest. */
const ALL_CAP = 100;

export type ExploreScreen =
  | { name: 'home' }
  | { name: 'all' }
  | { name: 'fund'; amfiCode: string }
  | { name: 'collection'; id: string };
type Screen = ExploreScreen;

interface Props {
  holdings: PortalHolding[];
  xirrPercent: number | null;
  /** Views switched off for this client (product access). */
  hidden: ReadonlySet<string>;
  onNavigate: (view: PortalView) => void;
  onOpenBond: (id: string) => void;
  onOpenShare: (id: string) => void;
  /** The invest action shown on a fund page (opens the MF platform). */
  fundInvest: ReactNode;
  /** Mutual Funds page variant: no self-link to Mutual Funds in the tools list. */
  fundsOnly?: boolean;
  /**
   * Dashboard variant: just the discovery rails, full width — no right column
   * (the dashboard has its own summary) and no fund search. Fund screens open
   * on the Explore page via onOpenScreen instead of replacing the dashboard.
   */
  embedded?: boolean;
  onOpenScreen?: (screen: ExploreScreen) => void;
  /** Screen to open on arrival (a fund picked on the dashboard). */
  initialScreen?: ExploreScreen | null;
}

export function ExploreHub({
  holdings,
  xirrPercent,
  hidden,
  onNavigate,
  onOpenBond,
  onOpenShare,
  fundInvest,
  fundsOnly = false,
  embedded = false,
  onOpenScreen,
  initialScreen = null,
}: Props) {
  const showFunds = !hidden.has('mutual-funds');
  const showBonds = !hidden.has('bonds');
  const showShares = !hidden.has('unlisted-shares');

  const catalog = useMfCatalog();
  const [bonds, setBonds] = useState<ClientBond[] | null>(null);
  const [shares, setShares] = useState<ClientShare[] | null>(null);
  const [screen, setLocalScreen] = useState<Screen>(initialScreen ?? { name: 'home' });
  // Embedded on the dashboard, any deeper screen opens on the Explore page.
  const setScreen = (next: Screen) =>
    embedded && next.name !== 'home' && onOpenScreen ? onOpenScreen(next) : setLocalScreen(next);
  const [query, setQuery] = useState('');
  const [allQuery, setAllQuery] = useState('');
  const [allSort, setAllSort] = useState<ReturnKey>('3Y');

  // A new screen starts at the top, not wherever the previous page was scrolled.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [screen]);

  useEffect(() => {
    let alive = true;
    if (showBonds) BondOrderService.getBonds().then((b) => alive && setBonds(b)).catch(() => alive && setBonds([]));
    if (showShares) ShareOrderService.getShares().then((s) => alive && setShares(s)).catch(() => alive && setShares([]));
    return () => {
      alive = false;
    };
  }, [showBonds, showShares]);

  const baseRows = useMemo(() => fromClientHoldings(holdings), [holdings]);
  const { rows } = useInvestmentRows('client', baseRows);
  const summary = useMemo(() => (rows.length ? summarise(rows) : null), [rows]);
  const xirr = rows.some((r) => r.source === 'registrar') ? null : xirrPercent;

  const funds = catalog.funds;
  const popFunds = useMemo(
    () => popularFunds(funds, catalog.recommendations.map((r) => r.amfiCode)),
    [funds, catalog.recommendations],
  );
  // The hero bond must show a real logo, so resolve the issuer the same way the
  // card does (issuer name, else parsed from the bond name) against the logo map.
  const logoMap = useBrandLogoMap();
  const hasLogo = useCallback(
    (b: ClientBond) =>
      !!findLogo(logoMap, 'bond_issuer', b.issuer_name?.trim() || issuerFromBondName(b.bond_name) || null),
    [logoMap],
  );
  const popBonds = useMemo(() => (bonds ? curatedBonds(bonds, hasLogo) : []), [bonds, hasLogo]);
  const collections = useMemo(
    () =>
      FUND_COLLECTIONS.map((c) => ({ c, n: fundsIn(c, funds).length }))
        .filter((x) => x.n > 0)
        .slice(0, 6),
    [funds],
  );
  const results = useMemo(() => (query.trim().length >= 2 ? searchFunds(funds, query).slice(0, 25) : []), [funds, query]);

  /* ---------- in-place fund screens ---------- */
  if (screen.name === 'all') {
    const matches = searchFunds(funds, allQuery);
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setScreen({ name: 'home' })}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Explore
        </button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-xl font-bold text-text-primary">
            All mutual funds <span className="text-text-faint">({matches.length.toLocaleString('en-IN')})</span>
          </h2>
        </div>
        <label className="flex items-center gap-2 rounded-token-xl border border-border bg-bg-elevated px-4 py-3 shadow-token-card focus-within:border-accent">
          <Search className="h-4 w-4 text-text-faint" />
          <input
            autoFocus
            value={allQuery}
            onChange={(e) => setAllQuery(e.target.value)}
            placeholder="Search by fund name, AMC or category"
            className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-faint"
          />
        </label>
        <FundTable
          funds={[...matches].sort(byReturn(allSort)).slice(0, ALL_CAP)}
          sortBy={allSort}
          onSort={setAllSort}
          onOpen={(amfiCode) => setScreen({ name: 'fund', amfiCode })}
        />
        {matches.length > ALL_CAP && (
          <p className="px-1 text-xs text-text-faint">
            Showing the top {ALL_CAP} by {allSort} return — search to narrow down.
          </p>
        )}
      </div>
    );
  }
  if (screen.name === 'fund') {
    const fund = funds.find((f) => f.amfiCode === screen.amfiCode);
    if (fund)
      return (
        <CatalogFundPage
          fund={fund}
          schemes={[]}
          gate={null}
          onBack={() => setScreen({ name: 'home' })}
          onInvest={() => undefined}
          platformInvest={fundInvest}
        />
      );
  }
  if (screen.name === 'collection') {
    const c = collectionById(screen.id);
    if (c)
      return (
        <CollectionPage
          collection={c}
          funds={funds}
          onBack={() => setScreen({ name: 'home' })}
          onOpenFund={(amfiCode) => setScreen({ name: 'fund', amfiCode })}
        />
      );
  }

  const tools: ToolItem[] = [
    ...(showBonds
      ? [{ key: 'bonds', label: 'Bonds', icon: Landmark, badge: bonds ? `${bonds.length} open` : undefined, onClick: () => onNavigate('bonds') }]
      : []),
    ...(showShares
      ? [{ key: 'shares', label: 'Unlisted Shares', icon: Gem, badge: shares ? `${shares.length} open` : undefined, onClick: () => onNavigate('unlisted-shares') }]
      : []),
    ...(showFunds
      ? fundsOnly
        ? [{ key: 'all', label: 'Browse all funds', icon: TrendingUp, onClick: () => setScreen({ name: 'all' }) }]
        : [{ key: 'mf', label: 'Mutual Funds', icon: TrendingUp, onClick: () => onNavigate('mutual-funds') }]
      : []),
    { key: 'portfolio', label: 'My Portfolio', icon: LineChart, onClick: () => onNavigate('portfolio') },
    { key: 'txns', label: 'Transactions', icon: ArrowLeftRight, onClick: () => onNavigate('transactions') },
    { key: 'reports', label: 'Reports & statements', icon: FileBarChart, onClick: () => onNavigate('reports') },
  ];

  return (
    <div className={embedded ? '' : 'grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]'}>
      {/* ------------------------------------------------ left column */}
      <div className="min-w-0 space-y-10">
        {showBonds && (
          <Rail title="Popular Bonds" icon={Landmark} more="See more" onMore={() => onNavigate('bonds')}>
            {bonds === null ? (
              <RailSkeleton />
            ) : popBonds.length ? (
              <CardGrid>
                {popBonds.map((b) => (
                  <BondCard key={b.id} bond={b} onOpen={() => onOpenBond(b.id)} />
                ))}
              </CardGrid>
            ) : (
              <EmptyRail text="New bond offers are added regularly — check back soon." />
            )}
          </Rail>
        )}

        {showFunds && (
          <Rail title="Popular Funds" icon={Sparkles} more="All Mutual Funds" onMore={() => setScreen({ name: 'all' })}>
            {catalog.loading ? (
              <RailSkeleton />
            ) : (
              <CardGrid>
                {popFunds.map((f) => (
                  <FundCard key={f.amfiCode} fund={f} onOpen={() => setScreen({ name: 'fund', amfiCode: f.amfiCode })} />
                ))}
              </CardGrid>
            )}
          </Rail>
        )}

        {showFunds && !catalog.loading && funds.length > 0 && (
          <Rail title="Collections">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {collections.map(({ c, n }) => (
                <CollectionTile key={c.id} collection={c} count={n} onOpen={() => setScreen({ name: 'collection', id: c.id })} />
              ))}
            </div>
          </Rail>
        )}

        {showShares && (
          <Rail title="Unlisted Shares" icon={Gem} more="See more" onMore={() => onNavigate('unlisted-shares')}>
            {shares === null ? (
              <RailSkeleton />
            ) : shares.length ? (
              <CardGrid>
                {shares.slice(0, 4).map((s) => (
                  <ShareCard key={s.id} share={s} price={s.client_price} onOpen={() => onOpenShare(s.id)} />
                ))}
              </CardGrid>
            ) : (
              <EmptyRail text="No unlisted shares are open right now." />
            )}
          </Rail>
        )}

        {!embedded && showFunds && !catalog.loading && funds.length > 0 && (
          <Rail title="Find a fund" icon={Search}>
            <label className="flex items-center gap-2 rounded-token-xl border border-border bg-bg-elevated px-4 py-3 shadow-token-card focus-within:border-accent">
              <Search className="h-4 w-4 text-text-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${funds.length.toLocaleString('en-IN')} funds by name, AMC or category`}
                className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-faint"
              />
            </label>
            {results.length > 0 && (
              <div className="mt-3">
                <FundTable funds={results} sortBy="3Y" onSort={() => undefined} onOpen={(amfiCode) => setScreen({ name: 'fund', amfiCode })} />
              </div>
            )}
          </Rail>
        )}
      </div>

      {/* ------------------------------------------------ right column */}
      {!embedded && (
      <aside className="space-y-8">
        <YourInvestmentsCard summary={summary} xirr={xirr} onOpen={() => onNavigate('portfolio')} />
        <ProductsTools items={tools} />
        <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-text-faint">
          <CalendarClock className="mt-px h-3.5 w-3.5 shrink-0" />
          Fund returns are the scheme&rsquo;s own trailing returns from AMFI NAVs, not a forecast. Bond yields are
          at today&rsquo;s offer price.
        </p>
      </aside>
      )}
    </div>
  );
}

function EmptyRail({ text }: { text: string }) {
  return (
    <div className="rounded-token-xl border border-dashed border-border px-5 py-8 text-center text-sm text-text-secondary">{text}</div>
  );
}
