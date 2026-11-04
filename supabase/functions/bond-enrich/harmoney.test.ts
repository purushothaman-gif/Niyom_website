import { describe, it, expect } from 'vitest';
import { computeAnalytics, type AnalyticsInput, type ProviderFlow } from './analytics';
import { mapCashflows, mapCoupon, mapDayCount, mapFlowType, mapFrequency, mapInstrument, harmoneyEnabled } from './harmoney';

// Expected values are worked by hand: accrued per ₹100 = outstanding × coupon% × days ÷ basis.

const base = (o: Partial<AnalyticsInput>): AnalyticsInput => ({
  couponRate: 9, frequency: 'quarterly', maturityISO: '2028-06-30', dayCount: 'actual_actual',
  bizConv: 'following', holidays: new Set(), cleanPricePer100: 100, settlementISO: '2026-11-06', ...o,
});

// A quarterly 9% bond whose real coupon dates are the 15th of Feb/May/Aug/Nov — which the
// sheet text ("30-01, 30-04 30-07, 30-10") gets wrong.
const qFlows = (recordNov: string): ProviderFlow[] => [
  { date: '2026-08-15', record_date: '2026-07-31', type: 'coupon', amount_per_100: 2.2685, interest_days: 92 },
  { date: '2026-11-15', record_date: recordNov, type: 'coupon', amount_per_100: 2.2685, interest_days: 92 },
  { date: '2027-02-15', record_date: '2027-01-31', type: 'coupon', amount_per_100: 2.2685, interest_days: 92 },
  { date: '2028-06-30', record_date: '2028-06-15', type: 'coupon', amount_per_100: 1.0, interest_days: 40 },
  { date: '2028-06-30', record_date: '2028-06-15', type: 'principal', amount_per_100: 100, interest_days: null },
];

describe('provider schedule overrides the IP-date text', () => {
  it('uses the provider coupon dates, not the sheet', () => {
    const a = computeAnalytics(base({ ipDatesSeed: '30-01, 30-04 30-07, 30-10', providerFlows: qFlows('2026-11-10') }));
    expect(a.calendar_source).toBe('provider');
    expect(a.last_coupon_date).toBe('2026-08-15');
    expect(a.next_coupon_for_accrual).toBe('2026-11-15');
    expect(a.accrued_days).toBe(83);
    expect(a.calendar_needs_check).toBe(false);
    expect(a.coupons_per_year).toBe(4);
  });

  it('settlement AFTER the record date → ex-interest, negative accrued to the coupon date', () => {
    const a = computeAnalytics(base({ providerFlows: qFlows('2026-11-01') }));
    expect(a.record_date).toBe('2026-11-01');
    expect(a.accrual_convention).toBe('ex');
    expect(a.coupon_to_seller).toBe('seller');
    expect(a.accrued_days).toBe(-9);                       // 06-Nov → 15-Nov
    expect(a.accrued_per_100).toBeCloseTo(-9 * 9 / 365, 4);
  });

  it('settlement ON the record date → still cum-interest (owner as of end of record date)', () => {
    const a = computeAnalytics(base({ providerFlows: qFlows('2026-11-06') }));
    expect(a.accrual_convention).toBe('cum');
    expect(a.coupon_to_seller).toBe('buyer');
    expect(a.accrued_days).toBe(83);
  });

  it('accrues on the OUTSTANDING principal after a part redemption', () => {
    const flows: ProviderFlow[] = [
      { date: '2026-08-15', record_date: '2026-07-31', type: 'coupon', amount_per_100: 2.27, interest_days: 92 },
      { date: '2026-08-15', record_date: '2026-07-31', type: 'principal', amount_per_100: 25, interest_days: null },
      { date: '2026-11-15', record_date: '2026-11-10', type: 'coupon', amount_per_100: 1.70, interest_days: 92 },
      { date: '2028-06-30', record_date: '2028-06-15', type: 'principal', amount_per_100: 75, interest_days: null },
    ];
    const a = computeAnalytics(base({ providerFlows: flows }));
    expect(a.accrued_per_100).toBeCloseTo(75 * 0.09 * 83 / 365, 4);
    expect(a.total_future_principal_per_100).toBeCloseTo(75, 4);
  });

  it('cash-flow rows come straight from the provider', () => {
    const a = computeAnalytics(base({ providerFlows: qFlows('2026-10-31') }));
    const last = a.cashflow_schedule[a.cashflow_schedule.length - 1];
    expect(last.date).toBe('2028-06-30');
    expect(last.interest_per_100).toBeCloseTo(1.0, 4);
    expect(last.principal_per_100).toBeCloseTo(100, 4);
    expect(a.cashflow_schedule.map((r) => r.date)).toEqual(['2026-11-15', '2027-02-15', '2028-06-30']);
  });
});

describe('Harmoney response mapping', () => {
  it('maps frequency text and counts', () => {
    expect(mapFrequency('Monthly')).toBe('monthly');
    expect(mapFrequency('QUARTERLY')).toBe('quarterly');
    expect(mapFrequency('Semi-Annual')).toBe('half_yearly');
    expect(mapFrequency(12)).toBe('monthly');
    expect(mapFrequency('2')).toBe('half_yearly');
    expect(mapFrequency('Cumulative')).toBe('zero');
  });
  it('maps day count and coupon units', () => {
    expect(mapDayCount('Actual/Actual')).toBe('actual_actual');
    expect(mapDayCount('30/360')).toBe('30_360');
    expect(mapDayCount('ACT/365')).toBe('actual_365');
    expect(mapCoupon('9.5000')).toBe(9.5);
    expect(mapCoupon('0.095')).toBeCloseTo(9.5, 6);
  });
  it('classifies cash-flow types', () => {
    expect(mapFlowType('Coupon Payment')).toBe('coupon');
    expect(mapFlowType('Principal Payment')).toBe('principal');
    expect(mapFlowType('Partial Redemption')).toBe('principal');
  });
  it('parses CashflowItem[] and skips malformed rows', () => {
    const f = mapCashflows([
      { transaction_date: '2027-02-15', record_date: '2027-01-31', transaction_type: 'Coupon Payment', cashflow: '2.2685', interest_days: 92 },
      { transaction_date: 'bad', record_date: null, transaction_type: 'Coupon Payment', cashflow: '1' },
      { transaction_date: '2026-11-15', record_date: '2026-10-31', transaction_type: 'Coupon Payment', cashflow: '2.2685', interest_days: 92 },
    ]);
    expect(f.map((x) => x.date)).toEqual(['2026-11-15', '2027-02-15']);
    expect(f[0]).toMatchObject({ record_date: '2026-10-31', type: 'coupon', amount_per_100: 2.2685, interest_days: 92 });
  });
  it('maps the instrument master', () => {
    const f = mapInstrument({
      instrument_id: 7, issuance_details: { issue_date: '2025-06-30', face_value: '100000.00', is_listed: true },
      coupon_details: { coupon: '9.00', coupon_frequency: 'Quarterly', day_count_convention: 'Actual/Actual', coupon_type: 'Fixed' },
      maturity_details: { maturity_date: '2028-06-30' }, covenants: { secured: true, seniority: 'Senior' },
    });
    expect(f.coupon_rate.value).toBe(9);
    expect(f.coupon_frequency.value).toBe('quarterly');
    expect(f.day_count_convention.value).toBe('actual_actual');
    expect(f.maturity_date.value).toBe('2028-06-30');
    expect(f.face_value.value).toBe(100000);
    expect(f.secured.value).toBe(true);
  });
  it('is dormant without an API key', () => {
    expect(harmoneyEnabled()).toBe(false);
  });
});
