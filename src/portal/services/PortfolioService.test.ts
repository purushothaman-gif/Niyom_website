/**
 * Aggregation and classification.
 *
 * The classification cases exist because a CAS states no scheme category. The
 * fallback reads the scheme NAME, and if it ever stops working every imported
 * fund silently takes the Equity default — a client's debt allocation would
 * read as zero on a screen that otherwise looks entirely correct.
 */
import { describe, expect, it } from 'vitest';
import type { PortalHolding } from '../types/cas';
import { MF_OWNERSHIP } from '../types/ownership';
import { PortfolioService } from './PortfolioService';

const fund = (name: string, o: Partial<PortalHolding> = {}): PortalHolding =>
  ({
    id: name,
    client_id: 'c',
    product_type: 'mutual_fund',
    product_name: name,
    quantity: 10,
    avg_cost: 8,
    current_value: 100,
    invested_amount: 80,
    maturity_date: '',
    notes: '',
    created_at: '',
    updated_at: '',
    ...o,
  }) as PortalHolding;

const classOf = (name: string, o: Partial<PortalHolding> = {}) =>
  PortfolioService.buildHoldingRows([fund(name, o)])[0].assetClass;

describe('asset classification from the scheme name', () => {
  it('classifies debt funds as Debt', () => {
    expect(classOf('Navi Liquid Fund - Direct Plan Growth')).toBe('Debt');
    expect(classOf('SBI Magnum Gilt Fund - Direct')).toBe('Debt');
    expect(classOf('HDFC Overnight Fund - Direct Growth')).toBe('Debt');
    expect(classOf('ICICI Prudential Corporate Bond Fund')).toBe('Debt');
  });

  it('classifies hybrid funds as Hybrid', () => {
    expect(classOf('HDFC Balanced Advantage Fund - Direct Plan')).toBe('Hybrid');
    expect(classOf('ICICI Prudential Multi Asset Fund')).toBe('Hybrid');
    expect(classOf('Kotak Equity Hybrid Fund - Direct')).toBe('Hybrid');
  });

  it('classifies equity funds as Equity', () => {
    expect(classOf('quant ELSS Tax Saver Fund - Direct Plan')).toBe('Equity');
    expect(classOf('Parag Parikh Flexi Cap Fund - Direct')).toBe('Equity');
    expect(classOf('UTI Nifty 50 Index Fund - Direct Plan')).toBe('Equity');
    expect(classOf('Axis Mid Cap Fund - Direct Growth')).toBe('Equity');
  });

  it('still prefers an explicit scheme_type when one exists', () => {
    // Manually maintained rows carry a category; the name fallback must not
    // override what staff recorded.
    expect(classOf('Some Ambiguous Fund', { scheme_type: 'liquid' })).toBe('Debt');
  });

  it('does not bucket every imported fund as Uncategorised', () => {
    const rows = PortfolioService.buildHoldingRows([
      fund('Navi Liquid Fund'),
      fund('HDFC Balanced Advantage Fund'),
      fund('quant ELSS Tax Saver Fund'),
    ]);
    expect(new Set(rows.map((r) => r.category)).size).toBe(3);
    expect(rows.map((r) => r.category)).not.toContain('Uncategorised');
  });

  it('leaves non-fund asset classes alone', () => {
    const rows = PortfolioService.buildHoldingRows([
      fund('A Bond', { product_type: 'secondary_bond' }),
      fund('A Policy', { product_type: 'insurance' }),
      fund('An FD', { product_type: 'fixed_deposit' }),
      fund('Some Shares', { product_type: 'unlisted_share' }),
    ]);
    expect(rows.map((r) => r.assetClass).sort()).toEqual(['Debt', 'Debt', 'Equity', 'Insurance']);
  });
});

describe('ownership on holding rows', () => {
  it('carries the statement ownership through to the row', () => {
    const [row] = PortfolioService.buildHoldingRows([
      fund('quant ELSS', {
        cas: {
          source: 'cas',
          importId: 'i',
          importedAt: '',
          statementTo: null,
          schemeId: 's',
          isin: null,
          rtaCode: null,
          schemeName: 'quant ELSS',
          amc: null,
          folioNumber: '1',
          registrar: null,
          units: 1,
          value: 100,
          cost: 80,
          navDate: null,
          advisorCode: 'ARN-163992',
          isOurs: false,
          ownership: MF_OWNERSHIP.heldAway,
        },
      }),
    ]);
    expect(row.ownership).toBe(MF_OWNERSHIP.heldAway);
    expect(row.cas?.folioNumber).toBe('1');
  });

  it('leaves ownership undefined for a manually held row', () => {
    // We recorded it, but that proves nothing about whose ARN it sits under —
    // so the badge renders nothing rather than claiming it is ours.
    expect(PortfolioService.buildHoldingRows([fund('A Fund')])[0].ownership).toBeUndefined();
  });

  it('leaves ownership undefined for every non-fund product', () => {
    const [row] = PortfolioService.buildHoldingRows([
      fund('A Bond', { product_type: 'secondary_bond' }),
    ]);
    expect(row.ownership).toBeUndefined();
  });
});

describe('summary aggregation spans every product', () => {
  it('totals value and gain across asset classes', () => {
    const s = PortfolioService.buildSummary([
      fund('A Fund', { current_value: 100, invested_amount: 80 }),
      fund('A Bond', { product_type: 'secondary_bond', current_value: 200, invested_amount: 200 }),
    ]);
    expect(s.netWorth).toBe(300);
    expect(s.invested).toBe(280);
    expect(s.gain).toBe(20);
    expect(s.productCount).toBe(2);
  });

  it('rolls up mutual funds separately from everything else', () => {
    const mf = PortfolioService.buildMutualFundSummary([
      fund('A Fund', { current_value: 100, invested_amount: 80, folio_number: 'F1' }),
      fund('A Bond', { product_type: 'secondary_bond', current_value: 900, invested_amount: 900 }),
    ]);
    expect(mf.value).toBe(100);
    expect(mf.folioCount).toBe(1);
  });
});
