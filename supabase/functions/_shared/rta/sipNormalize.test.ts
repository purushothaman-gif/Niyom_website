import { describe, expect, it } from 'vitest';
import { normalizeSipFrequency, normalizeSipPlan } from './sipNormalize.ts';

describe('normalizeSipPlan', () => {
  it('decodes CAMS AUT_TRNTYP codes', () => {
    expect(normalizeSipPlan('P')).toBe('SIP');
    expect(normalizeSipPlan('S')).toBe('STP');
    expect(normalizeSipPlan('W')).toBe('SWP');
    expect(normalizeSipPlan('R')).toBe('SWP');
  });
  it('passes canonical values through (idempotent)', () => {
    expect(normalizeSipPlan('SIP')).toBe('SIP');
    expect(normalizeSipPlan('STP')).toBe('STP');
    expect(normalizeSipPlan('swp')).toBe('SWP');
  });
  it('upper-cases unknown codes and handles blanks', () => {
    expect(normalizeSipPlan('xyz')).toBe('XYZ');
    expect(normalizeSipPlan('')).toBeNull();
    expect(normalizeSipPlan(null)).toBeNull();
  });
});

describe('normalizeSipFrequency', () => {
  it('decodes CAMS "once-per" PERIODICIT codes', () => {
    expect(normalizeSipFrequency('OM')).toBe('Monthly');
    expect(normalizeSipFrequency('OW')).toBe('Weekly');
    expect(normalizeSipFrequency('OQ')).toBe('Quarterly');
    expect(normalizeSipFrequency('OH')).toBe('Half-Yearly');
    expect(normalizeSipFrequency('OY')).toBe('Yearly');
  });
  it('normalizes KFintech / word forms (idempotent)', () => {
    expect(normalizeSipFrequency('MONTHLY')).toBe('Monthly');
    expect(normalizeSipFrequency('MONTH')).toBe('Monthly');
    expect(normalizeSipFrequency('Monthly')).toBe('Monthly');
  });
  it('title-cases unknown values and handles blanks', () => {
    expect(normalizeSipFrequency('BIWEEKLY')).toBe('Biweekly');
    expect(normalizeSipFrequency('')).toBeNull();
    expect(normalizeSipFrequency(null)).toBeNull();
  });
});
