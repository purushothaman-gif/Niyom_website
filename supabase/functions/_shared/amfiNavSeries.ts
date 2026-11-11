/**
 * AMFI per-scheme NAV history, and the compact series it is stored as.
 * -----------------------------------------------------------------------------
 * AMFI's website serves one scheme's NAV history as JSON:
 *
 *   GET https://www.amfiindia.com/api/nav-history
 *         ?query_type=historical_period&sd_id=<scheme code>
 *         &from_date=YYYY-MM-DD&to_date=YYYY-MM-DD
 *
 * What probing it on 2026-11-12 established (it is not a documented API):
 *
 *   - The range must be under five years, or it answers 400.
 *   - It is slow in proportion to the range: ~20–60 s for five years, well
 *     under a second for a fortnight. Hence modest windows, fetched in the
 *     background, never while a client waits.
 *   - About three requests at once are tolerated; a fourth gets 429.
 *   - No data in the range is a 200 with { message: "No records to display" }.
 *
 * The result is stored in `mf_nav_series` as two parallel arrays — day numbers
 * (days since 1970-01-01) and NAVs — which is also the shape this module hands
 * back, so nothing is reshaped between AMFI and the database.
 */
import type { NavPoint } from './mfReturns.ts';

export const AMFI_HISTORY_API = 'https://www.amfiindia.com/api/nav-history';

/** Days per fetched window. ~2.5 years: quick enough to rarely time out. */
export const WINDOW_DAYS = 900;

/** AMFI's history begins in April 2006; nothing to look for before this. */
export const HISTORY_FLOOR = '2006-01-01';

const DAY_MS = 86_400_000;

export interface NavArrays {
  d: number[];
  n: number[];
}

export const isoToDay = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
export const dayToIso = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** Today's date in India, where the NAV calendar lives. */
export function todayIst(now = Date.now()): string {
  return new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The window to fetch next when walking a scheme's history backwards.
 * `cursorTo` is the end date still to be covered; null means "start at today".
 */
export function windowEndingAt(cursorTo: string | null, today = todayIst()): { from: string; to: string } {
  const to = cursorTo ?? today;
  return { from: dayToIso(isoToDay(to) - (WINDOW_DAYS - 1)), to };
}

interface AmfiRecord {
  date?: string;
  nav?: number | string;
}
interface AmfiHistory {
  data?: { nav_groups?: { nav_name?: string; historical_records?: AmfiRecord[] }[] };
  message?: string;
  error?: string;
}

/** AMFI's JSON → ascending, one-per-day arrays. Unusable rows are dropped. */
export function parseAmfiHistory(body: unknown): NavArrays {
  const groups = (body as AmfiHistory)?.data?.nav_groups ?? [];
  const byDay = new Map<number, number>();
  for (const g of groups) {
    for (const r of g?.historical_records ?? []) {
      const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(r?.date ?? ''));
      const nav = Number(r?.nav);
      if (!m || !Number.isFinite(nav) || nav <= 0) continue;
      const day = isoToDay(m[1]);
      if (!byDay.has(day)) byDay.set(day, nav);
    }
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  return { d: days, n: days.map((x) => byDay.get(x) as number) };
}

/**
 * One fetch, three honest outcomes — the same distinction the returns job
 * learned the hard way: a timeout or a 429 tells us NOTHING about the scheme
 * and must never be recorded as "no history".
 */
export type AmfiFetch =
  | { status: 'ok'; series: NavArrays }
  | { status: 'empty' }
  | { status: 'transient'; reason: string };

export async function fetchAmfiWindow(
  code: string,
  from: string,
  to: string,
  // Older stretches of history are the slow ones; 50 s was not always enough.
  timeoutMs = 90_000,
): Promise<AmfiFetch> {
  const url =
    `${AMFI_HISTORY_API}?query_type=historical_period&sd_id=${encodeURIComponent(code)}` +
    `&from_date=${from}&to_date=${to}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; nav-history-sync)' },
    });
    if (!res.ok) return { status: 'transient', reason: `AMFI answered ${res.status}` };
    const body = (await res.json()) as AmfiHistory;
    if (body?.error) return { status: 'transient', reason: `AMFI: ${String(body.error).slice(0, 120)}` };
    const series = parseAmfiHistory(body);
    if (series.d.length) return { status: 'ok', series };
    // An explicit "no records" (or a well-formed body with none) is a verdict.
    if (body?.message || body?.data) return { status: 'empty' };
    return { status: 'transient', reason: 'AMFI sent an unrecognised body' };
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    return { status: 'transient', reason: aborted ? 'AMFI timed out' : `AMFI unreachable: ${(err as Error)?.message ?? ''}` };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ Reading the store ----------------------------- */

/** Stored arrays → the newest-first "dd-mm-yyyy" points the returns maths reads. */
export function seriesToNavPoints(series: NavArrays): NavPoint[] {
  const out: NavPoint[] = new Array(series.d.length);
  for (let i = series.d.length - 1, j = 0; i >= 0; i--, j++) {
    const iso = dayToIso(series.d[i]);
    out[j] = { date: `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`, nav: String(series.n[i]) };
  }
  return out;
}

/**
 * A scheme's stored history, or null when it is not fully loaded yet.
 * `supabase` is a service-role client (the table is closed to everyone else).
 */
// deno-lint-ignore no-explicit-any
export async function readNavSeries(supabase: any, code: string): Promise<NavArrays | null> {
  try {
    const { data, error } = await supabase
      .from('mf_nav_series')
      .select('d, n, status')
      .eq('amfi_code', code)
      .maybeSingle();
    if (error || !data) return null;
    if (data.status !== 'loaded' && data.status !== 'tail') return null;
    const d = (data.d ?? []) as number[];
    const n = (data.n ?? []) as number[];
    return d.length >= 2 && d.length === n.length ? { d, n } : null;
  } catch {
    return null;
  }
}

export interface SchemeMeta {
  scheme_name: string;
  scheme_category: string | null;
  scheme_type: string | null;
  fund_house: string | null;
}

/**
 * Who a scheme is, from AMFI's own scheme master (mf_asset_class) — the name,
 * category and fund house that used to be read off mfapi.in's response.
 */
// deno-lint-ignore no-explicit-any
export async function readSchemeMeta(supabase: any, code: string): Promise<SchemeMeta> {
  let master: { scheme_name?: string; amfi_category?: string | null; scheme_type?: string | null; amc_name?: string | null } | null = null;
  let house: string | null = null;
  try {
    const a = await supabase.from('mf_asset_class')
      .select('scheme_name, amfi_category, scheme_type, amc_name')
      .eq('amfi_code', code).limit(1).maybeSingle();
    master = a.data ?? null;
    const c = await supabase.from('mf_scheme_cache').select('fund_house').eq('scheme_code', code).maybeSingle();
    house = c.data?.fund_house || null;
  } catch {
    // descriptive only — never fail a request over it
  }
  return {
    scheme_name: master?.scheme_name ?? `Scheme ${code}`,
    scheme_category: master?.amfi_category ?? null,
    scheme_type: master?.scheme_type ?? null,
    fund_house: house ?? master?.amc_name ?? null,
  };
}

/** Ask for a scheme's history to be loaded ahead of the bulk queue. Best-effort. */
// deno-lint-ignore no-explicit-any
export async function requestNavSeries(supabase: any, code: string, priority = 0): Promise<void> {
  try {
    await supabase.rpc('mf_nav_series_enqueue', { p_codes: [code], p_priority: priority });
  } catch {
    // The nightly seed will pick it up; never fail a request over the queue.
  }
}
