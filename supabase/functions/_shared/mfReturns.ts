/**
 * mfReturns — shared NAV-history maths for the MF Research backend.
 *
 * mfapi.in returns a scheme's NAV history newest-first as { date: "dd-mm-yyyy",
 * nav: "123.4567" }. Both `update-mutual-funds` (curated table) and `mf-detail`
 * (on-demand fund detail) compute returns from that same history, so the logic
 * lives here once.
 */

export interface NavPoint {
  date: string;
  nav: string;
}

/**
 * A period with no NAV history behind it is `null`, never 0.
 *
 * 0 is a real return — it means the fund went nowhere — so using it for "we
 * cannot compute this" put a factual-looking 0.00% on screen for periods that
 * simply predate the fund (or predate the history mfapi.in serves). The UI
 * renders null as an em dash.
 */
export interface FundMetrics {
  current_nav: number;
  nav_date: string | null; // ISO yyyy-mm-dd
  return_ytd: number | null;
  return_6m: number | null;
  return_1y: number | null;
  return_3y: number | null;
  return_5y: number | null;
  return_si: number | null; // since inception (annualised CAGR)
  high_52w: number;
  low_52w: number;
}

/** Parse mfapi.in "dd-mm-yyyy" into a Date (local midnight). */
export function parseDate(s: string): Date {
  const [d, m, y] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Format a Date as ISO yyyy-mm-dd (date only). */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * NAV closest to (but not after) `target`, scanning newest→oldest history.
 * Returns null when the history does not reach back that far.
 *
 * An unusable point (blank, zero, unparseable — AMFI history does contain
 * these) is SKIPPED rather than treated as the end of the history: one bad row
 * on the boundary date should not wipe out a period the fund has data for.
 */
export function navOnOrBefore(data: NavPoint[], target: Date): number | null {
  for (const p of data) {
    if (parseDate(p.date).getTime() <= target.getTime()) {
      const v = parseFloat(p.nav);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return null;
}

/** One-decimal percentage, e.g. 12.3. */
function pct(n: number): number {
  return Math.round(n * 1000) / 10;
}

/** Absolute (non-annualised) % change of `latest` over `past`, or null. */
function simpleReturn(latest: number, past: number | null): number | null {
  if (!past) return null;
  return pct(latest / past - 1);
}

/**
 * `from` shifted back by whole months, clamped to the end of the target month
 * so 31-Mar less one month is 28-Feb rather than JS's roll-forward to 3-Mar.
 */
function monthsBefore(from: Date, months: number): Date {
  const day = from.getDate();
  const d = new Date(from.getFullYear(), from.getMonth() - months, 1);
  const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDayOfMonth));
  return d;
}

/**
 * Annualised (CAGR) % over `years`; simple % when years <= 1. Null when the
 * history does not reach back that far.
 *
 * The lookback is done in MONTHS. `setFullYear(year - years)` silently
 * truncated any fractional period — `- 0.5` landed on the same year — which is
 * why every stored 6M figure was really the 1Y figure until Aug-2026.
 */
export function computeReturn(
  data: NavPoint[],
  latest: number,
  latestDate: Date,
  years: number,
): number | null {
  const past = navOnOrBefore(data, monthsBefore(latestDate, Math.round(years * 12)));
  if (!past) return null;
  const growth = latest / past;
  const r = years <= 1 ? growth - 1 : Math.pow(growth, 1 / years) - 1;
  return pct(r);
}

/**
 * Compute the full metric spread for a scheme's NAV history. Returns null when
 * the history is empty or the latest NAV is unusable.
 */
export function computeAll(data: NavPoint[]): FundMetrics | null {
  if (!data?.length) return null;

  const latest = parseFloat(data[0].nav);
  const latestDate = parseDate(data[0].date);
  if (!Number.isFinite(latest) || latest <= 0) return null;

  // YTD: NAV on/just-before Jan 1 of the latest year.
  const jan1 = new Date(latestDate.getFullYear(), 0, 1);
  const ytdBase = navOnOrBefore(data, jan1);

  // Since inception: use the oldest available NAV point, annualised over the
  // elapsed span (falls back to a simple return when < ~1 year of history).
  const first = data[data.length - 1];
  const firstNav = parseFloat(first.nav);
  const firstDate = parseDate(first.date);
  const years =
    (latestDate.getTime() - firstDate.getTime()) / (365.25 * 24 * 3600 * 1000);
  let return_si: number | null = null;
  if (Number.isFinite(firstNav) && firstNav > 0 && years > 0) {
    const growth = latest / firstNav;
    return_si = pct(years <= 1 ? growth - 1 : Math.pow(growth, 1 / years) - 1);
  }

  // 52-week high / low from the last year of NAV points.
  const yearAgo = new Date(latestDate);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);
  let high = latest;
  let low = latest;
  for (const p of data) {
    if (parseDate(p.date).getTime() < yearAgo.getTime()) break;
    const v = parseFloat(p.nav);
    if (Number.isFinite(v) && v > 0) {
      if (v > high) high = v;
      if (v < low) low = v;
    }
  }

  return {
    current_nav: Math.round(latest * 10000) / 10000,
    nav_date: isoDate(latestDate),
    return_ytd: simpleReturn(latest, ytdBase),
    return_6m: computeReturn(data, latest, latestDate, 0.5),
    return_1y: computeReturn(data, latest, latestDate, 1),
    return_3y: computeReturn(data, latest, latestDate, 3),
    return_5y: computeReturn(data, latest, latestDate, 5),
    return_si,
    high_52w: Math.round(high * 10000) / 10000,
    low_52w: Math.round(low * 10000) / 10000,
  };
}

/**
 * Downsample NAV history to at most `maxPoints`, oldest→newest, for charting.
 * Always keeps the first and last points.
 */
export function downsampleNav(
  data: NavPoint[],
  maxPoints = 180,
): { date: string; nav: number }[] {
  const asc = [...data].reverse(); // mfapi.in is newest-first; charts want oldest-first
  const clean = asc
    .map((p) => ({ date: p.date, nav: parseFloat(p.nav) }))
    .filter((p) => Number.isFinite(p.nav) && p.nav > 0);
  if (clean.length <= maxPoints) return clean;

  const step = (clean.length - 1) / (maxPoints - 1);
  const out: { date: string; nav: number }[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(clean[Math.round(i * step)]);
  }
  return out;
}
