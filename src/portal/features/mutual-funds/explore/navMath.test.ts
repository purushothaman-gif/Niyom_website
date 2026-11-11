import { describe, expect, it } from 'vitest';
import { maxDrawdown, navAt, rollingReturns, sipBacktest, toSeries } from './navMath';

const pad = (n: number) => String(n).padStart(2, '0');
/** Monthly samples from Jan 2020, NAV given by `f(monthIndex)`. */
const monthly = (n: number, f: (i: number) => number) =>
  toSeries(
    Array.from({ length: n }, (_, i) => {
      const d = new Date(2020, i, 15);
      return { date: `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`, nav: f(i) };
    }).reverse(),
  );

describe('navMath', () => {
  it('sorts ascending and interpolates between samples', () => {
    const s = monthly(3, (i) => 10 + i * 2);
    expect(s[0].nav).toBe(10);
    expect(navAt(s, (s[0].t + s[1].t) / 2)).toBeCloseTo(11, 5);
    expect(navAt(s, s[2].t + 1e9)).toBe(14);
  });

  it('a SIP in a flat fund returns exactly what went in', () => {
    const r = sipBacktest(monthly(40, () => 20), 5000, 36)!;
    expect(r.instalments).toBe(36);
    expect(r.invested).toBe(180000);
    expect(r.value).toBeCloseTo(180000, 4);
    expect(r.avgNav).toBeCloseTo(20, 6);
    expect(Math.abs(r.xirrPct ?? 99)).toBeLessThan(0.01);
  });

  it('a SIP in a rising fund pays an average NAV below the latest', () => {
    const r = sipBacktest(monthly(40, (i) => 10 * Math.pow(1.01, i)), 1000, 24)!;
    expect(r.avgNav).toBeLessThan(r.lastNav);
    expect(r.gainPct).toBeGreaterThan(0);
    // 1% a month compounds to ~12.68% a year.
    expect(r.xirrPct).toBeGreaterThan(12);
    expect(r.xirrPct).toBeLessThan(13.4);
  });

  it('caps a SIP at the history available', () => {
    expect(sipBacktest(monthly(13, () => 10), 1000, 60)!.instalments).toBe(12);
  });

  it('rolling returns of steady growth are all the same', () => {
    const r = rollingReturns(monthly(60, (i) => 10 * Math.pow(1.01, i)), 1)!;
    expect(r.best).toBeCloseTo(r.worst, 0);
    expect(r.median).toBeGreaterThan(12);
    expect(r.lossPct).toBe(0);
    expect(rollingReturns(monthly(10, () => 10), 1)).toBeNull();
  });

  it('finds the deepest fall and its recovery', () => {
    const navs = [10, 12, 9, 6, 8, 12.5, 11];
    const d = maxDrawdown(monthly(navs.length, (i) => navs[i]))!;
    expect(d.pct).toBeCloseTo(-50, 6);
    expect(new Date(d.peakT).getMonth()).toBe(1);
    expect(new Date(d.troughT).getMonth()).toBe(3);
    expect(new Date(d.recoveredT!).getMonth()).toBe(5);
    expect(maxDrawdown(monthly(5, (i) => 10 + i))).toBeNull();
  });
});
