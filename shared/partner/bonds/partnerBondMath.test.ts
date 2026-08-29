/**
 * The partner's spread.
 *
 * This decides what a partner's client is quoted and what the partner earns, on
 * three surfaces (order, share link, app) against a server that computes it a
 * fourth time. The cases below are mostly about the boundaries — an empty field,
 * a margin over the cap, a price landing exactly on a rounding edge — because
 * those are where the two hand-written web copies had already drifted apart.
 */
import { describe, it, expect } from 'vitest';
import {
  MAX_PARTNER_MARGIN,
  clampMargin,
  isMarginValid,
  partnerBreakdown,
  partnerPricePer100,
} from './partnerBondMath';
import type { PartnerBond } from '../services/PartnerService';

function bond(over: Partial<PartnerBond> = {}): PartnerBond {
  return {
    id: 'pb1',
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
    seniority: null,
    tax_status: 'taxable',
    trustee: null,
    day_count_convention: null,
    principal_repayment_structure: null,
    min_investment: 100000,
    face_value: 100000,
    partner_base: 100,
    self_markup_percent: 0,
    partner_price: 100,
    analytics: null,
    ...over,
  };
}

describe('clampMargin', () => {
  it('takes a plain number through unchanged', () => {
    expect(clampMargin(2.5)).toBe(2.5);
  });

  it('parses what a text field actually holds', () => {
    expect(clampMargin('1.25')).toBe(1.25);
  });

  it('treats an emptied field as pricing at cost, not as NaN', () => {
    // The whole screen renders off this. NaN here would put "₹NaN" on every row.
    expect(clampMargin('')).toBe(0);
    expect(clampMargin(null)).toBe(0);
    expect(clampMargin(undefined)).toBe(0);
    expect(clampMargin('abc')).toBe(0);
  });

  it('caps at 5% and floors at zero, matching the server', () => {
    expect(clampMargin(9)).toBe(MAX_PARTNER_MARGIN);
    expect(clampMargin(-3)).toBe(0);
    expect(clampMargin(5)).toBe(5);
  });

  it('rejects infinities rather than propagating them', () => {
    expect(clampMargin(Infinity)).toBe(0);
  });
});

describe('isMarginValid', () => {
  it('accepts anything inside the band, including the ends', () => {
    expect(isMarginValid('0')).toBe(true);
    expect(isMarginValid('5')).toBe(true);
    expect(isMarginValid(2.5)).toBe(true);
  });

  it('rejects an empty field — unanswered is not the same as zero', () => {
    // clampMargin('') is 0 so the figures still render, but the partner has not
    // yet said what their margin is, so the button stays disabled.
    expect(isMarginValid('')).toBe(false);
  });

  it('rejects out-of-band values instead of silently clamping them', () => {
    expect(isMarginValid('7')).toBe(false);
    expect(isMarginValid('-1')).toBe(false);
  });
});

describe('partnerPricePer100', () => {
  it('is the cost when the margin is zero', () => {
    expect(partnerPricePer100(bond({ partner_base: 101.4321 }), 0)).toBe(101.4321);
  });

  it('adds the spread on top of the cost', () => {
    expect(partnerPricePer100(bond({ partner_base: 100 }), 2)).toBe(102);
    expect(partnerPricePer100(bond({ partner_base: 98.5 }), 1.5)).toBe(99.9775);
  });

  it('keeps four decimals — it is a rate that gets multiplied out, not money', () => {
    // 100.37 × 1.0125 = 101.624625; rounding to paise here would move the
    // amount payable on a ₹1 Cr trade by rupees, not paise.
    expect(partnerPricePer100(bond({ partner_base: 100.37 }), 1.25)).toBe(101.6246);
  });

  it('rounds a value sitting exactly on the edge consistently', () => {
    // This is the case the two hand-written web copies disagreed on: one nudged
    // by EPSILON before rounding and the other did not.
    expect(partnerPricePer100(bond({ partner_base: 1.00005 }), 0)).toBe(1.0001);
  });

  it('clamps an over-cap margin rather than pricing above it', () => {
    expect(partnerPricePer100(bond({ partner_base: 100 }), 9)).toBe(105);
  });

  it('treats a missing cost as zero rather than NaN', () => {
    expect(partnerPricePer100(bond({ partner_base: null }), 2)).toBe(0);
  });
});

describe('partnerBreakdown', () => {
  it('prices a lot at the partner price', () => {
    const bd = partnerBreakdown(bond({ partner_base: 100, face_value: 100000 }), 2, 0);
    expect(bd.pricePer100).toBe(100);
    expect(bd.investment).toBe(200000);
    expect(bd.amount).toBe(200000);
  });

  it('reports what the spread earns on the trade', () => {
    // 2% on 2 units of ₹1L face bought at cost 100 = ₹4,000.
    const bd = partnerBreakdown(bond({ partner_base: 100, face_value: 100000 }), 2, 2);
    expect(bd.investment).toBe(204000);
    expect(bd.yourMargin).toBe(4000);
  });

  it('earns nothing at a zero margin', () => {
    expect(partnerBreakdown(bond({ partner_base: 100 }), 3, 0).yourMargin).toBe(0);
  });

  it('adds accrued interest on top, and excludes it from the margin', () => {
    // Accrued is the seller's coupon, not the partner's income.
    const bd = partnerBreakdown(
      bond({ partner_base: 100, face_value: 100000, analytics: { accrued_per_100: 1.25 } }),
      2,
      2,
    );
    expect(bd.accrued).toBe(2500);
    expect(bd.amount).toBe(206500);
    expect(bd.yourMargin).toBe(4000);
  });

  it('leaves stamp duty out — it is settled on the deal confirmation', () => {
    const bd = partnerBreakdown(bond({ partner_base: 100, face_value: 100000 }), 1, 1);
    expect(bd.amount).toBe(bd.investment + bd.accrued);
  });

  it('rounds money to paise, not to the fourth place the rate carries', () => {
    const bd = partnerBreakdown(bond({ partner_base: 100.37, face_value: 1000 }), 3, 1.25);
    expect(bd.pricePer100).toBe(101.6246);
    expect(bd.investment).toBe(3048.74); // 3 × 1000 × 1.016246 = 3048.738
  });

  it('defaults a missing face value to ₹100', () => {
    expect(partnerBreakdown(bond({ face_value: null, partner_base: 100 }), 1, 0).face).toBe(100);
  });

  it('agrees with partnerPricePer100 on the same inputs', () => {
    // One rate, whichever function asks for it — the property the file exists for.
    const b = bond({ partner_base: 97.3333 });
    for (const m of ['0', '0.5', '1.7', '5', '']) {
      expect(partnerBreakdown(b, 4, m).pricePer100).toBe(partnerPricePer100(b, m));
    }
  });
});
