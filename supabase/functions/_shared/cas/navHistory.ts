/**
 * NAV on a date in the past — for grandfathering, and nothing else so far.
 *
 * ## Why one specific day matters so much
 *
 * Equity units bought before 01-Feb-2018 are grandfathered under s.55(2)(ac):
 * the gains that accrued up to 31-Jan-2018 are exempt, and the cost of
 * acquisition becomes a formula built around that day's NAV. Without it, a unit
 * bought in 2005 is taxed on twenty years of growth that Parliament exempted.
 *
 * Across the book today that is 639 purchases in 16 schemes belonging to two
 * clients — with the oldest transaction dated 16-Jul-2005, so this is a live
 * concern rather than a theoretical one. `nav_daily` starts in 2012 and carried
 * 31-Jan-2018 for exactly three of its 17,662 ISINs, so the figure had to come
 * from somewhere.
 *
 * ## A different file from the daily one
 *
 * AMFI serves history from a different endpoint, in a DIFFERENT COLUMN ORDER:
 *
 *   daily      Scheme Code;ISIN Growth;ISIN Reinvest;Scheme Name;Plan;Option;NAV;Date
 *   historical Scheme Code;NAV Name;Plan;Option;ISIN Growth;ISIN Reinvest;NAV;Date
 *
 * Name and ISINs are swapped. Feeding one to the other's parser does not fail —
 * it reads a scheme NAME as an ISIN, finds no match, and returns nothing at
 * all, or worse, pairs a real ISIN with a price that is not the NAV. So this
 * has its own parser on purpose, and the two are tested against their own real
 * fixtures.
 *
 * ## Both layouts, read from the header
 *
 * On 19-Aug-2026 AMFI restructured this report too: `Plan` and `Option` became
 * columns, and the `Repurchase Price` and `Sale Price` columns went away. It
 * still splits into eight parts, so the column COUNT that used to keep the two
 * files apart proves nothing any more — the ISINs simply moved from positions
 * 2 and 3 to positions 4 and 5. Read by position, the old reader took `Plan`
 * as an ISIN and matched nothing, so the backfill quietly returned zero rows
 * for every date. The header decides the columns now, and both layouts parse.
 *
 * The headings are also spaced differently (`Schemes ( Income )` rather than
 * `Schemes(Income)`), which the shared heading reader normalises.
 */
import { COLUMN, columnIndex, composeSchemeName, readHeaderCells } from './amfiColumns.ts';
import { sbInsert, type SbConfig } from './db.ts';
import type { NavRow } from './nav.ts';

/** An ISIN as AMFI writes it. Both files use the same form. */
const ISIN = /^INF[A-Z0-9]{9}$/;

/** AMFI's historical NAV report. One day per request is enough for our use. */
const HISTORY_URL = 'https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx';

const FETCH_TIMEOUT_MS = 90_000;

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "31-Jan-2018" -> "2018-01-31". Empty for anything unrecognised. */
function toIso(d: string): string {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(d.trim());
  const mm = m ? MONTHS[m[2].toLowerCase()] : null;
  return m && mm ? `${m[3]}-${mm}-${m[1].padStart(2, '0')}` : '';
}

/** "2018-01-31" -> "31-Jan-2018", the only date format the endpoint accepts. */
export function toAmfiDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new Error(`expected an ISO date, got "${iso}"`);
  const month = MONTH_NAMES[Number(m[2]) - 1];
  if (!month) throw new Error(`not a real month: "${iso}"`);
  return `${m[3]}-${month}-${m[1]}`;
}

/** Where each field sits on a row of the historical report. */
interface HistoryLayout {
  code: number;
  name: number;
  plan: number;
  option: number;
  isinA: number;
  isinB: number;
  nav: number;
  date: number;
  width: number;
}

/** 19-Aug-2026 onwards: plan and option in, the two price columns out. */
const HISTORY_WITH_PLAN: HistoryLayout = {
  code: 0, name: 1, plan: 2, option: 3, isinA: 4, isinB: 5, nav: 6, date: 7, width: 8,
};

/** The older report, still the shape of the 31-Jan-2018 fixture. */
const HISTORY_LEGACY: HistoryLayout = {
  code: 0, name: 1, plan: -1, option: -1, isinA: 2, isinB: 3, nav: 4, date: 7, width: 8,
};

/**
 * The historical layout a header row describes, or null for a foreign file.
 *
 * This report names its scheme BEFORE its ISINs; the daily file is the other
 * way round. Refusing the daily header is what keeps a `Plan` column from being
 * read as an ISIN, or a scheme name as a price.
 */
function historyLayoutFromHeader(cells: string[]): HistoryLayout | null {
  const code = columnIndex(cells, COLUMN.code);
  const name = columnIndex(cells, COLUMN.name);
  const isinA = columnIndex(cells, COLUMN.isinPayout);
  const isinB = columnIndex(cells, COLUMN.isinReinvest);
  const nav = columnIndex(cells, COLUMN.nav);
  const date = columnIndex(cells, COLUMN.date);
  if (code < 0 || name < 0 || isinA < 0 || nav < 0 || date < 0) return null;
  // The daily file's ISINs come before its name column. Not our file.
  if (isinA < name) return null;
  return {
    code,
    name,
    plan: columnIndex(cells, COLUMN.plan),
    option: columnIndex(cells, COLUMN.option),
    isinA,
    isinB,
    nav,
    date,
    width: Math.max(code, name, isinA, isinB, nav, date) + 1,
  };
}

/**
 * With no header in hand — a fragment, or a truncated download — the layout is
 * whichever one puts a real ISIN where it expects one AND a number where it
 * expects a NAV. Both candidates are eight columns wide, so nothing else
 * separates them, and a row that satisfies neither is left alone.
 */
function inferHistoryLayout(parts: string[]): HistoryLayout | null {
  for (const cols of [HISTORY_LEGACY, HISTORY_WITH_PLAN]) {
    if (parts.length < cols.width) continue;
    const looksIsin = [cols.isinA, cols.isinB].some((i) =>
      ISIN.test((parts[i] ?? '').trim().toUpperCase())
    );
    const navValue = Number((parts[cols.nav] ?? '').trim());
    if (looksIsin && Number.isFinite(navValue) && navValue > 0) return cols;
  }
  return null;
}

/** The scheme's full name: what the newer report spreads over three columns. */
function fullName(parts: string[], layout: HistoryLayout): string {
  const at = (i: number) => (i >= 0 ? (parts[i] ?? '').trim() : '');
  return composeSchemeName(at(layout.name), at(layout.plan), at(layout.option));
}

/**
 * The historical report -> NAV rows.
 *
 * Reads its columns from the header, and accepts only a header of this
 * report's shape, so pointing it at the daily file returns nothing rather than
 * quietly reading the wrong columns.
 */
export function parseAmfiNavHistory(text: string): NavRow[] {
  const out: NavRow[] = [];
  const seen = new Set<string>();
  let layout: HistoryLayout | null = null;

  for (const line of text.split('\n')) {
    const header = readHeaderCells(line);
    if (header) {
      layout = historyLayoutFromHeader(header);
      // A header naming the daily file: read nothing rather than guess.
      if (!layout) return [];
      continue;
    }

    const parts = line.split(';');
    const cols = layout ?? inferHistoryLayout(parts);
    if (!cols || parts.length < cols.width) continue; // heading, AMC name or blank

    const code = parts[cols.code] ?? '';
    const isinA = parts[cols.isinA] ?? '';
    const isinB = cols.isinB >= 0 ? (parts[cols.isinB] ?? '') : '';
    const name = fullName(parts, cols);

    const nav = Number((parts[cols.nav] ?? '').trim());
    if (!Number.isFinite(nav) || nav <= 0) continue;

    const navDate = toIso(parts[cols.date] ?? '');
    if (!navDate) continue;

    for (const isin of [isinA, isinB]) {
      const clean = isin.trim().toUpperCase();
      if (!ISIN.test(clean)) continue;
      const key = `${clean}|${navDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        isin: clean,
        nav_date: navDate,
        nav,
        scheme_name: name.trim(),
        amfi_code: code.trim(),
      });
    }
  }
  return out;
}

export interface NavBackfillResult {
  ok: boolean;
  date: string;
  parsed: number;
  written: number;
  error?: string;
}

/**
 * Fetch one past day's NAVs for every scheme and store them.
 *
 * The whole day is fetched rather than the ISINs we happen to need, because the
 * set we need grows every time a client with an old portfolio imports a
 * statement. One request covering all ~11,800 schemes settles 31-Jan-2018
 * permanently; the alternative is discovering a missing NAV halfway through
 * computing somebody's tax.
 *
 * Upserts on (isin, nav_date), so re-running is harmless.
 */
export async function backfillNavOn(cfg: SbConfig, isoDate: string): Promise<NavBackfillResult> {
  let parsed = 0;
  let written = 0;

  try {
    const day = toAmfiDate(isoDate);
    const url = `${HISTORY_URL}?frmdt=${day}&todt=${day}`;

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`AMFI responded ${res.status}`);

    const rows = parseAmfiNavHistory(await res.text());
    parsed = rows.length;
    if (!parsed) {
      // A market holiday returns a valid, empty report. Saying so is better
      // than writing nothing and reporting success.
      throw new Error(`AMFI returned no rows for ${day} — a non-trading day, or the layout changed.`);
    }

    for (let i = 0; i < rows.length; i += 1000) {
      await sbInsert(cfg, 'nav_daily?on_conflict=isin,nav_date', rows.slice(i, i + 1000), {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      });
      written += Math.min(1000, rows.length - i);
    }

    return { ok: true, date: isoDate, parsed, written };
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    console.error(`[nav] backfill ${isoDate} failed:`, message);
    return { ok: false, date: isoDate, parsed, written, error: message };
  }
}

/**
 * The day equity grandfathering is measured on.
 *
 * 31-Jan-2018 was a Wednesday and a trading day, so a NAV exists for every
 * scheme that was open then.
 */
export const GRANDFATHER_DATE = '2018-01-31';
