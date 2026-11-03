/**
 * The AES core is hand-written (no npm dependency bundles in the edge runtime),
 * so it is pinned to the FIPS-197 Appendix C known-answer vectors for all three
 * key sizes. If any of these fail, the cipher is wrong and WinZip-AES decryption
 * would silently produce garbage — so these must pass before anything else.
 */
import { describe, it, expect } from 'vitest';
import { Aes } from './aes.ts';

const hex = (s: string) => new Uint8Array(s.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('Aes (FIPS-197 Appendix C)', () => {
  const PT = '00112233445566778899aabbccddeeff';

  it('AES-128', () => {
    const c = new Aes(hex('000102030405060708090a0b0c0d0e0f'));
    expect(toHex(c.encryptBlock(hex(PT)))).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
  });

  it('AES-192', () => {
    const c = new Aes(hex('000102030405060708090a0b0c0d0e0f1011121314151617'));
    expect(toHex(c.encryptBlock(hex(PT)))).toBe('dda97ca4864cdfe06eaf70a0ec0d7191');
  });

  it('AES-256', () => {
    const c = new Aes(hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'));
    expect(toHex(c.encryptBlock(hex(PT)))).toBe('8ea2b7ca516745bfeafc49904b496089');
  });

  it('rejects a bad key length', () => {
    expect(() => new Aes(new Uint8Array(20))).toThrow();
  });
});
