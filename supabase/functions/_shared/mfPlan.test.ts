import { describe, expect, it } from 'vitest';
import { isDirectPlan, isIdcwPlan, isRegularGrowth } from './mfPlan';

describe('isDirectPlan', () => {
  it('catches every spelling AMFI uses', () => {
    for (const n of [
      'ICICI Prudential MidCap Fund - Direct Plan -  Growth',
      'Axis Multicap Fund - Direct Growth',
      'Sundaram Mid Cap Fund Direct Plan - Growth',
      'Navi Liquid Fund - Direct Plan Growth',
    ]) expect(isDirectPlan(n)).toBe(true);
  });

  it('does not flag a Regular plan', () => {
    for (const n of [
      'HDFC Banking and PSU Debt Fund - Growth Option',
      'Kotak Bluechip Fund - Regular Plan - Growth',
    ]) expect(isDirectPlan(n)).toBe(false);
  });
});

describe('isRegularGrowth', () => {
  it('accepts explicit Regular plans', () => {
    expect(isRegularGrowth('Kotak Bluechip Fund - Regular Plan - Growth')).toBe(true);
  });

  /*
   * The important case: ~1,000 live schemes predate the Direct/Regular split
   * and never say which they are. They are Regular, and defining Regular as
   * "says regular" would silently drop them.
   */
  it('accepts pre-split schemes that name no plan at all', () => {
    for (const n of [
      'HDFC Banking and PSU Debt Fund - Growth Option',
      'Franklin India Banking & PSU Debt Fund - Growth',
      'ICICI Prudential Banking and PSU Debt Fund Retail Growth',
    ]) expect(isRegularGrowth(n)).toBe(true);
  });

  it('rejects Direct, whatever the spelling', () => {
    for (const n of [
      'ICICI Prudential MidCap Fund - Direct Plan -  Growth',
      'Axis Multicap Fund - Direct Growth',
    ]) expect(isRegularGrowth(n)).toBe(false);
  });

  it('rejects the income-distribution options', () => {
    expect(isRegularGrowth('SBI Bluechip Fund - Regular Plan - IDCW')).toBe(false);
    expect(isRegularGrowth('SBI Bluechip Fund - Dividend')).toBe(false);
    expect(isIdcwPlan('SBI Bluechip Fund - IDCW Payout')).toBe(true);
  });

  it('rejects a scheme with no Growth option at all', () => {
    expect(isRegularGrowth('SBI Bluechip Fund - Regular Plan')).toBe(false);
  });
});
