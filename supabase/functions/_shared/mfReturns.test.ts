/**
 * These are the numbers a client reads off a fund card, so the two ways they
 * were wrong both get a test:
 *
 *   1. `return_6m` was computed with `setFullYear(year - 0.5)`, which truncates
 *      to a whole year — every stored 6M figure was really the 1Y figure.
 *   2. A period the history cannot reach was stored as 0, which reads as "this
 *      fund went nowhere" rather than "we do not know".
 */
import { describe, it, expect } from 'vitest';
import { computeAll, computeReturn, navOnOrBefore, parseDate, type NavPoint } from './mfReturns.ts';

const d = (date: string, nav: number): NavPoint => ({ date, nav: nav.toFixed(4) });

/** Daily history, newest-first (mfapi.in's order), compounding at `daily`. */
function series(days: number, startNav: number, daily: number): NavPoint[] {
  const out: NavPoint[] = [];
  const end = new Date(2026, 6, 31); // 31-07-2026
  for (let i = 0; i < days; i++) {
    const day = new Date(end);
    day.setDate(day.getDate() - i);
    const nav = startNav * Math.pow(1 + daily, days - 1 - i);
    out.push(
      d(
        `${String(day.getDate()).padStart(2, '0')}-${String(day.getMonth() + 1).padStart(2, '0')}-${day.getFullYear()}`,
        nav,
      ),
    );
  }
  return out;
}

describe('computeReturn', () => {
  const history = series(800, 100, 0.0005);
  const latest = parseFloat(history[0].nav);
  const latestDate = parseDate(history[0].date);

  it('measures 6M over six months, not twelve', () => {
    const sixMonth = computeReturn(history, latest, latestDate, 0.5);
    const oneYear = computeReturn(history, latest, latestDate, 1);
    expect(sixMonth).not.toBeNull();
    expect(oneYear).not.toBeNull();
    // Rising series: half the period must show a smaller gain than the full one.
    expect(sixMonth!).toBeLessThan(oneYear!);
    // ~183 days at 0.05%/day ≈ 9.6%.
    expect(sixMonth!).toBeGreaterThan(8);
    expect(sixMonth!).toBeLessThan(11);
  });

  it('returns null for a period the history does not reach', () => {
    // 800 days of history cannot answer a five-year question.
    expect(computeReturn(history, latest, latestDate, 5)).toBeNull();
  });

  it('annualises beyond one year', () => {
    const twoYear = computeReturn(history, latest, latestDate, 2);
    // 0.05%/day compounds to ~20% a year, and the CAGR must stay near that
    // rather than reporting the ~44% cumulative figure.
    expect(twoYear!).toBeGreaterThan(15);
    expect(twoYear!).toBeLessThan(25);
  });
});

describe('navOnOrBefore', () => {
  it('skips an unusable point instead of ending the scan', () => {
    const history = [d('31-07-2026', 120), { date: '30-07-2026', nav: '0' }, d('29-07-2026', 100)];
    expect(navOnOrBefore(history, new Date(2026, 6, 30))).toBe(100);
  });

  it('is null when nothing reaches back that far', () => {
    expect(navOnOrBefore([d('31-07-2026', 120)], new Date(2020, 0, 1))).toBeNull();
  });
});

describe('computeAll', () => {
  it('leaves unreachable periods null rather than zero', () => {
    const metrics = computeAll(series(400, 100, 0.0005))!;
    expect(metrics.return_1y).not.toBeNull();
    expect(metrics.return_3y).toBeNull();
    expect(metrics.return_5y).toBeNull();
  });

  it('distinguishes 6M from 1Y', () => {
    const metrics = computeAll(series(800, 100, 0.0005))!;
    expect(metrics.return_6m).not.toBe(metrics.return_1y);
  });

  it('is null for empty history', () => {
    expect(computeAll([])).toBeNull();
  });
});
