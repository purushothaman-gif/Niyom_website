import { describe, expect, it } from 'vitest';
import {
  buildRegistrarLots,
  registrarElssSources,
  type RegistrarHolding,
  type RegistrarTxn,
} from './registrarElss';

function txn(partial: Partial<RegistrarTxn>): RegistrarTxn {
  return {
    folio: '111',
    schemeCode: 'ELS1',
    txnKind: 'purchase',
    amount: 0,
    units: 0,
    nav: null,
    tradeDate: '2025-01-01',
    ...partial,
  };
}

describe('buildRegistrarLots', () => {
  it('FIFO-removes the oldest units on a redemption', () => {
    const lots = buildRegistrarLots([
      txn({ txnKind: 'purchase', tradeDate: '2021-01-01', units: 100, amount: 10_000 }),
      txn({ txnKind: 'purchase', tradeDate: '2022-01-01', units: 100, amount: 12_000 }),
      txn({ txnKind: 'redemption', tradeDate: '2026-01-01', units: 150, amount: 30_000 }),
    ]);
    // 150 sold removes all of the 2021 lot and half of the 2022 lot → 50 left.
    expect(lots).toHaveLength(1);
    expect(lots[0].buyDate).toBe('2022-01-01');
    expect(lots[0].units).toBeCloseTo(50, 3);
    expect(lots[0].costPerUnit).toBeCloseTo(120, 3);
  });

  it('treats a negative purchase as a reversal, not a sale', () => {
    const lots = buildRegistrarLots([
      txn({ txnKind: 'purchase', tradeDate: '2025-01-01', units: 100, amount: 10_000 }),
      txn({ txnKind: 'purchase', tradeDate: '2025-02-01', units: 50, amount: 5_000 }),
      txn({ txnKind: 'purchase', tradeDate: '2025-02-02', units: -50, amount: -5_000 }),
    ]);
    expect(lots).toHaveLength(1);
    expect(lots[0].buyDate).toBe('2025-01-01');
    expect(lots[0].units).toBeCloseTo(100, 3);
  });

  it('skips undated and unknown-kind rows', () => {
    const lots = buildRegistrarLots([
      txn({ txnKind: 'purchase', tradeDate: '2025-01-01', units: 100, amount: 10_000 }),
      txn({ txnKind: 'other', tradeDate: null, units: 2.6e18, amount: 85 }),
      txn({ txnKind: 'purchase', tradeDate: null, units: 999, amount: 9 }),
    ]);
    expect(lots).toHaveLength(1);
    expect(lots[0].units).toBeCloseTo(100, 3);
  });

  it('derives cost per unit from NAV when the amount is missing', () => {
    const lots = buildRegistrarLots([
      txn({ txnKind: 'purchase', tradeDate: '2025-01-01', units: 100, amount: 0, nav: 25 }),
    ]);
    expect(lots[0].costPerUnit).toBeCloseTo(25, 3);
  });
});

const ELSS: RegistrarHolding = {
  folio: '111',
  schemeCode: 'ELS1',
  schemeName: 'Mirae Asset ELSS Tax Saver Fund - Direct - Growth',
  isin: 'INF0ELSS0001',
  units: 150,
  value: 36_000,
};

describe('registrarElssSources', () => {
  it('emits a reconciled ELSS source with current value from the holding', () => {
    const txns = [
      txn({ txnKind: 'purchase', tradeDate: '2021-01-01', units: 100, amount: 10_000 }),
      txn({ txnKind: 'purchase', tradeDate: '2025-06-01', units: 50, amount: 8_000 }),
    ];
    const [s] = registrarElssSources([ELSS], txns);
    expect(s.complete).toBe(true);
    expect(s.openUnits).toBeCloseTo(150, 3);
    expect(s.openCost).toBeCloseTo(18_000, 2);
    // value 36,000 over 150 units = 240/unit → unrealised = 36,000 − 18,000.
    expect(s.unrealised).toBeCloseTo(18_000, 2);
    expect(s.openLots).toHaveLength(2);
  });

  it('marks a scheme incomplete when the feed does not explain the units held', () => {
    // Only 100 units of purchases on file, but 150 are held (50 transferred in).
    const [s] = registrarElssSources([ELSS], [
      txn({ txnKind: 'purchase', tradeDate: '2025-01-01', units: 100, amount: 10_000 }),
    ]);
    expect(s.complete).toBe(false);
  });

  it('ignores non-ELSS holdings', () => {
    const nonElss: RegistrarHolding = { ...ELSS, schemeName: 'Parag Parikh Flexi Cap Fund' };
    expect(registrarElssSources([nonElss], [])).toHaveLength(0);
  });

  it('falls back to folio-level transactions for a single-scheme folio', () => {
    // Holdings code ELS1, transactions code ELS1-DG — mismatch, but one holding
    // in the folio, so the folio's transactions are used.
    const txns = [
      txn({ schemeCode: 'ELS1-DG', txnKind: 'purchase', tradeDate: '2021-01-01', units: 150, amount: 18_000 }),
    ];
    const [s] = registrarElssSources([ELSS], txns);
    expect(s.complete).toBe(true);
    expect(s.openUnits).toBeCloseTo(150, 3);
  });
});
