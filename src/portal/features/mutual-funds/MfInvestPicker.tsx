/**
 * Mutual Funds → "Start a SIP" / "Invest lumpsum (one-time)".
 * -----------------------------------------------------------------------------
 * A fund picker for the client who arrives knowing HOW they want to invest but
 * not WHICH fund. It asks the one question that actually changes the answer —
 * how long the money stays invested — and returns a short, explained shortlist.
 *
 * Two kinds of suggestion appear, and they are kept visibly apart:
 *
 *   - "Niyom research picks": the staff recommendation shelf. A person signed
 *     for these, and their own rationale is shown.
 *   - "Shortlist for your horizon": DERIVED, never hand-picked. Each fund is
 *     there because of a stated rule (track record, rank inside its own
 *     category) and the row says which — so it reads as research, not a tip.
 *
 * Nothing here projects a future value. Every figure is a past return from the
 * curated catalog (Regular plan, AMFI NAV history).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, BadgeCheck, ChevronRight, ClipboardCheck, Search, Sparkles } from 'lucide-react';
import { LogoLoader } from '../../../components/LogoLoader';
import { Card } from '../../components/Card';
import { useMfCatalog } from '../../hooks/useMfCatalog';
import type { CatalogFund, FundRecommendation } from '../../types/funds';
import type { PortalHolding } from '../../types/cas';
import { CatalogFundPage } from './explore/CatalogFundPage';
import { FundTable } from './explore/FundTable';
import { CatalogRiskBadge, FundIdentity, RETURNS_FOOTNOTE, fmtRet, retColor } from './explore/catalogBits';
import { collectionById, ret, searchFunds, type FundCollection, type ReturnKey } from './explore/collections';
import { isFundHeld } from './heldFund';

export type InvestMode = 'sip' | 'lumpsum';

interface Horizon {
  id: string;
  label: string;
  /** Why this horizon points at these kinds of fund. */
  note: string;
  /** Collection ids, most suitable first. */
  collections: string[];
  /** The return period the shortlist is ranked on. */
  rankBy: ReturnKey;
  /** History a fund must have to be shortlisted at all. */
  needs: ReturnKey;
}

const MODES: Record<InvestMode, { title: string; lede: string; ask: string; horizons: Horizon[]; initial: string }> = {
  sip: {
    title: 'Start a SIP',
    lede: 'A fixed amount invested every month. You buy more units when markets fall and fewer when they rise, so the timing of any single instalment matters little.',
    ask: 'How long will the SIP run?',
    initial: 'mid',
    horizons: [
      {
        id: 'short',
        label: '3–5 years',
        note: 'Long enough for the steadier end of equity, too short to count on the volatile end recovering in time.',
        collections: ['large-cap', 'balanced', 'hybrid', 'index'],
        rankBy: '3Y',
        needs: '5Y',
      },
      {
        id: 'mid',
        label: '5–7 years',
        note: 'Roughly a full market cycle. Diversified equity is the usual core of a SIP this long.',
        collections: ['flexi-cap', 'large-cap', 'index', 'tax-saver'],
        rankBy: '3Y',
        needs: '5Y',
      },
      {
        id: 'long',
        label: '7+ years',
        note: 'Enough time to sit through the deeper swings of mid and small caps, where a monthly SIP helps most.',
        collections: ['flexi-cap', 'mid-cap', 'small-cap'],
        rankBy: '3Y',
        needs: '5Y',
      },
    ],
  },
  lumpsum: {
    title: 'Invest a lumpsum (one-time)',
    lede: 'The whole amount goes in on one day, so the price that day matters more than it does with a SIP. The shorter the horizon, the less equity the money should carry.',
    ask: 'When will you need this money?',
    initial: 'mid',
    horizons: [
      {
        id: 'park',
        label: 'Under 1 year',
        note: 'Money needed soon belongs in low-volatility debt. Equity can be down for longer than a year.',
        collections: ['liquid', 'debt'],
        rankBy: '1Y',
        needs: '1Y',
      },
      {
        id: 'short',
        label: '1–3 years',
        note: 'Debt for stability, or a fund that holds equity and debt together and rebalances for you.',
        collections: ['debt', 'balanced', 'hybrid'],
        rankBy: '3Y',
        needs: '3Y',
      },
      {
        id: 'mid',
        label: '3–5 years',
        note: 'Equity can earn its place here. Funds that manage their own equity level soften a badly timed entry.',
        collections: ['balanced', 'hybrid', 'large-cap', 'index'],
        rankBy: '3Y',
        needs: '5Y',
      },
      {
        id: 'long',
        label: '5+ years',
        note: 'Over five years and more, the entry date fades and diversified equity has historically done the work.',
        collections: ['flexi-cap', 'large-cap', 'mid-cap'],
        rankBy: '3Y',
        needs: '5Y',
      },
    ],
  },
};

const PER_SHELF = 3;
const COLUMNS: ReturnKey[] = ['1Y', '3Y', '5Y'];

interface Shortlisted {
  fund: CatalogFund;
  /** The stated reason this fund is on the list. */
  why: string;
}

interface Shelf {
  collection: FundCollection;
  /** Funds that passed the track-record screen. */
  screened: CatalogFund[];
  picks: Shortlisted[];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Screen and rank one collection for a horizon; the reason is part of the result. */
function buildShelf(collection: FundCollection, funds: CatalogFund[], h: Horizon): Shelf | null {
  const screened = funds
    .filter(collection.match)
    .filter((f) => ret(f, h.needs) !== null && ret(f, h.rankBy) !== null)
    .sort((a, b) => (ret(b, h.rankBy) ?? 0) - (ret(a, h.rankBy) ?? 0));
  if (!screened.length) return null;
  const mid = median(screened.map((f) => ret(f, h.rankBy) as number));
  const picks = screened.slice(0, PER_SHELF).map((fund, i) => {
    const own = ret(fund, h.rankBy) as number;
    const lead = mid === null ? null : own - mid;
    const rank =
      screened.length === 1
        ? `The only one we track here with a ${h.needs} record`
        : `#${i + 1} of ${screened.length} on ${h.rankBy} return`;
    const edge =
      lead !== null && screened.length >= 3 && lead > 0.05
        ? ` · ${lead.toFixed(1)} pts above the category median`
        : '';
    return { fund, why: `${rank}${edge}` };
  });
  return { collection, screened, picks };
}

interface Props {
  mode: InvestMode;
  /** The client's mutual fund holdings, to mark funds they already own. */
  holdings: PortalHolding[];
  /** The invest action for a fund's page (opens the investing account). */
  fundInvest: (fund: CatalogFund) => ReactNode;
}

type Screen = { name: 'home' } | { name: 'fund'; amfiCode: string } | { name: 'shelf'; id: string };

export function MfInvestPicker({ mode, holdings, fundInvest }: Props) {
  const cfg = MODES[mode];
  const catalog = useMfCatalog();
  const [horizonId, setHorizonId] = useState(cfg.initial);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<ReturnKey>('3Y');

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [screen]);

  const horizon = cfg.horizons.find((h) => h.id === horizonId) ?? cfg.horizons[0];
  const funds = catalog.funds;

  const shelves = useMemo(
    () => {
      // Collections overlap (a balanced advantage fund is also a hybrid fund):
      // a fund belongs to the first shelf that claims it, so it is never
      // suggested twice on one page.
      const taken = new Set<string>();
      const out: Shelf[] = [];
      for (const id of horizon.collections) {
        const c = collectionById(id);
        const shelf = c ? buildShelf(c, funds.filter((f) => !taken.has(f.amfiCode)), horizon) : null;
        if (!shelf) continue;
        shelf.screened.forEach((f) => taken.add(f.amfiCode));
        out.push(shelf);
      }
      return out;
    },
    [funds, horizon],
  );

  const staffPicks = useMemo(() => {
    const byCode = new Map(funds.map((f) => [f.amfiCode, f]));
    return catalog.recommendations
      .map((reco) => ({ reco, fund: byCode.get(reco.amfiCode) }))
      .filter((x): x is { reco: FundRecommendation; fund: CatalogFund } => !!x.fund);
  }, [funds, catalog.recommendations]);

  const results = useMemo(
    () => (query.trim().length >= 2 ? searchFunds(funds, query).slice(0, 30) : null),
    [funds, query],
  );

  const openFund = (amfiCode: string) => setScreen({ name: 'fund', amfiCode });

  if (catalog.loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <LogoLoader size={40} />
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
          platformInvest={fundInvest(fund)}
          investMode={mode}
        />
      );
  }

  if (screen.name === 'shelf') {
    const shelf = shelves.find((s) => s.collection.id === screen.id);
    if (shelf) {
      const Icon = shelf.collection.icon;
      return (
        <div className="space-y-5">
          <button
            type="button"
            onClick={() => setScreen({ name: 'home' })}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {cfg.title}
          </button>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-token-lg bg-accent/10">
              <Icon className="h-5 w-5 text-accent" />
            </span>
            <div>
              <h2 className="font-display text-xl font-bold text-text-primary">{shelf.collection.label}</h2>
              <p className="mt-0.5 text-xs text-text-secondary">
                {shelf.collection.blurb} Showing the {shelf.screened.length} with a {horizon.needs} track record.
              </p>
            </div>
          </div>
          <FundTable funds={shelf.screened} sortBy={sortBy} onSort={setSortBy} onOpen={openFund} />
        </div>
      );
    }
  }

  return (
    <div className="space-y-6">
      {/* The question that decides the shortlist */}
      <Card padding="md" accent>
        <h2 className="font-display text-xl font-bold tracking-tight text-text-primary">{cfg.title}</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-text-secondary">{cfg.lede}</p>

        <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">{cfg.ask}</p>
        <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={cfg.ask}>
          {cfg.horizons.map((h) => {
            const active = h.id === horizon.id;
            return (
              <button
                key={h.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setHorizonId(h.id)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-accent text-on-accent'
                    : 'border border-border bg-bg-surface text-text-secondary hover:border-accent/40 hover:text-text-primary'
                }`}
              >
                {h.label}
              </button>
            );
          })}
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-text-secondary">{horizon.note}</p>
      </Card>

      {/* Any fund, by name */}
      <label className="flex items-center gap-2 rounded-token-xl border border-border bg-bg-elevated px-4 py-3 shadow-token-card focus-within:border-accent">
        <Search className="h-4 w-4 shrink-0 text-text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Already know the fund? Search by name, AMC or category"
          className="w-full bg-transparent text-sm text-text-primary outline-none placeholder:text-text-faint"
        />
      </label>

      {results ? (
        results.length ? (
          <FundTable funds={results} sortBy={sortBy} onSort={setSortBy} onOpen={openFund} />
        ) : (
          <p className="px-1 text-sm text-text-secondary">No fund matches “{query.trim()}”.</p>
        )
      ) : (
        <>
          {staffPicks.length > 0 && (
            <section>
              <SectionTitle icon={Sparkles} title="Niyom research picks" hint="Chosen by your Niyom advisory team, with their reasoning." />
              <div className="grid gap-3 md:grid-cols-2">
                {staffPicks.slice(0, 4).map(({ reco, fund }) => (
                  <button
                    key={fund.amfiCode}
                    type="button"
                    onClick={() => openFund(fund.amfiCode)}
                    className="rounded-token-xl border border-border bg-bg-elevated p-4 text-left shadow-token-card transition-colors hover:border-accent/40"
                  >
                    <FundIdentity fund={fund} />
                    {(reco.headline || reco.rationale) && (
                      <div className="mt-3 border-l-2 border-accent pl-3">
                        {reco.headline && <p className="text-sm font-semibold text-text-primary">{reco.headline}</p>}
                        {reco.rationale && (
                          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-text-secondary">{reco.rationale}</p>
                        )}
                      </div>
                    )}
                    <ReturnsStrip fund={fund} className="mt-3" />
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionTitle
              icon={ClipboardCheck}
              title={`Shortlist for ${horizon.label.toLowerCase()}`}
              hint={`Screened by rule, not hand-picked: only funds with a ${horizon.needs} track record, ranked on ${horizon.rankBy} return inside their own category.`}
            />
            {shelves.length === 0 ? (
              <Card padding="md">
                <p className="text-sm text-text-secondary">
                  No fund we track passes the screen for this horizon yet. Search for a fund above, or try another horizon.
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                {shelves.map((shelf) => {
                  const Icon = shelf.collection.icon;
                  return (
                    <Card key={shelf.collection.id} padding="none" className="overflow-hidden">
                      <div className="flex items-start justify-between gap-3 border-b border-border-subtle px-4 py-3.5 sm:px-5">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-token-lg bg-accent/10">
                            <Icon className="h-4 w-4 text-accent" />
                          </span>
                          <div className="min-w-0">
                            <h3 className="font-display text-[15px] font-bold text-text-primary">{shelf.collection.label}</h3>
                            <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">{shelf.collection.blurb}</p>
                          </div>
                        </div>
                        {shelf.screened.length > PER_SHELF && (
                          <button
                            type="button"
                            onClick={() => setScreen({ name: 'shelf', id: shelf.collection.id })}
                            className="shrink-0 whitespace-nowrap text-xs font-semibold text-accent hover:underline"
                          >
                            See all {shelf.screened.length}
                          </button>
                        )}
                      </div>
                      <ul className="divide-y divide-border-subtle">
                        {shelf.picks.map(({ fund, why }) => (
                          <li key={fund.amfiCode}>
                            <button
                              type="button"
                              onClick={() => openFund(fund.amfiCode)}
                              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-bg-surface sm:px-5"
                            >
                              <div className="min-w-0 flex-1">
                                <FundIdentity fund={fund} />
                                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-[52px]">
                                  <span className="text-[11px] font-medium text-text-secondary">{why}</span>
                                  <CatalogRiskBadge risk={fund.risk} />
                                  {isFundHeld(fund.name, holdings) && (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-text-secondary">
                                      <BadgeCheck className="h-3 w-3 text-accent" /> You hold this
                                    </span>
                                  )}
                                </div>
                                <ReturnsStrip fund={fund} className="mt-2.5 pl-[52px] sm:hidden" />
                              </div>
                              <ReturnsStrip fund={fund} className="hidden shrink-0 sm:flex" />
                              <ChevronRight className="h-4 w-4 shrink-0 text-text-faint" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <p className="px-1 text-[11px] leading-relaxed text-text-faint">
        {RETURNS_FOOTNOTE} The shortlist is a rule-based screen for general information, not advice for your personal
        situation — your relationship manager can help you choose. Mutual fund investments are subject to market risks;
        read all scheme related documents carefully.
      </p>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, hint }: { icon: typeof Sparkles; title: string; hint: string }) {
  return (
    <div className="mb-3">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-text-primary">
        <Icon className="h-4 w-4 text-accent" /> {title}
      </h2>
      <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">{hint}</p>
    </div>
  );
}

/** 1Y / 3Y / 5Y, labelled — the same three periods wherever a fund is listed. */
function ReturnsStrip({ fund, className = '' }: { fund: CatalogFund; className?: string }) {
  return (
    <div className={`flex gap-5 ${className}`}>
      {COLUMNS.map((c) => (
        <div key={c} className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-text-faint">{c}</p>
          <p className="text-xs font-bold tabular-nums" style={{ color: retColor(ret(fund, c)) }}>
            {fmtRet(ret(fund, c))}
          </p>
        </div>
      ))}
    </div>
  );
}
