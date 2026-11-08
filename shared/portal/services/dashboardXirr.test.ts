import { describe, expect, it } from 'vitest';
import { buildDashboardData } from './dashboardModel';
import { unitsReconcile } from '../../mf/rtaMf';
import type { ClientWealthSnapshot } from './HoldingService';

const base: ClientWealthSnapshot = {
  client: null,
  holdings: [],
  transactions: [],
  mfSource: 'manual',
  casStatementTo: null,
  casFreshness: { state: 'none', statementTo: null, latestOwnMfTxnDate: null },
  casFlows: [],
  historyComplete: true,
  casStatementFrom: null,
  dayChange: null,
  valuedOn: null,
};

const yearAgo = new Date(Date.now() - 366 * 86_400_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe('unitsReconcile', () => {
  it('accepts tiny rounding, rejects a missing redemption or missing history', () => {
    expect(unitsReconcile(36.771, 36.771)).toBe(true);
    expect(unitsReconcile(6819.429, 6819.43)).toBe(true);
    expect(unitsReconcile(12773.322, 24012.089)).toBe(false); // redemptions missing
    expect(unitsReconcile(3254.641, 77.85)).toBe(false);      // earlier buys missing
  });
});

describe('XIRR on the registrar (MF-on-platform) basis', () => {
  it('uses reconciled fund flows and reports coverage of the excluded value', () => {
    const d = buildDashboardData({
      ...base,
      xirrBasis: { transactions: [], extraFlows: [{ date: yearAgo, amount: -100_000 }], value: 112_000, excludedValue: 28_000 },
    });
    expect(d.xirrPercent).not.toBeNull();
    expect(d.xirrPercent!).toBeGreaterThan(11.5);
    expect(d.xirrPercent!).toBeLessThan(12.5);
    expect(d.xirrCoveragePct).toBeCloseTo(80);
  });

  it('includes non-MF transactions alongside fund flows', () => {
    const d = buildDashboardData({
      ...base,
      xirrBasis: {
        transactions: [{ txn_type: 'buy', consolidated_amount: 50_000, txn_date: yearAgo }],
        extraFlows: [{ date: yearAgo, amount: -50_000 }],
        value: 110_000,
        excludedValue: 0,
      },
    });
    expect(d.xirrPercent!).toBeGreaterThan(9.5);
    expect(d.xirrPercent!).toBeLessThan(10.5);
    expect(d.xirrCoveragePct).toBeCloseTo(100);
  });

  it('never annualises under a year (5 days +4.8% must not read ~3,000%)', () => {
    const d = buildDashboardData({
      ...base,
      xirrBasis: { transactions: [], extraFlows: [{ date: daysAgo(5), amount: -13_910 }], value: 14_583, excludedValue: 0 },
    });
    expect(d.xirrPercent).toBeNull();
    expect(d.xirrNote).toBe('under_1y');
  });

  it('shows nothing (not 0%) when no holding is explained', () => {
    const d = buildDashboardData({
      ...base,
      xirrBasis: { transactions: [], extraFlows: [], value: 0, excludedValue: 50_000 },
    });
    expect(d.xirrPercent).toBeNull();
    expect(d.xirrCoveragePct).toBeNull();
  });
});
