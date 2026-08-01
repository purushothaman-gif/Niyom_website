/**
 * XIRR — the money-weighted return on a client's actual cash flows.
 *
 * Replaces the placeholder that anchored a number near the simple gain
 * percentage. This is the real calculation: buys are outflows on their trade
 * date, sells are inflows, and the current portfolio value is a final inflow
 * today. Solving for the rate that discounts them to zero gives the same
 * figure a fund house or an RTA statement would print.
 *
 * Newton-Raphson with a bisection fallback, because Newton diverges on the
 * awkward cases (a portfolio that is nearly all one recent purchase, or one
 * where an early loss flips the sign of the derivative).
 */

export interface CashFlow {
  /** Negative for money in (a purchase), positive for money out (a sale). */
  amount: number;
  date: Date;
}

const DAYS = 365;

/**
 * The widest rate we will report, matching the bisection's own bracket.
 *
 * Newton-Raphson is unbounded and will happily converge on a rate no portfolio
 * can produce when the flows do not explain the closing value — a real client
 * was shown 198,502% because their statement began mid-history and the units
 * they already held had no purchase behind them. Bisection could never have
 * returned that, since it only searches inside this band; Newton is now held to
 * the same one, and anything outside it is treated as a failed solve rather
 * than an answer.
 */
const MAX_RATE = 10; // 1000% a year
const MAX_ITER = 60;
const TOLERANCE = 1e-7;

function npv(rate: number, flows: CashFlow[], t0: number): number {
  return flows.reduce((sum, f) => {
    const years = (f.date.getTime() - t0) / (1000 * 60 * 60 * 24 * DAYS);
    return sum + f.amount / Math.pow(1 + rate, years);
  }, 0);
}

/**
 * Annualised money-weighted return as a percentage, or null when the flows
 * cannot produce one.
 *
 * Returns null rather than a number whenever the answer would be meaningless:
 * fewer than two flows, all flows the same sign (nothing has come back yet),
 * or no root inside a plausible range. Callers show nothing in that case —
 * an XIRR of 0% reads as "flat", which is a different claim from "unknown".
 */
export function xirr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;

  const hasIn = flows.some((f) => f.amount < 0);
  const hasOut = flows.some((f) => f.amount > 0);
  if (!hasIn || !hasOut) return null;

  const sorted = [...flows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = sorted[0].date.getTime();

  // Newton-Raphson first — fast when it behaves.
  let rate = 0.1;
  for (let i = 0; i < MAX_ITER; i++) {
    const f = npv(rate, sorted, t0);
    if (Math.abs(f) < TOLERANCE) return Math.abs(rate) > MAX_RATE ? null : rate * 100;
    const step = 1e-5;
    const derivative = (npv(rate + step, sorted, t0) - f) / step;
    if (!Number.isFinite(derivative) || derivative === 0) break;
    const next = rate - f / derivative;
    if (!Number.isFinite(next)) break;
    // A rate at or below -100% is not a return, it is a broken solve.
    if (next <= -0.9999) {
      rate = -0.99;
      break;
    }
    // Outside the plausible band this is divergence, not a return. Fall through
    // to bisection, which cannot leave the band, and to null if it cannot bracket.
    if (next > MAX_RATE) break;
    if (Math.abs(next - rate) < TOLERANCE) {
      return Math.abs(next) > MAX_RATE ? null : next * 100;
    }
    rate = next;
  }

  // Bisection over a range wide enough for anything a portfolio can do.
  let lo = -0.9999;
  let hi = MAX_RATE;
  let fLo = npv(lo, sorted, t0);
  let fHi = npv(hi, sorted, t0);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, sorted, t0);
    if (Math.abs(fMid) < TOLERANCE) return mid * 100;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return ((lo + hi) / 2) * 100;
}

/**
 * Build the flows for a client from their transactions plus what the holding
 * is worth now.
 *
 * The closing value is treated as a sale today — the standard way to measure
 * an open position — so the result answers "what has this portfolio returned
 * me so far", not "what will it return".
 */
export function portfolioXirr(
  transactions: { txn_type: 'buy' | 'sell'; consolidated_amount: number; txn_date: string }[],
  currentValue: number,
  /**
   * Extra flows already signed from the investor's point of view — the ledger
   * of an imported statement. Kept separate from `transactions` because a CAS
   * states amounts the fund's way round and has already been converted.
   */
  extra: { amount: number; date: string }[] = [],
): number | null {
  const flows: CashFlow[] = [];

  for (const t of transactions) {
    const date = new Date(t.txn_date);
    if (Number.isNaN(date.getTime())) continue;
    const amount = Number(t.consolidated_amount) || 0;
    if (amount === 0) continue;
    flows.push({ amount: t.txn_type === 'buy' ? -amount : amount, date });
  }

  for (const e of extra) {
    const date = new Date(e.date);
    if (Number.isNaN(date.getTime()) || !e.amount) continue;
    flows.push({ amount: e.amount, date });
  }

  if (flows.length === 0) return null;
  if (currentValue > 0) flows.push({ amount: currentValue, date: new Date() });

  return xirr(flows);
}
