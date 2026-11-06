import { describe, expect, it } from 'vitest';
import { passwordCandidates } from './pdfPasswordCandidates';

const hints = { fullName: 'Kavita Sri G', pan: 'abcde1234f', dob: '1990-07-25', phone: '+91 98765 43210', accountNumbers: ['50100586101758'] };

describe('passwordCandidates', () => {
  const c = passwordCandidates(hints);

  it('tries PAN first (depository CML / CAS)', () => {
    expect(c.slice(0, 2)).toEqual(['ABCDE1234F', 'abcde1234f']);
  });

  it('covers the common bank formulas', () => {
    expect(c).toContain('kavi2507');        // ICICI / Axis: name4 + DDMM
    expect(c).toContain('KAVI25071990');    // name4 + DDMMYYYY
    expect(c).toContain('25071990');        // DOB
    expect(c).toContain('43210250790');     // SBI: last5 mobile + DDMMYY
    expect(c).toContain('9876543210');      // mobile
    expect(c).toContain('17582507');        // acct last4 + DDMM
  });

  it('has no duplicates or short junk, and is capped', () => {
    expect(new Set(c).size).toBe(c.length);
    expect(c.every((p) => p.length >= 4)).toBe(true);
    expect(c.length).toBeLessThanOrEqual(80);
  });

  it('copes with missing data', () => {
    expect(passwordCandidates({})).toEqual([]);
    expect(passwordCandidates({ pan: 'ABCDE1234F' })).toEqual(['ABCDE1234F', 'abcde1234f']);
  });
});
