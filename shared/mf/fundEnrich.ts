/**
 * Mutual-fund enrichment for the holdings board.
 * -----------------------------------------------------------------------------
 * Registrar feeds identify a fund by its RTA scheme code and a free-text name —
 * no ISIN for CAMS — so we resolve each holding to an AMFI scheme BY NAME
 * against the published NAV table, then read:
 *
 *   - the last two NAVs  → the real 1-day move (applied to the holding's value)
 *   - mf_scheme_cache    → category and the fund's own 1Y / 3Y returns
 *
 * Matching is conservative: the normalised core names must be EQUAL and the
 * plan (Regular/Direct) and option (Growth/IDCW) must agree with what the
 * holding says (registrar holdings under our ARN are Regular unless stated).
 * A match is also rejected when its NAV disagrees with the registrar's own NAV
 * by more than 15% — that is a different scheme, not a market move.
 *
 * Everything is best-effort: any failure leaves the row exactly as it was.
 * Reads nav_daily (authenticated) and mf_scheme_cache (public) only, so it works
 * from the client and partner surfaces alike.
 */
import type { NiyomDb } from '../platform/db';
import type { InvestmentRow } from '../portal/investments/model';

const NOISE = new Set([
  'direct', 'regular', 'plan', 'option', 'growth', 'idcw', 'dividend', 'payout',
  'reinvestment', 'reinvest', 'fund', 'scheme', 'mutual', 'the', 'gr', 'opt',
]);

export function coreFundName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !NOISE.has(w))
    .join(' ')
    .trim();
}

const isDirect = (s: string) => /\bdirect\b/i.test(s);
const isIdcw = (s: string) => /idcw|dividend|bonus/i.test(s);

interface NavRow {
  isin: string;
  amfi_code: string | null;
  scheme_name: string | null;
  nav: number | string;
  nav_date: string;
}

interface Match {
  isin: string;
  amfiCode: string | null;
  lastNav: number;
  lastDate: string;
  prevNav: number | null;
}

/** Prefix used to pull candidates: the first three words of the core name. */
function prefixOf(core: string): string | null {
  const words = core.split(' ').filter(Boolean);
  if (!words.length) return null;
  return words.slice(0, Math.min(3, words.length)).join(' ');
}

export function pickCandidate(name: string, cands: NavRow[]): NavRow | null {
  const core = coreFundName(name);
  const wantDirect = isDirect(name);
  const wantIdcw = isIdcw(name);
  const same = cands.filter((c) => c.scheme_name && coreFundName(c.scheme_name) === core);
  if (!same.length) return null;
  const exact = same.filter(
    (c) => isDirect(c.scheme_name!) === wantDirect && isIdcw(c.scheme_name!) === wantIdcw,
  );
  const pool = exact.length ? exact : same.filter((c) => isDirect(c.scheme_name!) === wantDirect);
  // Several share classes can survive (e.g. retail/institutional); stable pick.
  return pool.sort((a, b) => a.isin.localeCompare(b.isin))[0] ?? null;
}

/** Escape LIKE wildcards and PostgREST or() separators in a user-ish string. */
const likeSafe = (s: string) => s.replace(/[%_,()]/g, ' ').replace(/\s+/g, '%');

export async function enrichMutualFunds(db: NiyomDb, rows: InvestmentRow[]): Promise<InvestmentRow[]> {
  const mf = rows.filter((r) => r.asset === 'mutual_fund' && r.name);
  if (!mf.length) return rows;
  try {
    // 1. Latest NAV date (index-backed).
    const latest = await db.from('nav_daily').select('nav_date').order('nav_date', { ascending: false }).limit(1).maybeSingle();
    const latestDate = (latest.data?.nav_date as string | undefined) ?? null;
    if (!latestDate) return rows;

    const prefixes = [...new Set(mf.map((r) => prefixOf(coreFundName(r.name))).filter(Boolean) as string[])];
    if (!prefixes.length) return rows;
    const orClause = prefixes.map((p) => `scheme_name.ilike.${likeSafe(p)}%`).join(',');

    // 2. Candidates on the latest date; a fund missing that day (AMC published
    //    late) is retried over the previous week.
    const fetchCands = async (since: string, until: string) => {
      const { data } = await db
        .from('nav_daily')
        .select('isin,amfi_code,scheme_name,nav,nav_date')
        .gte('nav_date', since)
        .lte('nav_date', until)
        .or(orClause)
        .limit(2000);
      return (data ?? []) as NavRow[];
    };
    let cands = await fetchCands(latestDate, latestDate);
    const chosen = new Map<string, NavRow>();
    for (const r of mf) {
      const c = pickCandidate(r.name, cands);
      if (c) chosen.set(r.id, c);
    }
    if (chosen.size < mf.length) {
      const weekAgo = new Date(new Date(latestDate).getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
      cands = await fetchCands(weekAgo, latestDate);
      for (const r of mf) {
        if (chosen.has(r.id)) continue;
        const c = pickCandidate(r.name, cands);
        if (c) chosen.set(r.id, c);
      }
    }
    if (!chosen.size) return rows;

    // 3. Last two NAVs per matched ISIN (pk index on isin, nav_date).
    const isins = [...new Set([...chosen.values()].map((c) => c.isin))];
    const since = new Date(new Date(latestDate).getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
    const [navRes, cacheRes] = await Promise.all([
      db.from('nav_daily').select('isin,nav,nav_date').in('isin', isins).gte('nav_date', since).order('nav_date', { ascending: false }),
      db
        .from('mf_scheme_cache')
        .select('scheme_code,amfi_category,category,return_1y,return_3y,fund_house')
        .in('scheme_code', [...new Set([...chosen.values()].map((c) => c.amfi_code).filter(Boolean) as string[])]),
    ]);
    const navs = new Map<string, Array<{ nav: number; date: string }>>();
    for (const r of (navRes.data ?? []) as Array<{ isin: string; nav: number | string; nav_date: string }>) {
      const list = navs.get(r.isin) ?? [];
      list.push({ nav: Number(r.nav), date: r.nav_date });
      navs.set(r.isin, list);
    }
    const cache = new Map<string, Record<string, unknown>>();
    for (const c of (cacheRes.data ?? []) as Array<Record<string, unknown>>) cache.set(String(c.scheme_code), c);

    const matches = new Map<string, Match>();
    for (const [rowId, c] of chosen) {
      const list = navs.get(c.isin) ?? [];
      if (!list.length) continue;
      matches.set(rowId, {
        isin: c.isin,
        amfiCode: c.amfi_code,
        lastNav: list[0].nav,
        lastDate: list[0].date,
        prevNav: list[1]?.nav ?? null,
      });
    }

    return rows.map((r) => {
      const m = matches.get(r.id);
      if (!m || !(m.lastNav > 0)) return r;
      // Sanity: the registrar's own price must agree with the matched scheme.
      const ownPrice = r.price ?? (r.units ? r.value / r.units : null);
      if (ownPrice && ownPrice > 0 && Math.abs(m.lastNav / ownPrice - 1) > 0.15) return r;
      const c = m.amfiCode ? cache.get(m.amfiCode) : undefined;
      const movePct = m.prevNav && m.prevNav > 0 ? (m.lastNav / m.prevNav - 1) * 100 : null;
      const dayChange = movePct != null ? r.value - r.value / (1 + movePct / 100) : null;
      const num = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
      const category = (c?.amfi_category as string) || (c?.category as string) || r.category || null;
      return {
        ...r,
        isin: r.isin ?? m.isin,
        price: r.price ?? m.lastNav,
        navDate: r.navDate ?? m.lastDate,
        dayChange,
        dayChangePct: movePct,
        category: category ? category.replace(/^(Equity|Debt|Hybrid|Other) Schemes? - /i, '') : null,
        fundReturn1y: num(c?.return_1y),
        fundReturn3y: num(c?.return_3y),
        amc: r.amc ?? ((c?.fund_house as string) || null),
      };
    });
  } catch {
    return rows;
  }
}
