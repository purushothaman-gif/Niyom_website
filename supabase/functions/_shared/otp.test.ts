/*
 * Tests for the onboarding OTP decision logic.
 *
 * These exist because the flow shipped without an attempt cap: a 6-digit code,
 * ten-minute window, unlimited guesses, and a magic-link token on success. The
 * cap is the whole control, so it gets asserted rather than assumed.
 *
 * Unlike supabase/functions/tests/password-reset-otp.test.mjs — which mirrors
 * the edge-function algorithm in a copy — these import the real module.
 */

import { describe, it, expect } from 'vitest';
import {
  MAX_OTP_ATTEMPTS,
  decideOtp,
  generateOtp,
  hashOtp,
  safeEqual,
  type StoredOtp,
} from './otp.ts';

const PEPPER = 'unit-test-pepper';
const PHONE = '9876543210';
const NOW = Date.parse('2026-08-09T12:00:00Z');

const future = new Date(NOW + 5 * 60_000).toISOString();
const past = new Date(NOW - 60_000).toISOString();

async function row(code: string, over: Partial<StoredOtp> = {}): Promise<StoredOtp> {
  return {
    otp_hash: await hashOtp(code, PHONE, PEPPER),
    attempts: 0,
    expires_at: future,
    ...over,
  };
}

const decide = (stored: StoredOtp, submitted: string, nowMs = NOW) =>
  decideOtp(stored, submitted, { key: PHONE, pepper: PEPPER, nowMs });

describe('generateOtp', () => {
  it('always returns six digits, zero-padded', () => {
    for (let i = 0; i < 500; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it('reaches both ends of the range (no truncated distribution)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) seen.add(generateOtp());
    // A Math.random()-style `100000 + rand*900000` can never emit a leading zero.
    expect([...seen].some((c) => c.startsWith('0'))).toBe(true);
    expect(seen.size).toBeGreaterThan(3000);
  });
});

describe('hashOtp', () => {
  it('does not store anything resembling the code', async () => {
    const h = await hashOtp('123456', PHONE, PEPPER);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('123456');
  });

  it('is bound to the phone, so a hash cannot be replayed onto another number', async () => {
    expect(await hashOtp('123456', PHONE, PEPPER))
      .not.toBe(await hashOtp('123456', '9000000000', PEPPER));
  });

  it('is bound to the pepper', async () => {
    expect(await hashOtp('123456', PHONE, PEPPER))
      .not.toBe(await hashOtp('123456', PHONE, 'other'));
  });
});

describe('safeEqual', () => {
  it('matches identical strings and rejects differences at any position', () => {
    expect(safeEqual('abc123', 'abc123')).toBe(true);
    expect(safeEqual('abc123', 'zbc123')).toBe(false); // first byte
    expect(safeEqual('abc123', 'abc124')).toBe(false); // last byte
    expect(safeEqual('abc123', 'abc1234')).toBe(false); // length
  });
});

describe('decideOtp', () => {
  it('accepts the correct code', async () => {
    expect((await decide(await row('123456'), '123456')).outcome).toBe('ok');
  });

  it('tolerates surrounding whitespace from a paste', async () => {
    expect((await decide(await row('123456'), '  123456 ')).outcome).toBe('ok');
  });

  it('rejects a wrong code and counts the attempt', async () => {
    const d = await decide(await row('123456'), '000000');
    expect(d.outcome).toBe('wrong');
    if (d.outcome !== 'wrong') throw new Error('unreachable');
    expect(d.attempts).toBe(1);
    expect(d.error).toContain('2 attempts remaining');
  });

  it('says "1 attempt" singular on the penultimate try', async () => {
    const d = await decide(await row('123456', { attempts: 1 }), '000000');
    if (d.outcome !== 'wrong') throw new Error('expected wrong');
    expect(d.error).toContain('1 attempt remaining');
    expect(d.error).not.toContain('attempts remaining');
  });

  it('burns the code on the final wrong attempt rather than reporting "0 remaining"', async () => {
    const d = await decide(await row('123456', { attempts: MAX_OTP_ATTEMPTS - 1 }), '000000');
    expect(d.outcome).toBe('exhausted');
  });

  it('refuses a code already at the cap, even if the guess is correct', async () => {
    // The security property: the cap cannot be walked past by eventually
    // landing on the right code.
    const d = await decide(await row('123456', { attempts: MAX_OTP_ATTEMPTS }), '123456');
    expect(d.outcome).toBe('exhausted');
  });

  it('never lets a brute-force run exceed the cap', async () => {
    // Drive the real state machine the way an attacker would: keep guessing,
    // feeding back the attempt count the caller would have persisted.
    let stored = await row('123456');
    let allowed = 0;
    for (let i = 0; i < 50; i++) {
      const d = await decide(stored, String(i).padStart(6, '0'));
      if (d.outcome === 'exhausted') break;
      expect(d.outcome).toBe('wrong');
      if (d.outcome !== 'wrong') throw new Error('unreachable');
      allowed++;
      stored = { ...stored, attempts: d.attempts };
    }
    expect(allowed).toBe(MAX_OTP_ATTEMPTS - 1);
  });

  it('rejects an expired code before anything else', async () => {
    const d = await decide(await row('123456', { expires_at: past }), '123456');
    expect(d.outcome).toBe('expired');
  });

  it('treats expiry as strictly in the past', async () => {
    const stored = await row('123456', { expires_at: new Date(NOW + 1).toISOString() });
    expect((await decide(stored, '123456')).outcome).toBe('ok');
  });

  it('still verifies legacy cleartext rows during the migration window', async () => {
    const legacy: StoredOtp = { otp: '123456', otp_hash: null, attempts: 0, expires_at: future };
    expect((await decide(legacy, '123456')).outcome).toBe('ok');
    expect((await decide(legacy, '654321')).outcome).toBe('wrong');
  });

  it('prefers the hash when a row somehow carries both', async () => {
    // A stale cleartext value must never become a second valid code.
    const both = await row('123456', { otp: '999999' });
    expect((await decide(both, '999999')).outcome).toBe('wrong');
    expect((await decide(both, '123456')).outcome).toBe('ok');
  });

  it('fails closed on a row with neither hash nor cleartext', async () => {
    const empty: StoredOtp = { otp: null, otp_hash: null, attempts: 0, expires_at: future };
    expect((await decide(empty, '123456')).outcome).toBe('wrong');
    expect((await decide(empty, '')).outcome).toBe('wrong');
  });
});
