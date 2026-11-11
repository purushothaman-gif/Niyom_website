/**
 * NAV-history maths behind the SIP and lumpsum tools on a fund page.
 * -----------------------------------------------------------------------------
 * Everything here is BACKWARD-looking and computed from the fund's own NAV
 * series — nothing assumes a rate. The series the portal receives is sampled
 * (a few hundred points across the fund's whole life), so a NAV on a given day
 * is linearly interpolated between the two nearest samples. That makes every
 * result an approximation of what the daily series would give; the UI says so.
 */
import { xirr } from '../../../../../shared/portal/services/xirr';
import type { CatalogNavPoint } from '../../../types/funds';

export interface NavSample {
  /** Epoch ms. */
  t: number;
  nav: number;
}

const DAY = 86_400_000;
const YEAR = 365.25 * DAY;

/** "dd-mm-yyyy" points → ascending samples, bad rows dropped. */
export function toSeries(points: CatalogNavPoint[]): NavSample[] {
  return points
    .map((p) => {
      const [dd, mm, yy] = p.date.split('-').map(Number);
      return { t: new Date(yy, mm - 1, dd).getTime(), nav: Number(p.nav) };
    })
    .filter((s) => Number.isFinite(s.t) && s.nav > 0)
    .sort((a, b) => a.t - b.t);
}

/** NAV at time `t`, interpolated; clamped to the ends of the series. */
export function navAt(series: NavSample[], t: number): number {
  if (t <= series[0].t) return series[0].nav;
  const last = series[series.length - 1];
  if (t >= last.t) return last.nav;
  let lo = 0;
  let hi = series.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = series[lo];
  const b = series[hi];
  return a.nav + ((b.nav - a.nav) * (t - a.t)) / (b.t - a.t);
}

/** Years of history the series covers. */
export function historyYears(series: NavSample[]): number {
  return series.length < 2 ? 0 : (series[series.length - 1].t - series[0].t) / YEAR;
}

export interface SipBacktest {
  instalments: number;
  invested: number;
  units: number;
  value: number;
  gainPct: number;
  /** Average NAV paid across all instalments (invested / units). */
  avgNav: number;
  lastNav: number;
  /** Money-weighted annualised return; null when it cannot be solved. */
  xirrPct: number | null;
  from: number;
  to: number;
}

/**
 * A monthly SIP of `monthly` over the last `months` months, bought at the NAV
 * of each instalment date and valued at the latest NAV. The first instalment is
 * `months` months before the latest NAV date; there is none on the last day.
 */
export function sipBacktest(series: NavSample[], monthly: number, months: number): SipBacktest | null {
  if (series.length < 2 || monthly <= 0 || months < 1) return null;
  const last = series[series.length - 1];
  const end = new Date(last.t);
  const flows: { amount: number; date: Date }[] = [];
  let units = 0;
  let first = last.t;
  for (let k = months; k >= 1; k--) {
    const d = new Date(end.getFullYear(), end.getMonth() - k, Math.min(end.getDate(), 28));
    if (d.getTime() < series[0].t) continue;
    units += monthly / navAt(series, d.getTime());
    flows.push({ amount: -monthly, date: d });
    first = Math.min(first, d.getTime());
  }
  if (!flows.length) return null;
  const invested = monthly * flows.length;
  const value = units * last.nav;
  const rate = xirr([...flows, { amount: value, date: end }]);
  return {
    instalments: flows.length,
    invested,
    units,
    value,
    gainPct: (value / invested - 1) * 100,
    avgNav: invested / units,
    lastNav: last.nav,
    xirrPct: rate,
    from: first,
    to: last.t,
  };
}

export interface RollingStats {
  /** How many start dates were tested. */
  count: number;
  /** Annualised for holding periods over a year, absolute for one year. */
  best: number;
  worst: number;
  median: number;
  /** Share of start dates that ended below the amount invested, in %. */
  lossPct: number;
}

/**
 * Every lumpsum held for `years`, one per sampled start date: the spread of
 * outcomes that depended only on WHEN the money went in.
 */
export function rollingReturns(series: NavSample[], years: number): RollingStats | null {
  if (series.length < 2) return null;
  const lastT = series[series.length - 1].t;
  const span = years * YEAR;
  const out: number[] = [];
  for (const s of series) {
    if (s.t + span > lastT) break;
    const growth = navAt(series, s.t + span) / s.nav;
    out.push((Math.pow(growth, 1 / years) - 1) * 100);
  }
  if (out.length < 6) return null;
  out.sort((a, b) => a - b);
  const mid = Math.floor(out.length / 2);
  return {
    count: out.length,
    best: out[out.length - 1],
    worst: out[0],
    median: out.length % 2 ? out[mid] : (out[mid - 1] + out[mid]) / 2,
    lossPct: (out.filter((r) => r < 0).length / out.length) * 100,
  };
}

export interface Drawdown {
  /** Fall from peak to trough, as a negative %. */
  pct: number;
  peakT: number;
  troughT: number;
  /** When the NAV first got back to the peak; null if it has not yet. */
  recoveredT: number | null;
}

/** The deepest peak-to-trough fall in the series, and how long it took to heal. */
export function maxDrawdown(series: NavSample[]): Drawdown | null {
  if (series.length < 2) return null;
  let peak = series[0];
  let worst: { pct: number; peak: NavSample; trough: NavSample } | null = null;
  for (const s of series) {
    if (s.nav > peak.nav) peak = s;
    const pct = (s.nav / peak.nav - 1) * 100;
    if (!worst || pct < worst.pct) worst = { pct, peak, trough: s };
  }
  if (!worst || worst.pct >= 0) return null;
  const { peak: p, trough } = worst;
  const back = series.find((s) => s.t > trough.t && s.nav >= p.nav);
  return { pct: worst.pct, peakT: p.t, troughT: trough.t, recoveredT: back ? back.t : null };
}

export const monthsBetween = (a: number, b: number): number => Math.max(1, Math.round((b - a) / (YEAR / 12)));
