import { describe, expect, it } from 'vitest';
import { generateCasPassword, isValidCasPassword } from './casPassword';

describe('generateCasPassword', () => {
  it('always satisfies the rules CAMS prints beside its password field', () => {
    for (let i = 0; i < 500; i++) {
      const p = generateCasPassword();
      expect(isValidCasPassword(p), p).toBe(true);
    }
  });

  it('does not hand out the same password twice in a row', () => {
    expect(generateCasPassword()).not.toBe(generateCasPassword());
  });
});

describe('isValidCasPassword', () => {
  it('rejects what the CAMS form rejects', () => {
    expect(isValidCasPassword('1bcdefG@2')).toBe(false); // must start with a letter
    expect(isValidCasPassword('Abc@123')).toBe(false); // 7 characters
    expect(isValidCasPassword('Abcdefgh@1234567')).toBe(false); // 16 characters
    expect(isValidCasPassword('abcdefg@12')).toBe(false); // no uppercase
    expect(isValidCasPassword('Abcdefgh@')).toBe(false); // no digit
    expect(isValidCasPassword('Abcdefgh12')).toBe(false); // no special
    expect(isValidCasPassword('Abcdefg!12')).toBe(false); // special not on the list
  });
});
