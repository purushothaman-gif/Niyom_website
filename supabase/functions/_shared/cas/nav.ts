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
 *
 * ## The headings are data too
 *
 * Those category headings used to be skipped as noise. They are the only source
 * we have for whether a scheme is equity-oriented — which decides its holding
 * period and its tax rate — because a CAS never states a category and
 * `cas_schemes.scheme_type` is blank on every row. So the same pass that reads
 * NAVs now also tracks the heading each scheme sits under and writes it to
 * `mf_asset_class`. One regex over a file already being fetched.
 */
import { classifyCategory, readCategoryHeading } from './assetClass.ts';
import { sbInsert, sbSelect, type SbConfig } from './db.ts';

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

/** An `mf_asset_class` row, ready to upsert. */
export interface SchemeClassRow {
  isin: string;
  amfi_code: string;
  scheme_name: string;
  amfi_category: string;
  asset_class: 'equity' | 'debt' | 'other';
  ambiguous: boolean;
}

/**
 * One row per AMFI scheme code, for the scheme universe (`mf_scheme_cache`).
 *
 * nav_daily is keyed by ISIN because a CAS references holdings that way. The
 * research tools key by scheme code instead, and deriving one from the other
 * later would mean a second pass over 17k rows — so the parse emits both while
 * it already has the line in hand.
 */
export interface SchemeNavRow {
  scheme_code: string;
  scheme_name: string;
  current_nav: number;
  nav_date: string;
  /** The AMC, as AMFI names it. Empty only if a scheme precedes any heading. */
  fund_house: string;
}

export interface AmfiFile {
  navs: NavRow[];
  /** One per ISIN — the category it was printed under, and what that means. */
  classes: SchemeClassRow[];
  /** One per scheme code, for the research universe. */
  schemeNavs: SchemeNavRow[];
}

/**
 * AMFI's text file -> NAV rows and scheme classifications.
 *
 * Exported and pure so it can be tested against real fixture lines rather than
 * only against whatever the network returns today.
 */
export function parseAmfiNav(text: string): AmfiFile {
  const navs: NavRow[] = [];
  const classes: SchemeClassRow[] = [];
  const schemeNavs: SchemeNavRow[] = [];
  const seen = new Set<string>();
  const classified = new Set<string>();
  const seenScheme = new Set<string>();

  /*
   * The heading most recently passed. Every scheme line below it belongs to it,
   * which is the only thing in the file that says what a scheme holds.
   */
  let category = '';

  /*
   * The AMC most recently named, on the same "heading applies downward" basis.
   *
   * AMFI states the fund house as its own line above each block — 52 of them in
   * the current file, spelled consistently. That is worth taking: the previous
   * fund_house was the first three words of the scheme name, which turns
   * "Axis Multicap Fund" and "Franklin India SHORT" into fund HOUSES and leaves
   * a browse-by-AMC screen listing thousands of one-fund houses instead of 52.
   */
  let fundHouse = '';

  for (const line of text.split('\n')) {
    const parts = line.split(';');
    if (parts.length < 6) {
      // Not a scheme row — but it may be the heading that names the next batch.
      const heading = readCategoryHeading(line);
      if (heading) {
        category = heading;
      } else {
        /*
         * Everything else that is not a scheme row and names a fund house.
         * Checked after the category test because AMFI has headings that also
         * mention an AMC (e.g. "IL&FS Mutual Fund (IDF)"), and those are
         * categories first.
         */
        const trimmed = line.trim();
        if (trimmed && /mutual fund/i.test(trimmed)) fundHouse = trimmed;
      }
      continue;
    }

    const [code, isinA, isinB, name, navRaw, dateRaw] = parts;
    if (code.trim() === 'Scheme Code') continue; // the header row itself

    const nav = Number(navRaw.trim());
    // "N.A." for schemes yet to declare — a real absence, not a zero.
    const hasNav = Number.isFinite(nav) && nav > 0;
    const navDate = toIso(dateRaw);

    /*
     * Scheme-code NAV, recorded once per code.
     *
     * Deliberately outside the ISIN loop below: a scheme carries two ISINs but
     * only one code, so collecting it there would emit duplicates, and a scheme
     * whose ISIN fields are blank or malformed would be skipped entirely — it
     * still has a code, a name and a NAV the research tools want.
     */
    const schemeCode = code.trim();
    if (hasNav && navDate && schemeCode && !seenScheme.has(schemeCode)) {
      seenScheme.add(schemeCode);
      schemeNavs.push({
        scheme_code: schemeCode,
        scheme_name: name.trim(),
        current_nav: nav,
        nav_date: navDate,
        fund_house: fundHouse,
      });
    }

    // One scheme carries two ISINs (growth/payout and reinvestment) against the
    // same NAV. A CAS may reference either, so both are stored.
    for (const isin of [isinA, isinB]) {
      const clean = isin.trim().toUpperCase();
      if (!/^INF[A-Z0-9]{9}$/.test(clean)) continue;

      if (hasNav && navDate) {
        const key = `${clean}|${navDate}`;
        if (!seen.has(key)) {
          seen.add(key);
          navs.push({
            isin: clean,
            nav_date: navDate,
            nav,
            scheme_name: name.trim(),
            amfi_code: code.trim(),
          });
        }
      }

      /*
       * Classification does NOT depend on the NAV.
       *
       * A fund that has wound up, or has not declared today, still sits under a
       * category heading — and still has years of transactions behind it that a
       * gains statement has to price. Gating this on a usable NAV cost us two of
       * the 82 ISINs held across the book, both of them closed funds whose units
       * were sold and are taxable.
       *
       * A scheme is classified once, under the FIRST heading it appears beneath.
       * AMFI repeats some schemes across categories, and taking the last would
       * let a duplicate listing silently change a fund's tax treatment between
       * one evening's file and the next.
       */
      if (category && !classified.has(clean)) {
        classified.add(clean);
        const { amfiCategory, assetClass, ambiguous } = classifyCategory(category);
        classes.push({
          isin: clean,
          amfi_code: code.trim(),
          scheme_name: name.trim(),
          amfi_category: amfiCategory,
          asset_class: assetClass,
          ambiguous,
        });
      }
    }
  }
  return { navs, classes, schemeNavs };
}

export interface NavRefreshResult {
  ok: boolean;
  parsed: number;
  written: number;
  navDate: string | null;
  /** Schemes whose category was captured this run. */
  classified?: number;
  /** Scheme-universe rows given a fresh NAV this run. */
  schemesWritten?: number;
  error?: string;
}

/**
 * Fetch, parse and store today's NAVs.
 *
 * Every run is logged whether it succeeds or not. A NAV feed that quietly stops
 * updating is worse than one that is plainly absent: the client keeps seeing a
 * number that looks current and is not, and nothing about the screen says so.
 */
export async function refreshNavs(cfg: SbConfig): Promise<NavRefreshResult> {
  const startedAt = new Date().toISOString();
  let parsed = 0;
  let written = 0;
  let classified = 0;
  let navDate: string | null = null;

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(AMFI_URL, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`AMFI responded ${res.status}`);

    const { navs: rows, classes, schemeNavs } = parseAmfiNav(await res.text());
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

    /*
     * Scheme classifications, upserted alongside.
     *
     * Only the AMFI-derived columns are sent, so `resolution=merge-duplicates`
     * updates exactly those and leaves `override_asset_class` untouched. An
     * administrator's decision about a Multi Asset fund must survive every
     * subsequent nightly refresh — otherwise the tax treatment silently reverts
     * to undecided and the client's statement changes overnight.
     */
    const now = new Date().toISOString();
    for (let i = 0; i < classes.length; i += 1000) {
      await sbInsert(
        cfg,
        'mf_asset_class?on_conflict=isin',
        classes.slice(i, i + 1000).map((c) => ({ ...c, updated_at: now })),
        { Prefer: 'resolution=merge-duplicates,return=minimal' },
      );
      classified += Math.min(1000, classes.length - i);
    }

    /*
     * Today's NAV onto the research universe (mf_scheme_cache).
     *
     * This job prices the universe; it does NOT decide who is in it. That
     * belongs to mf-universe, which keeps exactly one canonical row per fund —
     * the Direct-Growth plan — so a fund appears once rather than once per
     * plan-and-option permutation. AMFI's file is per plan/option, so it names
     * ~14,000 codes against a universe of ~5,000.
     *
     * Hence the filter to codes already cached. Upserting the raw file instead
     * inserts ~11,500 Regular/IDCW rows carrying nothing but a NAV — blank
     * fund_house and blank search_name, invisible to the ILIKE search and
     * silently tripling a table whose contract is one row per fund. Writing
     * only what is already there keeps membership in one place.
     *
     * Only the NAV columns and the AMC are sent, so merge-duplicates touches
     * exactly those and leaves category and the trailing returns — filled by
     * other feeds on other schedules — untouched.
     *
     * Best-effort throughout: this is a research convenience, and it must never
     * be the reason a refresh that already wrote nav_daily is logged as failed.
     */
    let schemesWritten = 0;
    try {
      const known = new Set<string>();
      // PostgREST caps a page at 1000 rows, so walk it.
      for (let offset = 0; ; offset += 1000) {
        const page = await sbSelect<{ scheme_code: string }>(
          cfg,
          `mf_scheme_cache?select=scheme_code&order=scheme_code&limit=1000&offset=${offset}`,
        );
        for (const row of page) known.add(row.scheme_code);
        if (page.length < 1000) break;
      }

      const priced = schemeNavs
        .filter((r) => known.has(r.scheme_code))
        .map(({ scheme_code, current_nav, nav_date, fund_house }) => ({
          scheme_code,
          current_nav,
          nav_date,
          // Never blank an existing house because one scheme sat above the
          // first heading; the guess it replaces is still better than nothing.
          ...(fund_house ? { fund_house } : {}),
        }));

      for (let i = 0; i < priced.length; i += 1000) {
        await sbInsert(
          cfg,
          'mf_scheme_cache?on_conflict=scheme_code',
          priced.slice(i, i + 1000),
          { Prefer: 'resolution=merge-duplicates,return=minimal' },
        );
      }
      schemesWritten = priced.length;
    } catch (schemeErr) {
      console.error('scheme-universe NAV write failed (nav_daily already written):', schemeErr);
    }

    await sbInsert(cfg, 'nav_refresh_log', [
      { started_at: startedAt, finished_at: new Date().toISOString(), ok: true, rows_parsed: parsed, rows_written: written, nav_date: navDate },
    ]);
    return { ok: true, parsed, written, navDate, classified, schemesWritten };
  } catch (err) {
    const message = (err as Error)?.message ?? 'unknown';
    console.error('[nav] refresh failed:', message);
    await sbInsert(cfg, 'nav_refresh_log', [
      { started_at: startedAt, finished_at: new Date().toISOString(), ok: false, rows_parsed: parsed, rows_written: written, nav_date: navDate, error: message.slice(0, 500) },
    ]).catch(() => undefined);
    return { ok: false, parsed, written, navDate, classified, error: message };
  }
}

/** The most recent refresh, for /health. Null when none has ever run. */
export async function lastNavRefresh(
  cfg: SbConfig,
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
