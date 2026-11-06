/**
 * Market Watch — indices, gold/silver, USD/INR and 1-day MF movers.
 *
 * Rendered by the CRM, the client portal and the partner portal; each passes
 * its own surface's Supabase client. It only reads our cache tables (see
 * shared/market/marketWatch.ts) — never a market API — and every figure shows
 * its own "as of" stamp, because the three sources update on different clocks
 * (intraday quotes, a daily metals price, a daily AMFI NAV).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Activity, ArrowDownRight, ArrowUpRight, Coins, RefreshCw, Star, TrendingUp } from 'lucide-react';
import {
  fmtAsOfDate,
  fmtAsOfTime,
  fmtLevel,
  fmtSigned,
  fmtSignedPct,
  loadFundMoves,
  loadMarketSnapshot,
  toneOfChange,
  type CommodityQuote,
  type FundMove,
  type MarketQuote,
  type MarketSnapshot,
  type Tone,
} from '../../../shared/market/marketWatch';

const REFRESH_MS = 60_000;

const toneText: Record<Tone, string> = {
  up: 'text-success',
  down: 'text-danger',
  flat: 'text-text-secondary',
};

const cardCls = 'min-w-0 rounded-token-xl border border-border bg-bg-elevated p-3 shadow-token-card sm:p-4';

function Change({ change, pct, dp = 2 }: { change: number | null; pct: number | null; dp?: number }) {
  const tone = toneOfChange(pct ?? change);
  const Icon = tone === 'down' ? ArrowDownRight : ArrowUpRight;
  return (
    <div className={`mt-1 flex flex-wrap items-center gap-x-1.5 text-xs font-semibold tabular-nums ${toneText[tone]}`}>
      {tone !== 'flat' && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      {change !== null && <span>{fmtSigned(change, dp)}</span>}
      <span>({fmtSignedPct(pct)})</span>
    </div>
  );
}

function AsOf({ children }: { children: string }) {
  return <div className="mt-2 truncate text-[11px] text-text-muted">As of {children}</div>;
}

function QuoteCard({ q }: { q: MarketQuote }) {
  const dp = q.kind === 'currency' ? 3 : 2;
  return (
    <div className={cardCls}>
      <div className="truncate text-xs font-semibold uppercase tracking-wide text-text-secondary">{q.label}</div>
      <div className="mt-1.5 truncate font-display text-xl font-bold tabular-nums text-text-primary">
        {q.kind === 'currency' && q.price !== null ? '₹' : ''}
        {fmtLevel(q.price, q.kind === 'currency' ? 3 : 2)}
      </div>
      {q.price === null ? (
        <div className="mt-1 text-xs text-text-muted">Not available yet</div>
      ) : (
        <Change change={q.change} pct={q.changePct} dp={dp} />
      )}
      <AsOf>{fmtAsOfTime(q.asOf)}</AsOf>
    </div>
  );
}

function CommodityCard({ c }: { c: CommodityQuote }) {
  return (
    <div className={cardCls}>
      <div className="truncate text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {c.label} <span className="normal-case text-text-muted">/ {c.unit}</span>
      </div>
      <div className="mt-1.5 truncate font-display text-xl font-bold tabular-nums text-text-primary">
        ₹{fmtLevel(c.price, 0)}
      </div>
      <Change change={c.change} pct={c.changePct} dp={0} />
      <AsOf>{fmtAsOfDate(c.asOfDate)}</AsOf>
    </div>
  );
}

function FundRows({ funds, onOpenFund }: { funds: FundMove[]; onOpenFund?: (code: string) => void }) {
  return (
    <ul className="divide-y divide-border">
      {funds.map((f) => {
        const tone = toneOfChange(f.changePct);
        const body = (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-text-primary">{f.name}</div>
              <div className="truncate text-[11px] text-text-muted">
                {f.fundHouse ?? '—'} · NAV as of {fmtAsOfDate(f.navDate)}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold tabular-nums text-text-primary">₹{fmtLevel(f.nav, 2)}</div>
              <div className={`text-xs font-semibold tabular-nums ${toneText[tone]}`}>{fmtSignedPct(f.changePct)}</div>
            </div>
          </>
        );
        return (
          <li key={f.schemeCode}>
            {onOpenFund ? (
              <button
                type="button"
                onClick={() => onOpenFund(f.schemeCode)}
                className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-hover"
              >
                {body}
              </button>
            ) : (
              <div className="flex items-center gap-3 py-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Section({ title, icon: Icon, note, children }: {
  title: string;
  icon: typeof Activity;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-text-primary">
          <Icon className="h-5 w-5 text-accent" aria-hidden />
          {title}
        </h2>
        {note && <span className="text-[11px] text-text-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

export interface MarketWatchProps {
  // Any surface's client — the tables read are anon-readable market data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>;
  /** AMFI scheme codes on the viewer's watchlist; omit where there is none (CRM). */
  watchlistFundCodes?: string[];
  /** Noun for the watchlist section ("Watchlist", "Shortlist"). */
  watchlistNoun?: string;
  onOpenFund?: (schemeCode: string) => void;
  /** Render the page's own heading (the CRM); the portals title it in their header. */
  showTitle?: boolean;
}

export function MarketWatch({ db, watchlistFundCodes, watchlistNoun = 'Watchlist', onOpenFund, showTitle }: MarketWatchProps) {
  const [snap, setSnap] = useState<MarketSnapshot | null>(null);
  const [watched, setWatched] = useState<FundMove[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [tab, setTab] = useState<'gainers' | 'losers'>('gainers');

  const codesKey = useMemo(() => (watchlistFundCodes ?? []).slice().sort().join(','), [watchlistFundCodes]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, w] = await Promise.all([
        loadMarketSnapshot(db),
        loadFundMoves(db, codesKey ? codesKey.split(',') : []),
      ]);
      setSnap(s);
      setWatched(w);
      setError(null);
      setCheckedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load market data');
    } finally {
      setLoading(false);
    }
  }, [db, codesKey]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const indices = snap?.quotes.filter((q) => q.kind === 'index') ?? [];
  const currencies = snap?.quotes.filter((q) => q.kind === 'currency') ?? [];
  const movers = tab === 'gainers' ? snap?.gainers ?? [] : snap?.losers ?? [];
  const moversDate = (snap?.gainers[0] ?? snap?.losers[0])?.navDate;

  return (
    <div className="min-w-0 space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {showTitle ? (
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary">Market Watch</h1>
            <p className="text-sm text-text-secondary">Indices, metals, the rupee and today's fund movers.</p>
          </div>
        ) : (
          // The portals print the title and subtitle in their own header.
          <span className="text-xs text-text-muted">{checkedAt ? `Checked ${fmtAsOfTime(checkedAt)}` : ''}</span>
        )}
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-token-md border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-token-lg border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {!snap && !error && <div className="text-sm text-text-muted">Loading market data…</div>}

      {snap && (
        <>
          <Section title="Indices" icon={Activity} note="Indicative · refreshes every minute">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
              {indices.map((q) => (
                <QuoteCard key={q.symbol} q={q} />
              ))}
            </div>
          </Section>

          <Section title="Commodities & currency" icon={Coins} note="Gold & silver: India retail, daily">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {snap.commodities.map((c) => (
                <CommodityCard key={c.commodity} c={c} />
              ))}
              {currencies.map((q) => (
                <QuoteCard key={q.symbol} q={q} />
              ))}
            </div>
          </Section>

          {watchlistFundCodes && watchlistFundCodes.length > 0 && (
            <Section title={`Your ${watchlistNoun.toLowerCase()} funds`} icon={Star} note="1-day NAV change">
              <div className={cardCls}>
                {watched.length ? (
                  <FundRows funds={watched} onOpenFund={onOpenFund} />
                ) : (
                  <div className="text-sm text-text-muted">No fresh NAV change for your saved funds yet.</div>
                )}
              </div>
            </Section>
          )}

          <Section
            title="Mutual fund movers"
            icon={TrendingUp}
            note={moversDate ? `Regular plans · 1-day NAV change to ${fmtAsOfDate(moversDate)}` : 'Regular plans'}
          >
            <div className={cardCls}>
              <div className="mb-2 inline-flex rounded-token-md border border-border p-0.5" role="tablist">
                {(['gainers', 'losers'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`rounded-token-sm px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                      tab === t ? 'bg-accent text-text-on-accent' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    Top {t}
                  </button>
                ))}
              </div>
              {movers.length ? (
                <FundRows funds={movers} onOpenFund={onOpenFund} />
              ) : (
                <div className="py-2 text-sm text-text-muted">No fund NAVs published for the latest day yet.</div>
              )}
            </div>
          </Section>

          <p className="text-[11px] leading-relaxed text-text-muted">
            Index and currency levels are indicative, taken from a public market-data feed and may lag the exchange.
            Gold and silver are indicative Indian retail rates (incl. duty and GST). Fund NAVs are as published by
            AMFI. For information only — not investment advice. Past performance is not indicative of future returns.
          </p>
        </>
      )}
    </div>
  );
}
