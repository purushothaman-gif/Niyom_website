import { describe, expect, it } from 'vitest';
import { fromPartnerHoldings, nextPayoutDate, summarise, type InvestmentRow } from './model';
import { coreFundName, pickCandidate } from '../../mf/fundEnrich';

const row = (p: Partial<InvestmentRow>): InvestmentRow => ({
  id: Math.random().toString(36),
  asset: 'bond',
  productType: 'secondary_bond',
  name: 'x',
  units: null,
  avgPrice: null,
  price: null,
  invested: 100,
  value: 110,
  gain: 10,
  gainPct: 10,
  dayChange: null,
  dayChangePct: null,
  source: 'niyom',
  ...p,
});

describe('summarise', () => {
  it('computes returns only over known-cost holdings', () => {
    const s = summarise([
      row({ invested: 100, value: 110 }),
      row({ asset: 'mutual_fund', invested: null, value: 1000, gain: null, gainPct: null, source: 'registrar' }),
    ]);
    expect(s.current).toBe(1110);
    expect(s.invested).toBe(100);
    expect(s.returns).toBe(10);
    expect(s.returnsPct).toBeCloseTo(10);
    expect(s.unknownCostCount).toBe(1);
    expect(s.costCoveragePct).toBeCloseTo((110 / 1110) * 100);
  });

  it('reports unknown (not 0%) returns when no cost is known', () => {
    const s = summarise([row({ invested: null, gain: null, gainPct: null })]);
    expect(s.returnsPct).toBeNull();
  });

  it('day change is null unless a real move exists', () => {
    expect(summarise([row({})]).dayChange).toBeNull();
    const s = summarise([row({ value: 101, dayChange: 1, dayChangePct: 1 })]);
    expect(s.dayChange).toBe(1);
    expect(s.dayChangePct).toBeCloseTo(1);
  });
});

describe('fromPartnerHoldings', () => {
  it('treats registrar MF as unknown cost', () => {
    const [r] = fromPartnerHoldings(
      [{ holding_id: 'h', product_type: 'mutual_fund', product_name: 'F', quantity: 1, avg_price: 0, invested_amount: 50, current_value: 50, gain_loss: 0 }],
      { registrarMf: true },
    );
    expect(r.invested).toBeNull();
    expect(r.gainPct).toBeNull();
  });
});

describe('nextPayoutDate', () => {
  it('rolls a quarterly anchor forward', () => {
    expect(nextPayoutDate('2026-01-15', 'Quarterly', '2030-01-01', new Date('2026-11-04'))).toBe('2027-01-15');
  });
  it('stops after maturity', () => {
    expect(nextPayoutDate('2026-01-15', 'Annual', '2026-06-01', new Date('2026-11-04'))).toBeNull();
  });
});

describe('fund matching', () => {
  const cands = [
    { isin: 'A', amfi_code: '1', scheme_name: 'Quant Small Cap Fund - Direct Plan - Growth', nav: 300, nav_date: 'd' },
    { isin: 'B', amfi_code: '2', scheme_name: 'Quant Small Cap Fund - Regular Plan - Growth Option', nav: 273, nav_date: 'd' },
    { isin: 'C', amfi_code: '3', scheme_name: 'Quant Small Cap Fund - Regular Plan - IDCW', nav: 40, nav_date: 'd' },
    { isin: 'D', amfi_code: '4', scheme_name: 'Quant Smart Small Cap Fund - Regular Plan - Growth', nav: 20, nav_date: 'd' },
  ];
  it('normalises plan/option noise away', () => {
    expect(coreFundName('Quant Small Cap Fund -Growth')).toBe('quant small cap');
  });
  it('picks the regular growth plan for a registrar name without a plan', () => {
    expect(pickCandidate('Quant Small Cap Fund -Growth', cands)?.isin).toBe('B');
  });
  it('honours IDCW and never substring-matches a different fund', () => {
    expect(pickCandidate('Quant Small Cap Fund - Regular IDCW', cands)?.isin).toBe('C');
    expect(pickCandidate('Quant Smart Cap Fund', cands)).toBeNull();
  });
});
