/**
 * Daily NAV from AMFI.
 *
 * ## Why not BSE
 *
 * BSE StAR MF is the order rail. A distributor cannot transact direct plans on
 * it, and direct plans are most of what turns up in a real CAS — five of six
 * holdings on the first live import. `get_mis_detail` already answers `authz`
 * for our member tier, so entitlement to `nav_master_list` cannot be assumed
 * either. AMFI publishes every scheme from every AMC, free and without a login,
 * keyed by the same ISIN a CAS carries.
 *
 * ## Why "live" is a day, not a second
 *
 * A mutual fund NAV is struck once, after the market closes. There is no
 * intraday price to fetch and nothing here polls for one. The most current a
 * fund portfolio can ever be is last night's close, and saying otherwise to a
 * client would be inventing precision that does not exist.
 *
 * ## The file
 *
 *   Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
 *   119551;INF209KA12Z1;INF209KA13Z9;Aditya Birla ...;100.7401;31-Jul-2026
 *
 * Interleaved with blank lines, AMC names and category headings, none of which
 * carry semicolons — so a row is a row precisely when it splits into six parts.
 * Both ISIN columns point at the same NAV (growth/payout and reinvestment are
 * separate ISINs for one scheme), and either may be blank or "-".
 */
import type { ProxyConfig } from '../config.js';
import { sbInsert, sbSelect } from './db.js';

const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';

/** 1.6 MB over a link we do not control; generous, but not unbounded. */
const FETCH_TIMEOUT_MS = 60_000;

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** "31-Jul-2026" -> "2026-07-31". Empty for anything unrecognised. */
function toIso(d: string): string {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(d.trim());
  const mm = m ? MONTHS[m[2].toLowerCase()] : null;
  return m && mm ? `${m[3]}-${mm}-${m[1].padStart(2, '0')}` : '';
}

export interface NavRow {
  isin: string;
  nav_date: string;
  nav: number;
  scheme_name: string;
  amfi_code: string;
}

/**
 * AMFI's text file -> rows.
 *
 * Exported and pure so it can be tested against real fixture lines rather than
 * only against whatever the network returns today.
 */
export function parseAmfiNav(text: string): NavRow[] {
  const out: NavRow[] = [];
  const seen = new Set<string>();

  for (const line of text.split('\n')) {
    const parts = line.split(';');
    if (parts.length < 6) continue; // heading, AMC name or blank

    const [code, isinA, isinB, name, navRaw, dateRaw] = parts;
    if (code.trim() === 'Scheme Code') continue; // the header row itself

    const nav = Number(navRaw.trim());
    // "N.A." for schemes yet to declare — a real absence, not a zero.
    if (!Number.isFinite(nav) || nav <= 0) continue;

    const navDate = toIso(dateRaw);
    if (!navDate) continue;

    // One scheme carries two ISINs (growth/payout and reinvestment) against the
    // same NAV. A CAS may reference either, so both are stored.
    for (const isin of [isinA, isinB]) {
      const clean = isin.trim().toUpperCase();
      if (!/^INF[A-Z0-9]{9}$/.test(clean)) continue;
      const key = `${clean}|${navDate}`;
      if (seen.has(key)) continue; // the file repeats a scheme across categories
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

export interface NavRefreshResult {
  ok: boolean;
  parsed: number;
  written: number;
  navDate: string | null;
  error?: string;
}

/**
 * Fetch, parse and store today's NAVs.
 *
 * Every run is logged whether it succeeds or not. A NAV feed that quietly stops
 * updating is worse than one that is plainly absent: the client keeps seeing a
 * number that looks current and is not, and nothing about the screen says so.
 */
export async function refreshNavs(cfg: ProxyConfig): Promise<NavRefreshResult> {
  const startedAt = new Date().toISOString();
  let parsed = 0;
  let written = 0;
  let navDate: string | null = null;

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(AMFI_URL, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`AMFI responded ${res.status}`);

    const rows = parseAmfiNav(await res.text());
    parsed = rows.length;
    if (!parsed) throw new Error('AMFI returned no usable rows — the file layout may have changed.');

    // The date the bulk of the file carries, for the log and for /health.
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.nav_date, (counts.get(r.nav_date) ?? 0) + 1);
    navDate = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    /*
     * Upsert on the (isin, nav_date) primary key: a refresh run twice in one day
     * must not fail, and a corrected NAV must land. Chunked because this is
     * ~17k rows and PostgREST has a request size limit.
     */
    for (let i = 0; i < rows.length; i += 1000) {
      await sbInsert(cfg, 'nav_daily?on_conflict=isin,nav_date', rows.slice(i, i + 1000), {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      });
      written += Math.min(1000, rows.length - i);
    }

    await sbInsert(cfg, 'nav_refresh_log', [
      { started_at: startedAt, finished_at: new Date().toISOString(), ok: true, rows_parsed: parsed, rows_written: written, nav_date: navDate },
    ]);
    return { ok: true, parsed, written, navDate };
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    console.error('[nav] refresh failed:', message);
    await sbInsert(cfg, 'nav_refresh_log', [
      { started_at: startedAt, finished_at: new Date().toISOString(), ok: false, rows_parsed: parsed, rows_written: written, nav_date: navDate, error: message.slice(0, 500) },
    ]).catch(() => undefined);
    return { ok: false, parsed, written, navDate, error: message };
  }
}

/** The most recent refresh, for /health. Null when none has ever run. */
export async function lastNavRefresh(
  cfg: ProxyConfig,
): Promise<{ at: string; ok: boolean; navDate: string | null } | null> {
  try {
    const [row] = await sbSelect<{ finished_at: string; ok: boolean; nav_date: string | null }>(
      cfg,
      'nav_refresh_log?select=finished_at,ok,nav_date&order=started_at.desc&limit=1',
    );
    return row ? { at: row.finished_at, ok: row.ok, navDate: row.nav_date } : null;
  } catch {
    return null;
  }
}
