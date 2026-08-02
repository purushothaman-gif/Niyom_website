/**
 * The PIN hash is the one part of PIN sign-in that cannot be checked by reading
 * the screen: a bug here either lets a wrong PIN through or locks a right one
 * out, and both look like "it didn't work".
 */
import { describe, it, expect } from 'vitest';
import {
  hashPin,
  isValidPin,
  isWeakPin,
  newSalt,
  timingSafeEqual,
  verifyPin,
} from './pin.ts';

/* 310k PBKDF2 iterations is deliberately slow; the tests use a low count so the
   suite stays fast, and separately assert the real default is high. */
const FAST = 1000;

describe('hashPin / verifyPin', () => {
  it('accepts the right PIN and rejects a wrong one', async () => {
    const salt = newSalt();
    const { hash, iterations } = await hashPin('4071', salt, FAST);
    await expect(verifyPin('4071', salt, iterations, hash)).resolves.toBe(true);
    await expect(verifyPin('4072', salt, iterations, hash)).resolves.toBe(false);
  });

  it('never stores the PIN itself', async () => {
    const salt = newSalt();
    const { hash } = await hashPin('4071', salt, FAST);
    expect(hash).not.toContain('4071');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('gives two clients with the same PIN different hashes', async () => {
    const a = await hashPin('4071', newSalt(), FAST);
    const b = await hashPin('4071', newSalt(), FAST);
    expect(a.hash).not.toBe(b.hash);
  });

  it('defaults to a high iteration count', async () => {
    const { iterations } = await hashPin('4071', newSalt());
    expect(iterations).toBeGreaterThanOrEqual(300_000);
  });
});

describe('timingSafeEqual', () => {
  it('compares by value', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'ab')).toBe(false);
  });
});

describe('PIN rules', () => {
  it('requires exactly four digits', () => {
    expect(isValidPin('4071')).toBe(true);
    expect(isValidPin('407')).toBe(false);
    expect(isValidPin('40710')).toBe(false);
    expect(isValidPin('40a1')).toBe(false);
    expect(isValidPin(4071 as unknown as string)).toBe(false);
  });

  it('refuses the PINs everyone guesses first', () => {
    for (const weak of ['0000', '1234', '1111', '4321', '2580']) {
      expect(isWeakPin(weak)).toBe(true);
    }
    expect(isWeakPin('4071')).toBe(false);
  });
});
