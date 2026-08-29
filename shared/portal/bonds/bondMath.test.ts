/**
 * The lot rule and the order breakdown.
 *
 * These decide the quantity a client may order and the rupee figure they see
 * before they commit, on BOTH the website and the phone. The server re-derives
 * the amount in `place-bond-order` and is the authority — which is precisely
 * why this needs testing: a divergence here does not produce an error, it
 * produces a confirmation screen quoting a different number from the review
 * screen that preceded it.
 */
import { describe, it, expect } from 'vitest';
import { breakdown, minUnits, stepUnits, tenureLabel } from './bondMath';
import type { ClientBond } from '../services/BondOrderService';

function bond(over: Partial<ClientBond> = {}): ClientBond {
  return {
    id: 'b1',
    isin: 'INE000A01001',
    bond_name: 'Test 10.5% 2030',
    issuer_name: 'Test Issuer Ltd',
    coupon_rate: 10.5,
    coupon_type: 'fixed',
    coupon_frequency: 'monthly',
    maturity_date: '2030-06-30',
    next_coupon_date: null,
    issue_date: null,
    rating: 'CARE A-',
    rating_agency: 'CARE',
    security_type: 'secured',
    tax_status: 'taxable',
    trustee: null,
    day_count_convention: null,
    principal_repayment_structure: null,
    min_investment: 100000,
    face_value: 100000,
    client_price: 100,
    analytics: null,
    ...over,
  };
}

describe('minUnits / stepUnits', () => {
  it('is one unit when the minimum investment is one bond', () => {
    expect(minUnits(bond({ min_investment: 100000, face_value: 100000 }))).toBe(1);
  });

  it('rounds a minimum that is not a whole number of bonds UP', () => {
    // ₹250,000 minimum against ₹100,000 face is 2.5 bonds — you cannot buy half
    // a bond, and rounding DOWN would offer a quantity below the minimum.
    expect(minUnits(bond({ min_investment: 250000, face_value: 100000 }))).toBe(3);
  });

  it('falls back to one bond when no minimum is set', () => {
    expect(minUnits(bond({ min_investment: null, face_value: 1000 }))).toBe(1);
  });

  it('treats a missing face value as ₹100', () => {
    expect(minUnits(bond({ min_investment: 1000, face_value: null }))).toBe(10);
  });

  it('never returns zero, even for a nonsensical minimum', () => {
    expect(minUnits(bond({ min_investment: 0, face_value: 100000 }))).toBe(1);
  });

  it('steps by the minimum lot', () => {
    const b = bond({ min_investment: 250000, face_value: 100000 });
    expect(stepUnits(b)).toBe(minUnits(b));
  });
});

describe('breakdown', () => {
  it('prices at par with no accrued interest', () => {
    const bd = breakdown(bond({ client_price: 100, face_value: 100000 }), 2);
    expect(bd.faceValueTotal).toBe(200000);
    expect(bd.investment).toBe(200000);
    expect(bd.premium).toBe(0);
    expect(bd.accrued).toBe(0);
    expect(bd.amountPayable).toBe(200000);
    expect(bd.pricePerUnit).toBe(100000);
  });

  it('charges a premium above par and reports it', () => {
    const bd = breakdown(bond({ client_price: 102.5, face_value: 100000 }), 1);
    expect(bd.investment).toBe(102500);
    expect(bd.premium).toBe(2500);
    expect(bd.amountPayable).toBe(102500);
  });

  it('reports a discount below par as a NEGATIVE premium', () => {
    const bd = breakdown(bond({ client_price: 97, face_value: 100000 }), 1);
    expect(bd.investment).toBe(97000);
    expect(bd.premium).toBe(-3000);
  });

  it('adds accrued interest on top of the investment', () => {
    const bd = breakdown(
      bond({ client_price: 100, face_value: 100000, analytics: { accrued_per_100: 1.25 } }),
      2,
    );
    expect(bd.accruedPer100).toBe(1.25);
    expect(bd.accrued).toBe(2500);
    expect(bd.amountPayable).toBe(202500);
  });

  it('leaves stamp duty at zero — it is finalised on the deal confirmation', () => {
    expect(breakdown(bond(), 1).stampDuty).toBe(0);
  });

  it('rounds to paise rather than accumulating a float tail', () => {
    const bd = breakdown(bond({ client_price: 101.333, face_value: 1000 }), 3);
    // 3 × 1000 × 1.01333 = 3039.99, not 3039.9899999999993
    expect(bd.investment).toBe(3039.99);
  });

  it('estimates maturity value from future interest, assuming bullet redemption', () => {
    const bd = breakdown(
      bond({
        client_price: 100,
        face_value: 100000,
        analytics: { total_future_interest_per_100: 32.5 },
      }),
      1,
    );
    // 100 principal + 32.5 interest, per ₹100 face.
    expect(bd.estMaturityValue).toBe(132500);
  });

  it('uses a stated future principal instead of assuming a bullet', () => {
    const bd = breakdown(
      bond({
        client_price: 100,
        face_value: 100000,
        analytics: { total_future_interest_per_100: 10, total_future_principal_per_100: 60 },
      }),
      1,
    );
    // An amortising bond that has already repaid 40% of principal.
    expect(bd.estMaturityValue).toBe(70000);
  });

  it('says nothing rather than guessing when no cashflow data exists', () => {
    expect(breakdown(bond({ analytics: null }), 1).estMaturityValue).toBeNull();
  });

  it('treats a missing price as zero rather than NaN', () => {
    const bd = breakdown(bond({ client_price: null }), 1);
    expect(bd.investment).toBe(0);
    expect(bd.amountPayable).toBe(0);
  });
});

describe('tenureLabel', () => {
  it('prefers years-to-maturity from analytics', () => {
    expect(tenureLabel(bond({ analytics: { years_to_maturity: 4.27 } }))).toBe('4.3 yr');
  });

  it('switches to months under a year', () => {
    expect(tenureLabel(bond({ analytics: { years_to_maturity: 0.5 } }))).toBe('6 mo');
  });

  it('never says "0 mo" for a bond days from maturity', () => {
    expect(tenureLabel(bond({ analytics: { years_to_maturity: 0.01 } }))).toBe('1 mo');
  });

  it('falls back to the maturity date when analytics are missing', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 3);
    expect(tenureLabel(bond({ analytics: null, maturity_date: future.toISOString() }))).toMatch(/^3\.0 yr$/);
  });

  it('admits it does not know rather than showing a past tenure', () => {
    expect(tenureLabel(bond({ analytics: null, maturity_date: '2020-01-01' }))).toBe('—');
    expect(tenureLabel(bond({ analytics: null, maturity_date: null }))).toBe('—');
    expect(tenureLabel(bond({ analytics: null, maturity_date: 'not a date' }))).toBe('—');
  });
});
