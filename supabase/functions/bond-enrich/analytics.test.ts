import { describe, it, expect } from 'vitest';
import { computeAnalytics, buildCouponPattern, parseMonthlyRule, parseSeedPairs, settlementFrom, type AnalyticsInput } from './analytics';

// Every expected figure below is worked by hand from the bond's own terms — not read back
// from the engine. Accrued per ₹100 = coupon% × days ÷ basis.

const base = (o: Partial<AnalyticsInput>): AnalyticsInput => ({
  couponRate: 10, frequency: 'monthly', maturityISO: '2029-08-24', dayCount: 'actual_actual',
  bizConv: 'following', holidays: new Set(), cleanPricePer100: 100, settlementISO: '2026-11-06', ...o,
});

describe('coupon calendar comes from the IP-date text, not the maturity month', () => {
  it('monthly "01ST OF EVERY MONTH" accrues from the 1st (was: maturity day 24)', () => {
    const a = computeAnalytics(base({ couponRate: 9.5, ipDatesSeed: '01ST OF EVERY MONTH' }));
    expect(a.last_coupon_date).toBe('2026-11-01');
    expect(a.next_coupon_for_accrual).toBe('2026-12-01');
    expect(a.accrued_days).toBe(5);
    expect(a.accrued_per_100).toBeCloseTo(9.5 * 5 / 365, 4);
  });

  it('quarterly "30-01, 30-04 30-07, 30-10" maturing 30-Jun uses Jan/Apr/Jul/Oct', () => {
    const a = computeAnalytics(base({ frequency: 'quarterly', ipDatesSeed: '30-01, 30-04 30-07, 30-10', maturityISO: '2028-06-30' }));
    expect(a.last_coupon_date).toBe('2026-10-30');
    expect(a.next_coupon_for_accrual).toBe('2027-01-30');
    expect(a.accrued_days).toBe(7);
  });

  it('"30TH OF EVERY MONTH" does not drift to the 1st/2nd after February', () => {
    const a = computeAnalytics(base({ ipDatesSeed: '30TH OF EVERY MONTH', maturityISO: '2027-10-30', settlementISO: '2027-03-05' }));
    expect(a.last_coupon_date).toBe('2027-02-28');
    expect(a.next_coupon_for_accrual).toBe('2027-03-30');
    expect(a.accrued_days).toBe(5);
    const later = a.coupon_schedule.map((c) => c.scheduled_date.slice(8));
    expect(later.slice(0, 4)).toEqual(['30', '30', '30', '30']);
  });

  it('"LAST DAY OF EVERY MONTH" accrues from month-end', () => {
    const a = computeAnalytics(base({ ipDatesSeed: 'LAST DAY OF EVERY MONTH', maturityISO: '2028-09-30' }));
    expect(a.last_coupon_date).toBe('2026-10-31');
    expect(a.accrued_days).toBe(6);
    expect(a.next_coupon_for_accrual).toBe('2026-11-30');
  });

  it('annual with an IP date in a different month than maturity uses the IP month', () => {
    const a = computeAnalytics(base({ frequency: 'annual', ipDatesSeed: '2022-08-03', maturityISO: '2028-11-03' }));
    expect(a.last_coupon_date).toBe('2026-08-03');
    expect(a.accrued_days).toBe(95);
  });

  it('two listed dates beat an "annual" label', () => {
    const p = buildCouponPattern('28Mar 28Sep', 'annual', new Date('2031-09-26T00:00:00Z'));
    expect(p.perYear).toBe(2);
    expect(p.frequencyConflict).toBe(true);
  });

  it('single date and no stated frequency is flagged as an assumption', () => {
    const p = buildCouponPattern('2025-10-30', '', new Date('2027-10-30T00:00:00Z'));
    expect(p.perYear).toBe(1);
    expect(p.frequencyAssumed).toBe(true);
  });

  it('broken final period ends at maturity', () => {
    const a = computeAnalytics(base({ ipDatesSeed: '01ST OF EVERY MONTH', maturityISO: '2026-11-24' }));
    expect(a.next_coupon_for_accrual).toBe('2026-11-24');
    const last = a.cashflow_schedule[a.cashflow_schedule.length - 1];
    expect(last.interest_per_100).toBeCloseTo(10 * 23 / 365, 3);
  });
});

describe('day-count conventions', () => {
  it('G-sec 30E/360: 6.94% "11-05, 11-11" → 175 days', () => {
    const a = computeAnalytics(base({ couponRate: 6.94, frequency: 'half_yearly', ipDatesSeed: '11-05, 11-11', maturityISO: '2036-05-11', dayCount: '30_360' }));
    expect(a.last_coupon_date).toBe('2026-05-11');
    expect(a.accrued_days).toBe(175);
    expect(a.accrued_per_100).toBeCloseTo(6.94 * 175 / 360, 4);
    expect(a.coupon_schedule[1].coupon_per_100).toBeCloseTo(3.47, 4);   // full half-year = rate/2
  });

  it('SEBI Actual/Actual: 366 for an interest year containing 29-Feb', () => {
    const a = computeAnalytics(base({ frequency: 'annual', ipDatesSeed: '15-03', maturityISO: '2030-03-15', settlementISO: '2027-09-15' }));
    expect(a.accrued_days).toBe(184);
    expect(a.accrued_per_100).toBeCloseTo(10 * 184 / 366, 4);
  });

  it('annual coupon off the maturity day: interest year = the coupon period (no 29-Feb → 365)', () => {
    // HDB 7.95%: coupon 23-Jun, maturity 04-Jun-2035. Period 23-Jun-26 → 23-Jun-27 has no 29-Feb.
    const a = computeAnalytics(base({ couponRate: 7.95, frequency: 'annual', ipDatesSeed: '2025-06-23', maturityISO: '2035-06-04' }));
    expect(a.accrued_days).toBe(136);
    expect(a.accrued_per_100).toBeCloseTo(7.95 * 136 / 365, 4);
  });

  it('SEBI Actual/Actual: 365 when the interest year has no 29-Feb', () => {
    const a = computeAnalytics(base({ frequency: 'annual', ipDatesSeed: '15-03', maturityISO: '2030-03-15', settlementISO: '2026-09-15' }));
    expect(a.accrued_per_100).toBeCloseTo(10 * 184 / 365, 4);
  });
});

describe('settlement and parsing', () => {
  it('T+1 business day: Thursday → Friday, Friday → Monday', () => {
    expect(settlementFrom(new Date('2026-11-05T00:00:00Z'), new Set()).toISOString().slice(0, 10)).toBe('2026-11-06');
    expect(settlementFrom(new Date('2026-11-06T00:00:00Z'), new Set()).toISOString().slice(0, 10)).toBe('2026-11-09');
    expect(settlementFrom(new Date('2026-11-06T00:00:00Z'), new Set(['2026-11-09'])).toISOString().slice(0, 10)).toBe('2026-11-10');
  });

  it('reads ordinals and month-end rules', () => {
    expect(parseMonthlyRule('27TH OF EVERY MONTH')).toBe(27);
    expect(parseMonthlyRule('1st of every month')).toBe(1);
    expect(parseMonthlyRule('26TH EVERY MONTH')).toBe(26);
    expect(parseMonthlyRule('LAST DAY OF EVERY MONTH')).toBe('eom');
    expect(parseMonthlyRule('15-03, 15-09')).toBeNull();
  });

  it('reads the IP-date layouts found in the sheet', () => {
    const months = (s: string) => parseSeedPairs(s).map((p) => `${p.day}/${p.month + 1}`);
    expect(months('15 MAR 15 JUNE 15 SEPT 15 DEC')).toEqual(['15/3', '15/6', '15/9', '15/12']);
    expect(months('31-03, 30-06 30-09, 31-12')).toEqual(['31/3', '30/6', '30/9', '31/12']);
    expect(months('24/12,24/03 24/06,24/09')).toEqual(['24/12', '24/3', '24/6', '24/9']);
    expect(months('01-Jan, 01-Apr, 01-Jul, 01-Oct')).toEqual(['1/1', '1/4', '1/7', '1/10']);
    expect(months('28Mar 28Sep')).toEqual(['28/3', '28/9']);
    expect(months('2023-10-01')).toEqual(['1/10']);
    expect(months('QUARTERLY')).toEqual([]);
  });
});
