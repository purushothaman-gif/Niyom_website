/**
 * The gains engine.
 *
 * Numbers here are chosen so the right answer can be checked by hand, and the
 * awkward cases are taken from the real ledger rather than imagined: the
 * reversed SIP instalments, the pre-2018 purchases, the truncated statement.
 *
 * The stakes are different from the rest of the portal. A wrong valuation is
 * embarrassing and self-correcting; a wrong cost basis goes into a tax return.
 */
import { describe, expect, it } from 'vitest';
import {
  computeSchemeGains,
  computeGains,
  financialYear,
  grandfatheredCost,
  summariseFinancialYear,
  taxTreatmentOf,
  displaySchemeName,
  termLabel,
  treatmentLabel,
  excludedSchemes,
  type GainsContext,
  type GainsScheme,
  type GainsTxn,
} from './gains';

/* ------------------------------------------------------------- fixtures -- */

const EQUITY_ISIN = 'INF209K01BR9';
const DEBT_ISIN = 'INF204KB16R8';

const ctx = (over: Partial<GainsContext> = {}): GainsContext => ({
  assetClassByIsin: new Map([
    [EQUITY_ISIN, 'equity' as const],
    [DEBT_ISIN, 'debt' as const],
  ]),
  grandfatherNavByIsin: new Map([[EQUITY_ISIN, 100]]),
  ...over,
});

const scheme = (over: Partial<GainsScheme> = {}): GainsScheme => ({
  id: 's1',
  name: 'A Large Cap Fund',
  isin: EQUITY_ISIN,
  units: 0,
  ...over,
});

const buy = (date: string, units: number, amount: number, type = 'PURCHASE'): GainsTxn => ({
  scheme_id: 's1', txn_date: date, txn_type: type, units, amount, nav: amount / units,
});

const sell = (date: string, units: number, nav: number, type = 'REDEMPTION'): GainsTxn => ({
  scheme_id: 's1', txn_date: date, txn_type: type, units: -units, amount: -(units * nav), nav,
});

/* ---------------------------------------------------------------- dates -- */

describe('financial years', () => {
  it('runs April to March', () => {
    expect(financialYear('2026-04-01')).toBe('2026-27');
    expect(financialYear('2027-03-31')).toBe('2026-27');
    expect(financialYear('2026-03-31')).toBe('2025-26');
    expect(financialYear('2026-08-05')).toBe('2026-27');
  });
});

/* ------------------------------------------------------------ FIFO basics -- */

describe('FIFO lot matching', () => {
  it('sells the oldest units first', () => {
    const g = computeSchemeGains(
      scheme({ units: 100 }),
      [
        buy('2020-01-10', 100, 1000), // ₹10/unit
        buy('2021-01-10', 100, 2000), // ₹20/unit
        sell('2024-06-10', 100, 30),  // ₹30/unit
      ],
      ctx(),
    );

    expect(g.complete).toBe(true);
    expect(g.disposals).toHaveLength(1);
    // The 2020 lot goes: cost ₹1,000, proceeds ₹3,000.
    expect(g.disposals[0].buyDate).toBe('2020-01-10');
    expect(g.disposals[0].cost).toBeCloseTo(1000, 2);
    expect(g.disposals[0].proceeds).toBeCloseTo(3000, 2);
    expect(g.disposals[0].gain).toBeCloseTo(2000, 2);
    // The 2021 lot survives.
    expect(g.openUnits).toBeCloseTo(100, 3);
    expect(g.openCost).toBeCloseTo(2000, 2);
  });

  it('splits one sale across several lots', () => {
    const g = computeSchemeGains(
      scheme({ units: 50 }),
      [
        buy('2020-01-10', 100, 1000),
        buy('2021-01-10', 100, 2000),
        sell('2024-06-10', 150, 30),
      ],
      ctx(),
    );

    expect(g.disposals).toHaveLength(2);
    expect(g.disposals[0].units).toBeCloseTo(100, 3);
    expect(g.disposals[1].units).toBeCloseTo(50, 3);
    expect(g.disposals[1].buyNav).toBeCloseTo(20, 4);
    // 100 @ ₹10 + 50 @ ₹20 = ₹2,000 cost against ₹4,500 proceeds.
    const gain = g.disposals.reduce((s, d) => s + d.gain, 0);
    expect(gain).toBeCloseTo(2500, 2);
    expect(g.openUnits).toBeCloseTo(50, 3);
  });

  it('takes the cost per unit from money paid, not the printed NAV', () => {
    /*
     * Stamp duty is deducted before allotment, so ₹10,000 buys slightly fewer
     * units than ₹10,000/NAV. That duty is part of the cost of acquisition, and
     * amount/units is the only figure that carries it.
     */
    const g = computeSchemeGains(
      scheme({ units: 0 }),
      [
        { scheme_id: 's1', txn_date: '2022-01-10', txn_type: 'PURCHASE', units: 999.5, amount: 10000, nav: 10 },
        sell('2024-06-10', 999.5, 12),
      ],
      ctx(),
    );
    expect(g.disposals[0].buyNav).toBeCloseTo(10.005, 4);
    expect(g.disposals[0].actualCost).toBeCloseTo(10000, 2);
  });

  it('orders same-day transactions the way the statement printed them', () => {
    // A same-day buy and sell give different costs depending on the order, and
    // the registrar's sequence is the only evidence of what really happened.
    const g = computeSchemeGains(
      scheme({ units: 100 }),
      [
        buy('2020-01-10', 100, 1000),
        buy('2024-06-10', 100, 5000), // same day as the sale, printed FIRST
        sell('2024-06-10', 100, 30),
      ],
      ctx(),
    );
    // FIFO still takes the 2020 lot; the same-day purchase survives.
    expect(g.disposals[0].buyDate).toBe('2020-01-10');
    expect(g.openLots[0].buyDate).toBe('2024-06-10');
  });
});

/* -------------------------------------------------------- same-day order -- */

describe('recovering the true order within a day', () => {
  /*
   * There is no sequence column. `created_at` is one bulk insert per import (16
   * distinct values across 5,720 rows) and `id` is a random UUID, so any sort by
   * them invents an order. `balance_units` — the running balance the registrar
   * prints after each row, present on every row — is the real evidence.
   */
  it('puts a purchase before the reversal that cancels it', () => {
    /*
     * The opening rows of a real HSBC Value ledger, which arrive from the
     * database with the REVERSAL FIRST. Read in that order the reversal has no
     * lot to cancel; the balances say plainly which came first.
     */
    const g = computeSchemeGains(
      scheme({ units: 78.407 }),
      [
        { scheme_id: 's1', txn_date: '2016-05-02', txn_type: 'PURCHASE', amount: -2000, units: -81.927, nav: 24.412, balance_units: 0 },
        { scheme_id: 's1', txn_date: '2016-05-02', txn_type: 'PURCHASE', amount: 2000, units: 81.927, nav: 24.412, balance_units: 81.927 },
        { scheme_id: 's1', txn_date: '2016-06-27', txn_type: 'PURCHASE', amount: 2000, units: 78.407, nav: 25.508, balance_units: 78.407 },
      ],
      ctx(),
    );

    expect(g.complete).toBe(true);
    expect(g.disposals).toHaveLength(0);
    expect(g.openUnits).toBeCloseTo(78.407, 3);
    expect(g.openLots).toHaveLength(1);
    expect(g.openLots[0].buyDate).toBe('2016-06-27');
  });

  it('orders a same-day buy and sell by the balance, not by arrival', () => {
    // Applying the sale first would take the cheap 2020 lot; applying the
    // purchase first does not change FIFO here, but the balances decide.
    const g = computeSchemeGains(
      scheme({ units: 100 }),
      [
        { scheme_id: 's1', txn_date: '2024-06-10', txn_type: 'REDEMPTION', amount: -3000, units: -100, nav: 30, balance_units: 100 },
        { scheme_id: 's1', txn_date: '2020-01-10', txn_type: 'PURCHASE', amount: 1000, units: 100, nav: 10, balance_units: 100 },
        { scheme_id: 's1', txn_date: '2024-06-10', txn_type: 'PURCHASE', amount: 5000, units: 100, nav: 50, balance_units: 200 },
      ],
      ctx(),
    );
    // Purchase (100 -> 200) then redemption (200 -> 100).
    expect(g.disposals).toHaveLength(1);
    expect(g.disposals[0].buyDate).toBe('2020-01-10');
    expect(g.openLots[0].buyDate).toBe('2024-06-10');
    expect(g.openUnits).toBeCloseTo(100, 3);
  });

  it('falls back to arrival order when balances are absent', () => {
    // Older rows, or a registrar that omits the column. The engine must still
    // work — it simply loses the same-day guarantee.
    const g = computeSchemeGains(
      scheme({ units: 100 }),
      [buy('2020-01-10', 100, 1000), buy('2021-01-10', 100, 2000), sell('2024-06-10', 100, 30)],
      ctx(),
    );
    expect(g.complete).toBe(true);
    expect(g.disposals[0].buyDate).toBe('2020-01-10');
  });

  it('does not reorder across days', () => {
    const g = computeSchemeGains(
      scheme({ units: 0 }),
      [
        { scheme_id: 's1', txn_date: '2021-01-10', txn_type: 'PURCHASE', amount: 2000, units: 100, nav: 20, balance_units: 200 },
        { scheme_id: 's1', txn_date: '2020-01-10', txn_type: 'PURCHASE', amount: 1000, units: 100, nav: 10, balance_units: 100 },
        { scheme_id: 's1', txn_date: '2024-06-10', txn_type: 'REDEMPTION', amount: -6000, units: -200, nav: 30, balance_units: 0 },
      ],
      ctx(),
    );
    expect(g.disposals[0].buyDate).toBe('2020-01-10');
    expect(g.disposals[1].buyDate).toBe('2021-01-10');
  });
});

/* ------------------------------------------------------------- reversals -- */

describe('a reversed purchase is not a sale', () => {
  it('cancels the instalment instead of disposing of it', () => {
    /*
     * Verbatim shape from the ledger:
     *   SIP Purchase84/ER04: Insufficient Balance - Instalment No 3   -9,999.50
     * 52 rows across the book look like this. Treated as a sale each one
     * invents a disposal that never happened.
     */
    const g = computeSchemeGains(
      scheme({ units: 100 }),
      [
        buy('2024-01-10', 100, 1000),
        buy('2024-02-10', 50, 500),
        buy('2024-02-15', -50, -500), // the February instalment bounced
      ],
      ctx(),
    );

    expect(g.disposals).toHaveLength(0);
    expect(g.openUnits).toBeCloseTo(100, 3);
    expect(g.openCost).toBeCloseTo(1000, 2);
    expect(g.complete).toBe(true);
  });

  it('cancels the newest lot, which is the one being undone', () => {
    const g = computeSchemeGains(
      scheme({ units: 100 }),
      [
        buy('2020-01-10', 100, 1000), // ₹10/unit, must survive
        buy('2024-02-10', 100, 5000), // ₹50/unit, the failed instalment
        buy('2024-02-15', -100, -5000),
      ],
      ctx(),
    );
    expect(g.openUnits).toBeCloseTo(100, 3);
    expect(g.openCost).toBeCloseTo(1000, 2); // the cheap lot, not the dear one
  });

  it('does not let a reversal produce a gain even when the price moved', () => {
    // The reversal's own "NAV" is whatever the registrar printed. It must never
    // reach a proceeds calculation.
    const g = computeSchemeGains(
      scheme({ units: 0 }),
      [buy('2024-02-10', 100, 5000), buy('2024-02-15', -100, -5000)],
      ctx(),
    );
    expect(g.disposals).toHaveLength(0);
    expect(g.openUnits).toBeCloseTo(0, 3);
  });
});

/* --------------------------------------------------------- grandfathering -- */

describe('grandfathering under s.55(2)(ac)', () => {
  const args = {
    assetClass: 'equity' as const,
    buyDate: '2010-05-01',
    sellDate: '2024-06-01',
    units: 100,
    fmvPerUnit: 100,
  };

  it('re-bases cost to the 31-Jan-2018 value on a fund that rose', () => {
    // Paid ₹20/unit, worth ₹100 on 31-Jan-2018, sold at ₹150.
    // cost = max(2000, min(10000, 15000)) = 10000 — the pre-2018 growth is exempt.
    const { cost, grandfathered } = grandfatheredCost({
      ...args, actualCost: 2000, proceeds: 15000,
    });
    expect(cost).toBe(10000);
    expect(grandfathered).toBe(true);
  });

  it('does not manufacture a loss when the fund fell after 2018', () => {
    /*
     * The inner min(). Paid ₹20/unit, worth ₹100 in 2018, sold at just ₹30.
     * cost = max(2000, min(10000, 3000)) = 3000, so the gain is nil — not the
     * ₹7,000 loss that using the 2018 value alone would invent.
     */
    const { cost } = grandfatheredCost({ ...args, actualCost: 2000, proceeds: 3000 });
    expect(cost).toBe(3000);
  });

  it('never taxes below what was actually paid', () => {
    /*
     * The outer max(). A fund that fell BEFORE 2018 and recovered: paid ₹150,
     * worth ₹100 in 2018, sold at ₹200. cost = max(15000, min(10000, 20000))
     * = 15000. Using the 2018 FMV would tax ₹5,000 of a loss the client bore.
     */
    const { cost } = grandfatheredCost({ ...args, actualCost: 15000, proceeds: 20000 });
    expect(cost).toBe(15000);
  });

  it('applies only to equity', () => {
    const { cost, grandfathered } = grandfatheredCost({
      ...args, assetClass: 'debt', actualCost: 2000, proceeds: 15000,
    });
    expect(cost).toBe(2000);
    expect(grandfathered).toBe(false);
  });

  it('applies only to units bought before 01-Feb-2018', () => {
    const { grandfathered } = grandfatheredCost({
      ...args, buyDate: '2018-02-01', actualCost: 2000, proceeds: 15000,
    });
    expect(grandfathered).toBe(false);
  });

  it('does nothing when no 31-Jan-2018 NAV is known', () => {
    // Silently falling back to actual cost would OVERSTATE the gain. The caller
    // is expected to have backfilled; this is the safe direction to fail.
    const { cost, grandfathered } = grandfatheredCost({
      ...args, fmvPerUnit: undefined, actualCost: 2000, proceeds: 15000,
    });
    expect(cost).toBe(2000);
    expect(grandfathered).toBe(false);
  });

  it('flows through a real ledger walk', () => {
    const g = computeSchemeGains(
      scheme({ units: 0 }),
      [buy('2010-05-01', 100, 2000), sell('2024-06-01', 100, 150)],
      ctx(),
    );
    expect(g.disposals[0].actualCost).toBeCloseTo(2000, 2);
    expect(g.disposals[0].cost).toBeCloseTo(10000, 2);
    expect(g.disposals[0].grandfathered).toBe(true);
    expect(g.disposals[0].gain).toBeCloseTo(5000, 2);
  });
});

/* ------------------------------------------------------- holding periods -- */

describe('holding period and rate', () => {
  it('makes equity long-term after twelve months, not at twelve', () => {
    expect(taxTreatmentOf('equity', '2024-01-15', '2025-01-15').term).toBe('short');
    expect(taxTreatmentOf('equity', '2024-01-15', '2025-01-16').term).toBe('long');
  });

  it('counts calendar months, so a leap year does not change the answer', () => {
    // A 365-day rule would call this short-term by one day.
    expect(taxTreatmentOf('equity', '2023-02-28', '2024-02-29').term).toBe('long');
  });

  it('uses the rate in force on the SALE date', () => {
    // Finance (No. 2) Act 2024 took effect 23-Jul-2024.
    const before = taxTreatmentOf('equity', '2020-01-01', '2024-07-22');
    const after = taxTreatmentOf('equity', '2020-01-01', '2024-07-23');
    expect(before.kind === 'equity' && before.rate).toBe(0.1);
    expect(after.kind === 'equity' && after.rate).toBe(0.125);

    const stcgBefore = taxTreatmentOf('equity', '2024-01-01', '2024-07-22');
    const stcgAfter = taxTreatmentOf('equity', '2024-05-01', '2024-07-23');
    expect(stcgBefore.kind === 'equity' && stcgBefore.rate).toBe(0.15);
    expect(stcgAfter.kind === 'equity' && stcgAfter.rate).toBe(0.2);
  });

  it('deems a debt fund bought after 01-Apr-2023 short-term however long it is held', () => {
    /*
     * s.50AA. Held nearly three years and still short-term, taxed at slab —
     * the single most counter-intuitive rule in the set, and the one most
     * likely to be got wrong by assuming a holding period decides it.
     */
    const t = taxTreatmentOf('debt', '2023-04-01', '2026-03-31');
    expect(t.kind).toBe('slab');
    expect(t.term).toBe('short');
  });

  it('still gives a pre-April-2023 debt fund a long-term threshold', () => {
    const t = taxTreatmentOf('debt', '2023-03-31', '2026-03-31');
    expect(t.term).toBe('long');
    expect(t.kind).toBe('non_equity'); // 12.5%, sold under the new regime
  });

  it('uses 24 months for non-equity after the new regime and 36 before it', () => {
    // Sold 22-Jul-2024, held 30 months: still short under the old 36-month rule.
    expect(taxTreatmentOf('other', '2022-01-22', '2024-07-22').term).toBe('short');
    // Sold one day later, the threshold is 24 months: long.
    expect(taxTreatmentOf('other', '2022-01-22', '2024-07-23').term).toBe('long');
  });

  it('states no rate where the law says slab', () => {
    const t = taxTreatmentOf('other', '2024-01-01', '2024-06-01');
    expect(t.kind).toBe('slab');
    expect(t).not.toHaveProperty('rate');
  });

  it('refuses to guess for a fund whose composition is undecided', () => {
    const t = taxTreatmentOf(null, '2020-01-01', '2026-01-01');
    expect(t.kind).toBe('undecided');
    expect(t.term).toBeNull();
  });
});

/* ------------------------------------------------------- incomplete data -- */

describe('a statement that cannot support a cost basis', () => {
  it('refuses when units are sold that no purchase explains', () => {
    /*
     * A CAS requested for one financial year. The client really did own the
     * units and really did sell them; the money that bought them is simply not
     * in the file. Reporting the full proceeds as gain would overstate the tax
     * enormously.
     */
    const g = computeSchemeGains(
      scheme({ units: 0 }),
      [sell('2024-06-10', 100, 30)],
      ctx(),
    );
    expect(g.complete).toBe(false);
    expect(g.disposals).toHaveLength(0);
    expect(g.incompleteReason).toMatch(/no purchase/i);
  });

  it('refuses when the ledger does not reconstruct the closing balance', () => {
    // Truncated with no sale at all: nothing looks wrong until you compare the
    // ledger's closing units with the statement's.
    const g = computeSchemeGains(
      scheme({ units: 150 }), // statement says 150; ledger explains only 100
      [buy('2024-01-10', 100, 1000)],
      ctx(),
    );
    expect(g.complete).toBe(false);
    expect(g.incompleteReason).toMatch(/opens with/i);
  });

  it('reports a complete scheme even when a sibling is incomplete', () => {
    // One bad fund must not suppress the whole statement.
    const out = computeGains(
      [
        scheme({ id: 'good', units: 0 }),
        { id: 'bad', name: 'Truncated Fund', isin: EQUITY_ISIN, units: 100 },
      ],
      [
        { ...buy('2020-01-10', 100, 1000), scheme_id: 'good' },
        { ...sell('2024-06-10', 100, 30), scheme_id: 'good' },
        { ...buy('2024-01-10', 10, 100), scheme_id: 'bad' },
      ],
      ctx(),
    );
    expect(out.find((s) => s.schemeId === 'good')?.disposals).toHaveLength(1);
    expect(out.find((s) => s.schemeId === 'bad')?.complete).toBe(false);
    expect(excludedSchemes(out).map((e) => e.name)).toEqual(['Truncated Fund']);
  });
});

/* ------------------------------------------------------- other txn types -- */

describe('the rest of the ledger', () => {
  it('treats a dividend reinvestment as a new lot', () => {
    // The payout was already taxed as income; the units it bought carry their
    // own cost and their own holding period from that date.
    const g = computeSchemeGains(
      scheme({ units: 110 }),
      [buy('2020-01-10', 100, 1000), buy('2021-06-10', 10, 200, 'DIVIDEND')],
      ctx(),
    );
    expect(g.openUnits).toBeCloseTo(110, 3);
    expect(g.openCost).toBeCloseTo(1200, 2);
    expect(g.openLots[1].buyDate).toBe('2021-06-10');
  });

  it('ignores a dividend payout, which moves no units', () => {
    const g = computeSchemeGains(
      scheme({ units: 100 }),
      [
        buy('2020-01-10', 100, 1000),
        { scheme_id: 's1', txn_date: '2021-06-10', txn_type: 'DIVIDEND', units: 0, amount: 500 },
      ],
      ctx(),
    );
    expect(g.openUnits).toBeCloseTo(100, 3);
    expect(g.disposals).toHaveLength(0);
  });

  it('adds stamp duty to the cost of the units it was charged on', () => {
    /*
     * Verbatim shape from the statement — a ₹200,000 purchase is recorded as
     * ₹199,990 of units and a ₹10 duty row, and the scheme's printed Total Cost
     * Value is ₹200,000. Leaving the duty out understates cost on every unit
     * ever bought, so every gain is overstated. It was the exact gap on all 54
     * schemes that have no sales.
     */
    const g = computeSchemeGains(
      scheme({ units: 7135.212 }),
      [
        buy('2020-08-04', 7135.212, 199_990),
        { scheme_id: 's1', txn_date: '2020-08-04', txn_type: 'STAMP_DUTY', units: 0, amount: 10 },
      ],
      ctx(),
    );
    expect(g.openCost).toBeCloseTo(200_000, 2);
  });

  it('splits one day’s duty across that day’s purchases', () => {
    const g = computeSchemeGains(
      scheme({ units: 300 }),
      [
        buy('2020-01-10', 100, 1000),
        buy('2020-01-10', 200, 3000),
        { scheme_id: 's1', txn_date: '2020-01-10', txn_type: 'STAMP_DUTY', units: 0, amount: 4 },
      ],
      ctx(),
    );
    // ₹4 over ₹4,000 acquired: ₹1 to the first lot, ₹3 to the second.
    expect(g.openLots[0].cost).toBeCloseTo(1001, 2);
    expect(g.openLots[1].cost).toBeCloseTo(3003, 2);
    expect(g.openCost).toBeCloseTo(4004, 2);
  });

  it('ignores STT, which is not a cost of acquisition', () => {
    // Securities transaction tax on a redemption is expressly not deductible.
    const g = computeSchemeGains(
      scheme({ units: 100 }),
      [
        buy('2020-01-10', 100, 1000),
        { scheme_id: 's1', txn_date: '2020-01-10', txn_type: 'STT', units: 0, amount: 1.2 },
      ],
      ctx(),
    );
    expect(g.openCost).toBeCloseTo(1000, 2);
    expect(g.openUnits).toBeCloseTo(100, 3);
    expect(g.complete).toBe(true);
  });

  it('does not price duty charged on a day with no purchase', () => {
    // The duty on a reversed instalment, which creates no lot to carry it.
    const g = computeSchemeGains(
      scheme({ units: 100 }),
      [
        buy('2020-01-10', 100, 1000),
        buy('2020-02-10', 50, 500),
        buy('2020-02-15', -50, -500),
        { scheme_id: 's1', txn_date: '2020-02-15', txn_type: 'STAMP_DUTY', units: 0, amount: -0.5 },
      ],
      ctx(),
    );
    expect(g.openCost).toBeCloseTo(1000, 2);
    expect(Number.isFinite(g.openCost)).toBe(true);
  });

  it('taxes a switch-out and opens a lot for the switch-in', () => {
    /*
     * A switch is a redemption and a purchase for tax, however it looks to the
     * client. Both legs are in the same statement under different schemes.
     */
    const out = computeGains(
      [
        { id: 'from', name: 'Fund A', isin: EQUITY_ISIN, units: 0 },
        { id: 'to', name: 'Fund B', isin: EQUITY_ISIN, units: 50 },
      ],
      [
        { scheme_id: 'from', txn_date: '2020-01-10', txn_type: 'PURCHASE', units: 100, amount: 1000, nav: 10 },
        { scheme_id: 'from', txn_date: '2024-06-10', txn_type: 'SWITCH_OUT', units: -100, amount: -3000, nav: 30 },
        { scheme_id: 'to', txn_date: '2024-06-10', txn_type: 'SWITCH_IN', units: 50, amount: 3000, nav: 60 },
      ],
      ctx(),
    );
    const from = out.find((s) => s.schemeId === 'from')!;
    const to = out.find((s) => s.schemeId === 'to')!;
    expect(from.disposals).toHaveLength(1);
    expect(from.disposals[0].gain).toBeCloseTo(2000, 2);
    expect(to.openUnits).toBeCloseTo(50, 3);
    expect(to.openCost).toBeCloseTo(3000, 2);
  });

  it('values open lots at the latest NAV', () => {
    const g = computeSchemeGains(
      scheme({ units: 100 }),
      [buy('2020-01-10', 100, 1000)],
      ctx({ currentNavByIsin: new Map([[EQUITY_ISIN, 25]]) }),
    );
    expect(g.unrealised).toBeCloseTo(1500, 2);
  });

  it('leaves unrealised null when no NAV is known', () => {
    const g = computeSchemeGains(scheme({ units: 100 }), [buy('2020-01-10', 100, 1000)], ctx());
    expect(g.unrealised).toBeNull();
  });
});

/* --------------------------------------------------------------- labels -- */

describe('what the client is told about each disposal', () => {
  it('states the rate where the law states one', () => {
    expect(treatmentLabel(taxTreatmentOf('equity', '2020-01-01', '2026-06-01'))).toBe('LTCG · 12.5%');
    expect(treatmentLabel(taxTreatmentOf('equity', '2026-01-01', '2026-06-01'))).toBe('STCG · 20%');
    expect(treatmentLabel(taxTreatmentOf('other', '2020-01-01', '2026-06-01'))).toBe('LTCG · 12.5%');
  });

  it('never puts a rate on a gain taxed at the client’s slab', () => {
    /*
     * The most tempting wrong thing this could do. 30% is the common slab, and
     * printing it would look authoritative and be a number nobody computed.
     */
    const slab = treatmentLabel(taxTreatmentOf('debt', '2023-05-01', '2026-06-01'));
    expect(slab).toBe('STCG · at your slab');
    expect(slab).not.toMatch(/\d+%/);
  });

  it('says the treatment is pending rather than guessing', () => {
    expect(treatmentLabel(taxTreatmentOf(null, '2020-01-01', '2026-06-01'))).toBe(
      'Treatment pending',
    );
  });

  it('trims a registrar name down to the fund', () => {
    /*
     * Verbatim from the live screen, where this name repeated on nine rows for
     * one redemption and pushed the numbers off the table.
     */
    expect(
      displaySchemeName(
        'HDFC Balanced Advantage Fund - Direct Plan - Growth Option (formerly HDFC Growth Fund, erstwhile HDFC Prudence Fund merged) (Non-Demat)',
      ),
    ).toBe('HDFC Balanced Advantage Fund - Direct Plan - Growth');

    expect(displaySchemeName('NJ Flexi Cap Fund - Direct Plan - Growth (Non Demat)')).toBe(
      'NJ Flexi Cap Fund - Direct Plan - Growth',
    );
    expect(displaySchemeName('Navi Liquid Fund (old) - Direct Plan Growth (Demat)')).toBe(
      'Navi Liquid Fund (old) - Direct Plan Growth',
    );
  });

  it('keeps a name that carries no noise', () => {
    expect(displaySchemeName('Parag Parikh Flexi Cap Fund - Direct Plan')).toBe(
      'Parag Parikh Flexi Cap Fund - Direct Plan',
    );
  });

  it('never strips the fund itself', () => {
    // A scheme whose real name contains brackets must survive intact — the
    // segregated portfolios and "(old)" funds are real, distinct holdings.
    const segregated =
      'Nippon India Medium Duration Fund - Segregated Portfolio 2 - Growth Option (Non Demat)';
    expect(displaySchemeName(segregated)).toContain('Segregated Portfolio 2');
    expect(displaySchemeName(segregated)).not.toContain('Non Demat');
  });

  it('names the term, or declines to', () => {
    expect(termLabel(taxTreatmentOf('equity', '2020-01-01', '2026-06-01'))).toBe('Long term');
    expect(termLabel(taxTreatmentOf('equity', '2026-01-01', '2026-06-01'))).toBe('Short term');
    expect(termLabel(taxTreatmentOf(null, '2020-01-01', '2026-06-01'))).toBe('—');
  });
});

/* ----------------------------------------------------------- year totals -- */

describe('the financial year summary', () => {
  const disposalsIn = (fy: string) =>
    computeSchemeGains(
      scheme({ units: 0 }),
      [buy('2020-01-10', 1000, 100_000), sell(fy, 1000, 400)],
      ctx(),
    ).disposals;

  it('applies the exemption to the year, not to each sale', () => {
    /*
     * ₹3L of long-term equity gain in one year is taxed on ₹1.75L after the
     * ₹1.25L exemption — not on ₹3L, and not exempted twice because it came
     * from two sales.
     */
    const d = computeSchemeGains(
      scheme({ units: 0 }),
      [
        buy('2020-01-10', 100, 10_000),
        buy('2020-02-10', 100, 10_000),
        sell('2025-06-10', 100, 1600),
        sell('2025-07-10', 100, 1600),
      ],
      ctx(),
    ).disposals;

    const fy = summariseFinancialYear(d, '2025-26');
    expect(fy.equityLong.gain).toBeCloseTo(300_000, 2);
    expect(fy.exemptionUsed).toBe(125_000);
    // (300,000 - 125,000) x 12.5%
    expect(fy.equityLong.tax).toBeCloseTo(21_875, 2);
  });

  it('uses the ₹1L exemption for years before 2024-25', () => {
    const d = disposalsIn('2023-06-10');
    const fy = summariseFinancialYear(d, '2023-24');
    expect(fy.exemptionUsed).toBe(100_000);
  });

  it('nets a long-term loss against a long-term gain before exempting', () => {
    const d = computeSchemeGains(
      scheme({ units: 0 }),
      [
        buy('2020-01-10', 100, 10_000),
        buy('2020-02-10', 100, 10_000),
        sell('2025-06-10', 100, 2000),  // +₹1.9L
        sell('2025-07-10', 100, 50),    // -₹5,000
      ],
      ctx(),
    ).disposals;
    const fy = summariseFinancialYear(d, '2025-26');
    expect(fy.equityLong.gain).toBeCloseTo(185_000, 2);
  });

  it('reports a slab gain without inventing a rate', () => {
    const d = computeSchemeGains(
      { id: 's1', name: 'A Debt Fund', isin: DEBT_ISIN, units: 0 },
      [buy('2023-05-01', 100, 10_000), sell('2026-06-10', 100, 130)],
      ctx(),
    ).disposals;
    const fy = summariseFinancialYear(d, '2026-27');
    expect(fy.slab.gain).toBeCloseTo(3000, 2);
    expect(fy.indicativeTax).toBe(0);
  });

  it('keeps an undecided scheme out of the tax total but in the gain total', () => {
    const d = computeSchemeGains(
      { id: 's1', name: 'A Multi Asset Fund', isin: 'INF200K01800', units: 0 },
      [buy('2020-01-10', 100, 10_000), sell('2026-06-10', 100, 300)],
      ctx(),
    ).disposals;

    const fy = summariseFinancialYear(d, '2026-27');
    expect(fy.undecided.gain).toBeCloseTo(20_000, 2);
    expect(fy.undecided.schemes).toEqual(['A Multi Asset Fund']);
    expect(fy.indicativeTax).toBe(0);
    expect(fy.totalGain).toBeCloseTo(20_000, 2);
  });

  it('counts only the year asked for', () => {
    const d = [...disposalsIn('2024-06-10'), ...disposalsIn('2025-06-10')];
    expect(summariseFinancialYear(d, '2024-25').totalGain).toBeCloseTo(300_000, 2);
    expect(summariseFinancialYear(d, '2025-26').totalGain).toBeCloseTo(300_000, 2);
  });
});
