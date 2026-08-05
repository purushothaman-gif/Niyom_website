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
 *   daily      Scheme Code;ISIN Growth;ISIN Reinvest;Scheme Name;NAV;Date
 *   historical Scheme Code;Scheme Name;ISIN Growth;ISIN Reinvest;NAV;Repurchase;Sale;Date
 *
 * Name and ISINs are swapped and there are two extra price columns. Feeding it
 * to `parseAmfiNav` does not fail — it reads the scheme NAME as an ISIN, finds
 * no match, and returns nothing at all, or worse, pairs a real ISIN with the
 * repurchase price. So this has its own parser on purpose, and the two are
 * tested against their own real fixtures.
 *
 * The headings are also spaced differently (`Schemes ( Income )` rather than
 * `Schemes(Income)`), which the shared heading reader normalises.
 */
import { sbInsert, type SbConfig } from './db.js';
import type { NavRow } from './nav.js';

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

/**
 * The historical report -> NAV rows.
 *
 * Deliberately strict about the column count: a row is a row when it splits
 * into EIGHT parts. The daily file's rows split into six, so if the two
 * endpoints are ever crossed by mistake this returns nothing rather than
 * quietly reading the wrong columns.
 */
export function parseAmfiNavHistory(text: string): NavRow[] {
  const out: NavRow[] = [];
  const seen = new Set<string>();

  for (const line of text.split('\n')) {
    const parts = line.split(';');
    if (parts.length < 8) continue; // heading, AMC name or blank

    const [code, name, isinA, isinB, navRaw, , , dateRaw] = parts;
    if (code.trim() === 'Scheme Code') continue; // the header row itself

    const nav = Number(navRaw.trim());
    if (!Number.isFinite(nav) || nav <= 0) continue;

    const navDate = toIso(dateRaw);
    if (!navDate) continue;

    for (const isin of [isinA, isinB]) {
      const clean = isin.trim().toUpperCase();
      if (!/^INF[A-Z0-9]{9}$/.test(clean)) continue;
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
