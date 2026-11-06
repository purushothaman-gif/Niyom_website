/**
 * CTR is symmetric, so the real risk in the hand-rolled WinZip layer is the
 * counter arithmetic and the XOR, not the maths — a wrong little-endian carry
 * would corrupt every block past the first. These check that CTR round-trips,
 * actually transforms the data, and crosses the 16-byte block boundary (and the
 * 256-block counter-carry) correctly. Full end-to-end decryption of a real
 * encrypted feed is verified live, since it needs the mailback password.
 */
import { describe, it, expect } from 'vitest';
import { createCipheriv } from 'node:crypto';
import { aesCtrXor, findAesDbfEntry, WinzipError } from './winzip.ts';

const KEY = new Uint8Array(32).map((_, i) => i); // AES-256 key 00..1f

describe('aesCtrXor', () => {
  it('round-trips data of arbitrary length', () => {
    for (const len of [0, 1, 15, 16, 17, 64, 200, 4097]) {
      const data = new Uint8Array(len).map((_, i) => (i * 37 + 11) & 0xff);
      const enc = aesCtrXor(KEY, data);
      const dec = aesCtrXor(KEY, enc);
      expect([...dec]).toEqual([...data]);
    }
  });

  it('actually transforms the data (not a no-op)', () => {
    const data = new Uint8Array(32).fill(0);
    const enc = aesCtrXor(KEY, data);
    expect([...enc].some((b) => b !== 0)).toBe(true);
  });

  it('uses an independent keystream block past the first 16 bytes', () => {
    // Two identical plaintext blocks must encrypt differently, because the
    // counter advances — if the carry were broken they could collide.
    const data = new Uint8Array(32).fill(0xaa);
    const enc = aesCtrXor(KEY, data);
    expect([...enc.subarray(0, 16)]).not.toEqual([...enc.subarray(16, 32)]);
  });
});

describe('aesCtrXor vs a reference AES (WinZip little-endian counter)', () => {
  // Round-trip tests can't catch a wrong keystream (CTR decrypts its own output
  // whatever the counter does), so compare against Node's AES-ECB applied to
  // WinZip's counter blocks 1, 2, 3 … — well past block 256, where the carry into
  // the second counter byte first happens (the 2026-11-07 WBR39 corruption).
  it('matches byte-for-byte across the 256-block carry (and 65536)', () => {
    for (const blocks of [300, 65540]) {
      const len = blocks * 16 - 5;
      const data = new Uint8Array(len).map((_, i) => (i * 131 + 7) & 0xff);
      const ctrs = new Uint8Array(blocks * 16);
      const c = new Uint8Array(16); c[0] = 1;
      for (let b = 0; b < blocks; b++) {
        ctrs.set(c, b * 16);
        for (let k = 0; k < 16; k++) { c[k] = (c[k] + 1) & 0xff; if (c[k] !== 0) break; }
      }
      const ecb = createCipheriv(`aes-${KEY.length * 8}-ecb`, KEY, null);
      ecb.setAutoPadding(false);
      const ks = new Uint8Array(Buffer.concat([ecb.update(ctrs), ecb.final()]));
      const expected = data.map((b, i) => b ^ ks[i]);
      const got = aesCtrXor(KEY, data);
      let first = -1;
      for (let i = 0; i < len; i++) if (got[i] !== expected[i]) { first = i; break; }
      expect(first).toBe(-1);
    }
  });
});

describe('findAesDbfEntry', () => {
  it('rejects something that is not a ZIP', () => {
    expect(() => findAesDbfEntry(new Uint8Array([1, 2, 3, 4]))).toThrow(WinzipError);
  });
});
