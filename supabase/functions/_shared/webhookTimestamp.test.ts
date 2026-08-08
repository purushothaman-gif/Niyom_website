/**
 * These tests exist because the bug they pin was invisible from every angle we
 * had: the endpoint returned 200 to Cashfree's dashboard test, the signature
 * verified correctly, the function logged no error a request log could show —
 * and every real payment was rejected with 401 and never booked.
 *
 * The regression is a silent unit assumption, so the cases below are written
 * around units rather than around the code's current shape.
 */
import { describe, it, expect } from 'vitest';
import { toEpochSeconds, timestampAgeSeconds } from './webhookTimestamp.ts';

/* The exact header Cashfree sent on the PAYMENT_SUCCESS_WEBHOOK that this fix
   was traced from, and the moment it arrived. Kept verbatim so the test fails
   if the normalisation ever stops handling the real-world case. */
const CASHFREE_MS = '1786178797553';        // 8 Aug 2026, 14:16:37.553 IST
const ARRIVED_AT_MS = 1786178798000;        // 14:16:38 IST

describe('toEpochSeconds', () => {
  it('treats a 13-digit value as milliseconds', () => {
    expect(toEpochSeconds(CASHFREE_MS)).toBeCloseTo(1786178797.553, 3);
  });

  it('leaves a 10-digit value as seconds', () => {
    expect(toEpochSeconds('1786178797')).toBe(1786178797);
  });

  it('returns NaN for a non-numeric or absent header', () => {
    // NaN rather than 0: a garbled timestamp must not read as 1970 and get
    // rejected as ancient, nor as "now" and skip the window silently.
    for (const bad of ['', '   ', 'not-a-number', null, undefined]) {
      expect(toEpochSeconds(bad)).toBeNaN();
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(toEpochSeconds(` ${CASHFREE_MS} `)).toBeCloseTo(1786178797.553, 3);
  });
});

describe('timestampAgeSeconds', () => {
  it('reads the real Cashfree delivery as fresh, not 56,000 years old', () => {
    // The whole bug in one assertion. Before the fix this computed
    // ~1.78e12 seconds and produced 401 Stale webhook timestamp.
    const age = timestampAgeSeconds(CASHFREE_MS, ARRIVED_AT_MS);
    expect(age).toBeLessThan(1);
    expect(age).toBeLessThan(300); // the tolerance the receiver applies
  });

  it('STILL rejects a genuinely old millisecond timestamp', () => {
    // The fix must not become a bypass: replay protection has to keep working
    // once the units are read correctly.
    const twoHoursEarlier = String(ARRIVED_AT_MS - 2 * 60 * 60 * 1000);
    expect(timestampAgeSeconds(twoHoursEarlier, ARRIVED_AT_MS)).toBeGreaterThan(300);
  });

  it('still rejects a genuinely old seconds timestamp', () => {
    const twoHoursEarlier = String(Math.floor(ARRIVED_AT_MS / 1000) - 2 * 60 * 60);
    expect(timestampAgeSeconds(twoHoursEarlier, ARRIVED_AT_MS)).toBeGreaterThan(300);
  });

  it('measures a future timestamp as age, not as a negative', () => {
    // A provider clock slightly ahead of ours would otherwise produce a
    // negative that slides past `age > tolerance` unchecked.
    const wayAhead = String(ARRIVED_AT_MS + 60 * 60 * 1000);
    expect(timestampAgeSeconds(wayAhead, ARRIVED_AT_MS)).toBeGreaterThan(300);
  });

  it('accepts both units at the boundary of the tolerance window', () => {
    const ms = String(ARRIVED_AT_MS - 299 * 1000);
    const s = String(Math.floor(ARRIVED_AT_MS / 1000) - 299);
    expect(timestampAgeSeconds(ms, ARRIVED_AT_MS)).toBeLessThan(300);
    expect(timestampAgeSeconds(s, ARRIVED_AT_MS)).toBeLessThan(300);
  });

  it('returns NaN for a non-numeric header so the caller can decide', () => {
    expect(timestampAgeSeconds('garbage', ARRIVED_AT_MS)).toBeNaN();
  });
});
