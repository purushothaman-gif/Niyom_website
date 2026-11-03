import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { nextHistoryWindow, HISTORY_FLOOR, HISTORY_START, addDays } from './navHistory.ts';
import { optionOf, planOf, parseSchemeMaster } from './schemeMaster.ts';
import { assessHealth, type MarketHealthRow } from './marketHealth.ts';
import { classifyCategory } from './assetClass.ts';

describe('history window queue', () => {
  it('starts just below the nightly feed and walks back a week at a time', () => {
    expect(nextHistoryWindow(null)).toEqual({ from: addDays(HISTORY_START, -7), to: addDays(HISTORY_START, -1) });
    expect(nextHistoryWindow('2026-07-25')).toEqual({ from: '2026-07-18', to: '2026-07-24' });
  });
  it('clamps at and stops below AMFI history floor', () => {
    expect(nextHistoryWindow('2006-04-05')).toEqual({ from: HISTORY_FLOOR, to: '2006-04-04' });
    expect(nextHistoryWindow(HISTORY_FLOOR)).toBeNull();
  });
});

describe('scheme master', () => {
  it('derives plan and option from the NAV name', () => {
    expect(planOf('X Fund - Direct Plan - Growth')).toBe('Direct');
    expect(planOf('X Fund -Regular - IDCW')).toBe('Regular');
    expect(optionOf('X Fund - Regular Growth')).toBe('Growth');
    expect(optionOf('X Fund -Regular - IDCW')).toBe('IDCW');
    expect(optionOf('X Fund - Dividend Payout')).toBe('IDCW');
    expect(optionOf('X Fund - Bonus Option')).toBe('Bonus');
  });
  it('splits run-together ISINs and reads quoted CSV', () => {
    const csv =
      'AMC,Code,Scheme Name,Scheme Type,Scheme Category,Scheme NAV Name,Scheme Minimum Amount,Launch Date, Closure Date,ISIN Div Payout/ ISIN GrowthISIN Div Reinvestment\n' +
      'ABSL AMC,100034,"Large, Mid Fund",Open Ended,Equity Scheme - Large & Mid Cap Fund,ABSL Large & Mid -Regular - IDCW,5000,24-Feb-1995,,INF209K01157INF209K01CE5\n';
    const rows = parseSchemeMaster(new TextEncoder().encode(csv));
    expect(rows.map((r) => r.isin)).toEqual(['INF209K01157', 'INF209K01CE5']);
    expect(rows[0]).toMatchObject({
      amfi_code: '100034', scheme_base_name: 'Large, Mid Fund', plan: 'Regular', scheme_option: 'IDCW',
      sebi_category: 'Equity Scheme - Large & Mid Cap Fund', launch_date: '1995-02-24', closure_date: null, min_amount: 5000,
    });
  });
  it('SEBI category text classifies like the nightly heading', () => {
    expect(classifyCategory('Equity Scheme - Large Cap Fund').assetClass).toBe('equity');
    expect(classifyCategory('Debt Scheme - Liquid Fund').assetClass).toBe('debt');
  });
  const fixture = process.env.AMFI_MASTER_FIXTURE;
  it.runIf(!!fixture && existsSync(fixture!))('parses the live AMFI file', () => {
    const rows = parseSchemeMaster(readFileSync(fixture!));
    expect(rows.length).toBeGreaterThan(15000);
    expect(rows.every((r) => /^INF[A-Z0-9]{9}$/.test(r.isin))).toBe(true);
  });
});

describe('health assessment', () => {
  const ok: MarketHealthRow = {
    latest_nav_date: '2026-11-03', nav_age_days: 1, latest_nav_rows: 17900, median_nav_rows_14d: 17900,
    last_daily_ok: true, last_daily_error: null, last_daily_validation: { big_moves: 2 }, last_daily_ok_at: '2026-11-03T23:50:00Z',
    history_cursor: '2020-01-01', history_floor: '2006-04-01', history_failures_24h: 0, history_windows_skipped: 0,
    master_synced_at: '2026-11-04T02:00:00Z', returns_stale: 0, returns_from_nav_daily: 100,
  };
  const now = new Date('2026-11-04T09:00:00Z');
  it('is quiet when healthy', () => expect(assessHealth(ok, now)).toEqual([]));
  it('flags a stale or failed feed as critical', () => {
    const p = assessHealth({ ...ok, nav_age_days: 6, last_daily_ok: false, last_daily_error: 'boom' }, now);
    expect(p.filter((x) => x.level === 'critical')).toHaveLength(2);
  });
  it('flags a partial file, bad NAVs and skipped history', () => {
    const p = assessHealth({ ...ok, latest_nav_rows: 9000, last_daily_validation: { big_moves: 80 }, history_windows_skipped: 2 }, now);
    expect(p).toHaveLength(3);
  });
});
