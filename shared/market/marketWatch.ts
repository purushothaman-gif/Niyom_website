/**
 * Market Watch: data shapes, reads and pure formatting.
 * -----------------------------------------------------------------------------
 * One implementation for the CRM, the client portal and the partner portal.
 * Every read is from OUR cache tables, never a third-party API:
 *
 *   market_quotes         indices + USD/INR, written by `market-watch-refresh`
 *                         (Yahoo Finance chart endpoint, every 2 min in market
 *                         hours). Indicative, unofficial source.
 *   commodity_prices      gold (₹/10g) and silver (₹/kg), India retail, once a
 *                         day from `update-commodity-prices`.
 *   market_mf_day_change  1-day NAV change per Regular-plan scheme, derived
 *                         from AMFI NAVs in nav_daily.
 *
 * All three are anon-readable published market data, so the caller passes
 * whichever surface's client it already uses (and the front-end demo logins,
 * which have no session, still see real figures).
 *
 * The client is typed loosely on purpose: each surface's client is a
 * differently-parameterised SupabaseClient, and this module must not import a
 * concrete instance (see shared/lib/funds/universeCatalog.ts for why).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = SupabaseClient<any, any, any>;

export interface MarketQuote {
  symbol: string;
  label: string;
  kind: 'index' | 'currency';
  price: number | null;
  change: number | null;
  changePct: number | null;
  prevClose: number | null;
  /** The source's own last-trade time (ISO). */
  asOf: string | null;
  source: string | null;
}

export interface CommodityQuote {
  commodity: 'gold' | 'silver';
  label: string;
  unit: string;
  price: number;
  change: number | null;
  changePct: number | null;
  /** Price date (YYYY-MM-DD) — a daily figure. */
  asOfDate: string;
}

export interface FundMove {
  schemeCode: string;
  name: string;
  fundHouse: string | null;
  category: string | null;
  nav: number;
  prevNav: number;
  changePct: number;
  navDate: string;
}

export interface MarketSnapshot {
  quotes: MarketQuote[];
  commodities: CommodityQuote[];
  gainers: FundMove[];
  losers: FundMove[];
}

/** Postgres numerics arrive as strings over PostgREST; 0 is real, null is not. */
export const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * A 1-day NAV move beyond this is a data event (a split, a merger, a mis-keyed
 * NAV), not market movement, so it is kept off the movers list.
 */
export const MAX_PLAUSIBLE_FUND_MOVE_PCT = 15;

const COMMODITY_META = {
  gold: { label: 'Gold', unit: '10 g' },
  silver: { label: 'Silver', unit: '1 kg' },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToQuote(r: any): MarketQuote {
  return {
    symbol: r.symbol,
    label: r.label,
    kind: r.kind,
    price: toNum(r.price),
    change: toNum(r.change),
    changePct: toNum(r.change_pct),
    prevClose: toNum(r.prev_close),
    asOf: r.as_of ?? null,
    source: r.source ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToFundMove(r: any): FundMove {
  return {
    schemeCode: r.scheme_code,
    name: r.scheme_name,
    fundHouse: r.fund_house ?? null,
    category: r.amfi_category ?? null,
    nav: toNum(r.nav) ?? 0,
    prevNav: toNum(r.prev_nav) ?? 0,
    changePct: toNum(r.change_pct) ?? 0,
    navDate: r.nav_date,
  };
}

/**
 * Latest price + day change per commodity from rows ordered newest first.
 * The change is against the previous stored day, which is the previous
 * publication, not necessarily yesterday.
 */
export function commoditiesFromRows(
  rows: { commodity: string; price: unknown; price_date: string }[],
): CommodityQuote[] {
  const out: CommodityQuote[] = [];
  for (const c of ['gold', 'silver'] as const) {
    const mine = rows
      .filter((r) => r.commodity === c && toNum(r.price) !== null)
      .sort((a, b) => b.price_date.localeCompare(a.price_date));
    if (!mine.length) continue;
    const price = toNum(mine[0].price) as number;
    const prev = mine[1] ? toNum(mine[1].price) : null;
    const change = prev ? price - prev : null;
    out.push({
      commodity: c,
      ...COMMODITY_META[c],
      price,
      change,
      changePct: change !== null && prev ? (change / prev) * 100 : null,
      asOfDate: mine[0].price_date,
    });
  }
  return out;
}

export async function loadMarketSnapshot(db: AnyDb, moversLimit = 8): Promise<MarketSnapshot> {
  const lim = MAX_PLAUSIBLE_FUND_MOVE_PCT;
  const [q, c, g, l] = await Promise.all([
    db.from('market_quotes').select('*').order('sort_order'),
    db
      .from('commodity_prices')
      .select('commodity, price, price_date')
      .order('price_date', { ascending: false })
      .limit(8),
    db
      .from('market_mf_day_change')
      .select('*')
      .gt('change_pct', 0)
      .lte('change_pct', lim)
      .order('change_pct', { ascending: false })
      .limit(moversLimit),
    db
      .from('market_mf_day_change')
      .select('*')
      .lt('change_pct', 0)
      .gte('change_pct', -lim)
      .order('change_pct', { ascending: true })
      .limit(moversLimit),
  ]);
  for (const r of [q, c, g, l]) if (r.error) throw r.error;
  return {
    quotes: (q.data ?? []).map(rowToQuote),
    commodities: commoditiesFromRows(c.data ?? []),
    gainers: (g.data ?? []).map(rowToFundMove),
    losers: (l.data ?? []).map(rowToFundMove),
  };
}

/** 1-day moves for specific schemes (the viewer's watchlist), biggest first. */
export async function loadFundMoves(db: AnyDb, schemeCodes: string[]): Promise<FundMove[]> {
  if (!schemeCodes.length) return [];
  const { data, error } = await db
    .from('market_mf_day_change')
    .select('*')
    .in('scheme_code', schemeCodes.slice(0, 200));
  if (error) throw error;
  return (data ?? [])
    .map(rowToFundMove)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

// ---- Formatting --------------------------------------------------------------

export type Tone = 'up' | 'down' | 'flat';

export function toneOfChange(v: number | null | undefined): Tone {
  if (v === null || v === undefined || Math.abs(v) < 1e-9) return 'flat';
  return v > 0 ? 'up' : 'down';
}

export function fmtSignedPct(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined) return '—';
  const s = Math.abs(v).toFixed(dp);
  if (Number(s) === 0) return `${(0).toFixed(dp)}%`;
  return `${v > 0 ? '+' : '−'}${s}%`;
}

export function fmtSigned(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined) return '—';
  const s = Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  if (Number(Math.abs(v).toFixed(dp)) === 0) return (0).toFixed(dp);
  return `${v > 0 ? '+' : '−'}${s}`;
}

export function fmtLevel(v: number | null | undefined, dp = 2): string {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

const IST = 'Asia/Kolkata';

/** "6 Nov, 3:31 pm" in IST — the "as of" stamp on intraday figures. */
export function fmtAsOfTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: IST });
  const time = d
    .toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST })
    .toLowerCase();
  return `${date}, ${time}`;
}

/** "6 Nov 2026" — the "as of" stamp on daily figures (NAV, gold, silver). */
export function fmtAsOfDate(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return '—';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// ---- Ticker strip --------------------------------------------------------------

/** The headline figures for the always-visible strip, in display order. */
export const TICKER_SYMBOLS = ['NIFTY50', 'SENSEX'] as const;

export interface TickerItem {
  key: string;
  label: string;
  /** Formatted level, e.g. "25,030.35" or "₹1,39,574". */
  value: string;
  changePct: number | null;
  /** Formatted as-of stamp for the tooltip. */
  asOf: string;
}

export function tickerItems(quotes: MarketQuote[], commodities: CommodityQuote[]): TickerItem[] {
  const out: TickerItem[] = [];
  for (const s of TICKER_SYMBOLS) {
    const q = quotes.find((x) => x.symbol === s);
    if (!q || q.price === null) continue;
    out.push({ key: s, label: q.label, value: fmtLevel(q.price, 2), changePct: q.changePct, asOf: fmtAsOfTime(q.asOf) });
  }
  for (const c of commodities) {
    out.push({
      key: c.commodity,
      label: `${c.label} ${c.unit.replace(' ', '')}`,
      value: `₹${fmtLevel(c.price, 0)}`,
      changePct: c.changePct,
      asOf: fmtAsOfDate(c.asOfDate),
    });
  }
  return out;
}

/** Just what the strip needs: two index rows and the last few metal prices. */
export async function loadTicker(db: AnyDb): Promise<TickerItem[]> {
  const [q, c] = await Promise.all([
    db.from('market_quotes').select('*').in('symbol', [...TICKER_SYMBOLS]),
    db
      .from('commodity_prices')
      .select('commodity, price, price_date')
      .order('price_date', { ascending: false })
      .limit(8),
  ]);
  if (q.error) throw q.error;
  if (c.error) throw c.error;
  return tickerItems((q.data ?? []).map(rowToQuote), commoditiesFromRows(c.data ?? []));
}
