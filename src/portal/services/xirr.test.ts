/**
 * Money-weighted return.
 *
 * The reason this is tested rather than eyeballed: XIRR always produces a
 * number that looks plausible. A sign error or a double-counted purchase does
 * not fail — it just quietly reports the wrong return on someone's savings.
 */
import { describe, expect, it } from 'vitest';
import { portfolioXirr, xirr } from './xirr';

const flow = (amount: number, date: string) => ({ amount, date: new Date(date) });

describe('xirr', () => {
  it('solves a single-year doubling as roughly 100%', () => {
    const r = xirr([flow(-1000, '2025-01-01'), flow(2000, '2026-01-01')]);
    expect(r).not.toBeNull();
    expect(r as number).toBeCloseTo(100, 0);
  });

  it('returns a loss as a negative rate', () => {
    const r = xirr([flow(-1000, '2025-01-01'), flow(800, '2026-01-01')]);
    expect(r as number).toBeLessThan(0);
  });

  it('refuses to answer when nothing has come back yet', () => {
    // All one sign: there is no rate that discounts these to zero, and 0% would
    // read as "flat" rather than "unknown".
    expect(xirr([flow(-1000, '2025-01-01'), flow(-1000, '2026-01-01')])).toBeNull();
  });

  it('refuses to answer on a single flow', () => {
    expect(xirr([flow(-1000, '2025-01-01')])).toBeNull();
  });
});

describe('portfolioXirr', () => {
  const buy = (amount: number, txn_date: string) =>
    ({ txn_type: 'buy', consolidated_amount: amount, txn_date }) as const;

  it('treats the current value as a closing inflow', () => {
    const r = portfolioXirr([buy(100000, '2025-08-01')], 110000);
    expect(r).not.toBeNull();
    expect(r as number).toBeGreaterThan(0);
  });

  it('computes from statement flows alone when we recorded none ourselves', () => {
    const r = portfolioXirr(
      [],
      230000,
      [
        { amount: -100000, date: '2024-08-01' },
        { amount: -100000, date: '2025-08-01' },
      ],
    );
    expect(r).not.toBeNull();
    expect(r as number).toBeGreaterThan(0);
    expect(r as number).toBeLessThan(40);
  });

  it('combines our own non-fund transactions with the statement ledger', () => {
    const r = portfolioXirr([buy(50000, '2025-01-01')], 180000, [
      { amount: -100000, date: '2024-08-01' },
    ]);
    expect(r).not.toBeNull();
  });

  it('returns null when there are no flows at all', () => {
    expect(portfolioXirr([], 100000, [])).toBeNull();
  });

  it('ignores undated and zero-value flows rather than skewing the result', () => {
    const withJunk = portfolioXirr([], 110000, [
      { amount: -100000, date: '2025-08-01' },
      { amount: 0, date: '2025-09-01' },
      { amount: -5000, date: 'not-a-date' },
    ]);
    const clean = portfolioXirr([], 110000, [{ amount: -100000, date: '2025-08-01' }]);
    expect(withJunk).toBeCloseTo(clean as number, 6);
  });
});

describe('xirr — refuses an absurd rate rather than reporting it', () => {
  /*
   * Verbatim from the statement that put 198,502% on a real client's dashboard.
   * It covered the current financial year only, so it opens with units the
   * client already held: one purchase of 99,995 followed by 2.09 lakh of
   * redemptions from holdings whose purchase money is nowhere in the file.
   *
   * Newton-Raphson is unbounded and converged happily on 198,179%. Bisection
   * could never have returned that — it only searches inside the plausible
   * band — so Newton is now held to the same one.
   */
  const TRUNCATED_STATEMENT: { date: string; amount: number }[] = [
    { date: '2026-04-27', amount: -99995 }, { date: '2026-04-27', amount: -5 },
    { date: '2026-04-30', amount: 1927.07 }, { date: '2026-04-30', amount: 72.93 },
    { date: '2026-05-07', amount: 10000 }, { date: '2026-05-08', amount: 10000 },
    { date: '2026-06-01', amount: 13116.71 }, { date: '2026-06-01', amount: 1883.29 },
    { date: '2026-06-18', amount: 60000 }, { date: '2026-06-30', amount: 6000 },
    { date: '2026-07-03', amount: 69962.1 }, { date: '2026-07-03', amount: 30037.9 },
    { date: '2026-07-30', amount: 6000 },
  ];

  it('returns null rather than a rate no portfolio can produce', () => {
    expect(portfolioXirr([], 202473.91, TRUNCATED_STATEMENT)).toBeNull();
  });

  it('still reports a large but genuine return', () => {
    // The bound must not swallow real performance.
    const r = xirr([flow(-1000, '2025-01-01'), flow(2500, '2026-01-01')]);
    expect(r).not.toBeNull();
    expect(r as number).toBeCloseTo(150, 0);
  });
});
