import { describe, expect, it } from 'vitest';
import { bankNameAcceptable, validateBank, validateContact, validateNominees } from './profileRules.ts';

const today = new Date('2026-11-06T00:00:00Z');

describe('validateContact', () => {
  it('normalises mobile and email', () => {
    const r = validateContact({ phone: '+91 98765 43210', email: ' A@B.COM ' });
    expect(r).toEqual({ ok: true, value: { phone: '9876543210', email: 'a@b.com' } });
  });
  it('rejects bad values and empty changes', () => {
    expect(validateContact({ phone: '12345' }).ok).toBe(false);
    expect(validateContact({ email: 'x@' }).ok).toBe(false);
    expect(validateContact({ pincode: '012345' }).ok).toBe(false);
    expect(validateContact({}).ok).toBe(false);
  });
});

describe('validateNominees', () => {
  const adult = { full_name: 'Asha K', relationship: 'Spouse', dob: '1990-01-01', share_percent: 60 };
  it('requires shares to total 100', () => {
    expect(validateNominees([adult], today).ok).toBe(false);
    expect(validateNominees([adult, { ...adult, full_name: 'Ravi K', share_percent: 40 }], today).ok).toBe(true);
  });
  it('requires a guardian for a minor', () => {
    const minor = { full_name: 'Kid K', relationship: 'Son', dob: '2015-05-05', share_percent: 100 };
    expect(validateNominees([minor], today).ok).toBe(false);
    expect(validateNominees([{ ...minor, guardian_name: 'Asha K' }], today).ok).toBe(true);
  });
  it('allows clearing and caps the count', () => {
    expect(validateNominees([], today)).toEqual({ ok: true, value: [] });
    expect(validateNominees(Array.from({ length: 11 }, () => ({ ...adult, share_percent: 100 / 11 })), today).ok).toBe(false);
  });
});

describe('bank', () => {
  it('validates account and IFSC', () => {
    expect(validateBank({ account_number: '1234 5678 9012', ifsc: 'hdfc0001234' })).toMatchObject({ ok: true, value: { account_number: '123456789012', ifsc: 'HDFC0001234' } });
    expect(validateBank({ account_number: '12', ifsc: 'HDFC0001234' }).ok).toBe(false);
    expect(validateBank({ account_number: '123456789', ifsc: 'HDFC1001234' }).ok).toBe(false);
  });
  it('only accepts direct/good/moderate name matches', () => {
    expect(bankNameAcceptable('GOOD_PARTIAL_MATCH')).toBe(true);
    expect(bankNameAcceptable('POOR_PARTIAL_MATCH')).toBe(false);
    expect(bankNameAcceptable(null)).toBe(false);
  });
});
