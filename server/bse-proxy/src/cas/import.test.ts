/**
 * The reconciliation gate decides whether a client's portfolio is allowed in.
 *
 * It has to stay strict — a dropped transaction shows the wrong money — while
 * not refusing statements that are correct but unusual. The segregated-portfolio
 * case below is the second kind, and it blocked a real import on 04-Aug-2026.
 */
import { describe, expect, it } from 'vitest';
import { reconcileDetailed } from './import.js';
import type { CasDetailedScheme } from './detailed.js';

const scheme = (over: Partial<CasDetailedScheme> = {}): CasDetailedScheme => ({
  amc: 'Nippon India Mutual Fund',
  folioNumber: '405144928343/0',
  rtaCode: '',
  schemeName: 'NIPPON INDIA LIQUID FUND - GROWTH PLAN',
  isin: '',
  advisorCode: '',
  registrar: 'KFINTECH',
  isDemat: false,
  openingUnits: 0,
  closingUnits: 0,
  costValue: 0,
  nav: 10,
  navDate: '2026-08-04',
  marketValue: 0,
  transactions: [],
  balanceMismatch: null,
  ...over,
});

const txn = (units: number, type = 'PURCHASE') => ({
  date: '2026-01-01',
  description: 'Purchase',
  amount: units * 10,
  units,
  nav: 10,
  balanceUnits: units,
  type,
});

describe('reconcileDetailed — segregated portfolios', () => {
  /*
   * When an issuer defaults, the AMC side-pockets the doubtful paper and
   * credits holders with units of a "Segregated Portfolio". Nobody bought them,
   * so the statement prints no transaction — and the unit checks read that as a
   * whole block of dropped ones.
   */
  it('accepts side-pocketed units that have no transactions', () => {
    const result = reconcileDetailed(
      [
        scheme({
          schemeName: 'NIPPON INDIA MEDIUM DURATION FUND - SEGREGATED PORTFOLIO 2 - GROWTH PLAN',
          closingUnits: 4768.581,
          transactions: [],
        }),
      ],
      [],
    );
    expect(result.failures).toEqual([]);
    expect(result.reconciled).toBe(true);
    // Passed, but not silently.
    expect(result.warnings.join(' ')).toContain('segregated portfolio');
  });

  it('still fails an ORDINARY scheme whose transactions are missing', () => {
    // The exemption must not become a way for a dropped block to slip through.
    const result = reconcileDetailed(
      [scheme({ closingUnits: 4768.581, transactions: [] })],
      [],
    );
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.reconciled).toBe(false);
  });

  it('still checks a segregated portfolio that DOES carry transactions', () => {
    // If the statement prints a ledger for it, that ledger has to add up.
    const result = reconcileDetailed(
      [
        scheme({
          schemeName: 'ABC DEBT FUND - SEGREGATED PORTFOLIO 1',
          closingUnits: 100,
          transactions: [txn(40)],
        }),
      ],
      [],
    );
    expect(result.failures.length).toBeGreaterThan(0);
  });
});

describe('reconcileDetailed — the checks that must keep firing', () => {
  it('passes a scheme whose ledger adds up', () => {
    const result = reconcileDetailed(
      [scheme({ closingUnits: 40, transactions: [txn(40)] })],
      [],
    );
    expect(result.failures).toEqual([]);
  });

  it('fails a unit-bearing transaction it could not name', () => {
    const result = reconcileDetailed(
      [
        scheme({
          closingUnits: 40,
          transactions: [{ ...txn(40), type: 'OTHER', description: 'Registration of Nominee' }],
        }),
      ],
      [],
    );
    expect(result.failures.join(' ')).toContain('could not be identified');
  });
});
