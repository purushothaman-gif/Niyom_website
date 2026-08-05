/**
 * The engine against a real ledger, tied to the statement's own arithmetic.
 *
 * A unit test proves the engine does what I told it to. This proves it agrees
 * with the REGISTRAR — which is the only opinion that matters, because it is the
 * one the client can check.
 *
 * The ledger below is a real five-year SIP in HSBC Value Fund: 48 instalments, a
 * reversed first instalment, and eight redemptions between 2021 and 2026. No
 * folio, name or PAN — the numbers alone are what is under test.
 *
 * The check that makes it worth having: after FIFO has consumed lots across
 * eight separate sales, the cost of what REMAINS must equal the "Total Cost
 * Value" the statement prints for the same units. Those two numbers are computed
 * by entirely different parties from entirely different code. If they agree to
 * the paisa, the lots consumed were the right ones.
 */
import { describe, expect, it } from 'vitest';
import { computeSchemeGains, summariseFinancialYear } from './gains';

/** [date, type, amount, units, nav, balance_units] — verbatim from the import. */
const LEDGER: [string, string, number, number, number, number][] = JSON.parse(
  `[["2016-05-02","PURCHASE",2000,81.927,24.412,81.927],["2016-05-02","PURCHASE",-2000,-81.927,24.412,0],["2016-06-27","PURCHASE",2000,78.407,25.508,78.407],["2016-07-25","PURCHASE",2000,72.044,27.761,150.451],["2016-08-25","PURCHASE",2000,72.33,27.651,222.781],["2016-09-26","PURCHASE",2000,69.691,28.698,292.472],["2016-10-25","PURCHASE",2000,66.37,30.134,358.842],["2016-11-25","PURCHASE",2000,71.656,27.911,430.498],["2016-12-26","PURCHASE",2000,75.338,26.547,505.836],["2017-01-25","PURCHASE",2000,66.711,29.98,572.547],["2017-02-27","PURCHASE",2000,64.524,30.996,637.071],["2017-03-27","PURCHASE",2000,63.776,31.36,700.847],["2017-04-25","PURCHASE",2000,58.919,33.945,759.766],["2017-05-25","PURCHASE",2000,60.047,33.307,819.813],["2017-06-27","PURCHASE",2000,59.557,33.581,879.37],["2017-07-25","PURCHASE",2000,56.207,35.583,935.577],["2017-08-28","PURCHASE",2000,56.507,35.394,992.084],["2017-09-25","PURCHASE",2000,56.876,35.164,1048.96],["2017-10-25","PURCHASE",2000,54.215,36.89,1103.175],["2017-11-27","PURCHASE",2000,52.787,37.888,1155.962],["2017-12-26","PURCHASE",2000,51.443,38.878,1207.405],["2018-01-25","PURCHASE",2000,50.008,39.994,1257.413],["2018-02-26","PURCHASE",2000,52.604,38.02,1310.017],["2018-03-26","PURCHASE",2000,55.662,35.931,1365.679],["2018-04-25","PURCHASE",2000,53.05,37.7,1418.729],["2018-05-25","PURCHASE",2000,54.948,36.398,1473.677],["2018-06-25","PURCHASE",2000,56.526,35.382,1530.203],["2018-07-25","PURCHASE",2000,55.757,35.87,1585.96],["2018-08-27","PURCHASE",2000,52.733,37.927,1638.693],["2018-09-25","PURCHASE",2000,56.496,35.401,1695.189],["2018-10-25","PURCHASE",2000,62.058,32.228,1757.247],["2018-11-26","PURCHASE",2000,58.649,34.101,1815.896],["2018-12-26","PURCHASE",2000,58.584,34.139,1874.48],["2019-01-25","PURCHASE",2000,59.65,33.529,1934.13],["2019-02-25","PURCHASE",2000,60.154,33.248,1994.284],["2019-03-25","PURCHASE",2000,57.136,35.004,2051.42],["2019-04-25","PURCHASE",2000,56.082,35.662,2107.502],["2019-05-27","PURCHASE",2000,53.965,37.061,2161.467],["2019-06-25","PURCHASE",2000,55.394,36.105,2216.861],["2019-07-25","PURCHASE",2000,58.243,34.339,2275.104],["2019-08-26","PURCHASE",2000,60.297,33.169,2335.401],["2019-09-25","PURCHASE",2000,58.207,34.36,2393.608],["2019-10-25","PURCHASE",2000,57.777,34.616,2451.385],["2019-11-25","PURCHASE",2000,55.882,35.79,2507.267],["2019-12-26","PURCHASE",2000,55.839,35.817,2563.106],["2020-01-27","PURCHASE",2000,53.674,37.262,2616.78],["2020-02-25","PURCHASE",2000,54.807,36.492,2671.587],["2020-03-25","PURCHASE",2000,82.539,24.231,2754.126],["2020-04-27","PURCHASE",2000,72.876,27.444,2827.002],["2021-05-06","REDEMPTION",-30000,-642.955,46.66,2184.047],["2021-05-06","STT",0.3,0,0,2184.047],["2022-03-02","REDEMPTION",-44000,-801.743,54.881,1382.304],["2022-03-02","STT",0.44,0,0,1382.304],["2022-07-19","REDEMPTION",-10000,-185.772,53.83,1196.532],["2022-07-19","STT",0.1,0,0,1196.532],["2022-07-19","REDEMPTION",-10000,-185.772,53.83,1010.76],["2022-07-19","STT",0.1,0,0,1010.76],["2022-10-04","REDEMPTION",-8000,-139.347,57.411,871.413],["2022-10-04","STT",0.08,0,0,871.413],["2023-07-06","REDEMPTION",-30000,-438.281,68.45,433.132],["2023-07-06","STT",0.3,0,0,433.132],["2025-10-07","REDEMPTION",-15000,-136.043,110.2604,297.089],["2025-10-07","STT",0.15,0,0,297.089],["2026-01-07","REDEMPTION",-5000,-43.276,115.5395,253.813],["2026-01-07","STT",0.05,0,0,253.813]]`,
);

const ISIN = 'INF677K01023';

/** What the statement itself prints for this scheme. */
const STATEMENT = { closingUnits: 253.813, totalCost: 7624.29 };

const txns = LEDGER.map(([txn_date, txn_type, amount, units, nav, balance_units]) => ({
  scheme_id: 's1', txn_date, txn_type, amount, units, nav, balance_units,
}));

const run = () =>
  computeSchemeGains(
    { id: 's1', name: 'HSBC Value Fund - Regular Growth', isin: ISIN, units: STATEMENT.closingUnits },
    txns,
    {
      assetClassByIsin: new Map([[ISIN, 'equity' as const]]),
      // NAV on 31-Jan-2018, from AMFI's historical report.
      grandfatherNavByIsin: new Map([[ISIN, 39.298]]),
      currentNavByIsin: new Map([[ISIN, 113.49]]),
    },
  );

describe('a real five-year SIP with eight redemptions', () => {
  it('agrees with the statement on what is left', () => {
    const g = run();
    expect(g.complete).toBe(true);
    expect(g.openUnits).toBeCloseTo(STATEMENT.closingUnits, 3);
    // The whole point: an independent FIFO walk lands on the registrar's figure.
    expect(g.openCost).toBeCloseTo(STATEMENT.totalCost, 2);
  });

  it('leaves exactly the four newest lots open', () => {
    // FIFO sold the oldest units, so what survives is the tail of the SIP —
    // three whole instalments and part of a fourth.
    const g = run();
    expect(g.openLots.map((l) => l.buyDate)).toEqual([
      '2020-01-27', '2020-02-25', '2020-03-25', '2020-04-27',
    ]);
    expect(g.openLots[0].units).toBeCloseTo(43.591, 3); // partially consumed
    expect(g.openLots[1].cost).toBeCloseTo(2000, 2);    // a whole instalment
  });

  it('absorbs the reversed first instalment without a disposal', () => {
    /*
     * The ledger opens with a +81.927 purchase and its -81.927 reversal on the
     * same day, and the database hands them over in an arbitrary order. Neither
     * may become a sale, and neither may leave a stray unit behind.
     */
    const g = run();
    expect(g.disposals.every((d) => d.buyDate !== '2016-05-02')).toBe(true);
    expect(g.openLots.every((l) => l.buyDate !== '2016-05-02')).toBe(true);
  });

  it('grandfathers every pre-2018 lot and no other', () => {
    const g = run();
    const gf = g.disposals.filter((d) => d.grandfathered);
    expect(gf.length).toBe(20);
    expect(gf.every((d) => d.buyDate < '2018-02-01')).toBe(true);
    expect(g.disposals.filter((d) => d.buyDate >= '2018-02-01').every((d) => !d.grandfathered)).toBe(true);
  });

  it('exempts the pre-2018 growth rather than taxing it', () => {
    const g = run();
    const withRelief = g.disposals.reduce((s, d) => s + d.gain, 0);
    const without = g.disposals.reduce((s, d) => s + (d.proceeds - d.actualCost), 0);
    expect(withRelief).toBeCloseTo(56_177.27, 2);
    expect(without).toBeCloseTo(65_625.87, 2);
    // ₹9,448.60 of gain that accrued before 01-Feb-2018, correctly untaxed.
    expect(without - withRelief).toBeCloseTo(9_448.6, 2);
  });

  it('re-bases one lot exactly as s.55(2)(ac) requires', () => {
    /*
     * Bought 27-Jun-2016 at ₹25.5079, worth ₹39.298 on 31-Jan-2018, sold
     * 06-May-2021 at ₹46.66.
     *   cost = max(2000, min(39.298 x 78.407, 46.66 x 78.407)) = 3081.24
     */
    const d = run().disposals.find((x) => x.buyDate === '2016-06-27');
    expect(d?.actualCost).toBeCloseTo(2000, 2);
    expect(d?.cost).toBeCloseTo(3081.24, 2);
    expect(d?.gain).toBeCloseTo(577.23, 2);
    expect(d?.treatment.term).toBe('long');
  });

  it('treats every sale here as long-term', () => {
    // A SIP that ran to 2020 and was first redeemed in 2021: nothing was held
    // under twelve months, so no short-term gain should appear at all.
    const g = run();
    expect(g.disposals.every((d) => d.treatment.term === 'long')).toBe(true);
  });

  it('values what is still held at the latest NAV', () => {
    const g = run();
    expect(g.unrealised).toBeCloseTo(253.813 * 113.49 - STATEMENT.totalCost, 2);
  });

  it('spreads the disposals across the years they were sold in', () => {
    const g = run();
    expect(summariseFinancialYear(g.disposals, '2021-22').equityLong.gain).toBeCloseTo(17_606.92, 2);
    expect(summariseFinancialYear(g.disposals, '2022-23').equityLong.gain).toBeCloseTo(10_232.02, 2);
    expect(summariseFinancialYear(g.disposals, '2023-24').equityLong.gain).toBeCloseTo(14_704.73, 2);
    expect(summariseFinancialYear(g.disposals, '2025-26').equityLong.gain).toBeCloseTo(13_633.6, 2);
  });
});
