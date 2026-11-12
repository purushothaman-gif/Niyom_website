/**
 * DigiLocker signup helpers.
 *
 * Pinned because these are the anonymous route's guards: the return redirect
 * must never leave our own origins, the token must be the only way to a
 * result, and the throttle is what stands between a stranger and our vendor
 * credits.
 */
import { describe, expect, it } from 'vitest';
import {
  SIGNUP_MAX_PER_IP_PER_HOUR,
  hashSignupToken,
  isSignupToken,
  maskPan,
  readCallbackQuery,
  signupReturnOrigin,
  signupThrottle,
} from './digilocker.js';

const cfg = { allowedOrigins: ['http://localhost:5173', 'https://www.niyomwealth.com', 'https://niyomwealth.com'] };

describe('signupReturnOrigin', () => {
  it('honours an origin we already allow', () => {
    expect(signupReturnOrigin(cfg, 'https://niyomwealth.com')).toBe('https://niyomwealth.com');
    expect(signupReturnOrigin(cfg, 'http://localhost:5173/')).toBe('http://localhost:5173');
  });

  it('never redirects to an origin that is not ours', () => {
    expect(signupReturnOrigin(cfg, 'https://evil.example')).toBe('https://www.niyomwealth.com');
    expect(signupReturnOrigin(cfg, 'https://www.niyomwealth.com.evil.example')).toBe('https://www.niyomwealth.com');
    expect(signupReturnOrigin(cfg, null)).toBe('https://www.niyomwealth.com');
    expect(signupReturnOrigin(cfg, '')).toBe('https://www.niyomwealth.com');
  });
});

describe('signup token', () => {
  it('accepts only a 64-character lowercase hex token', () => {
    expect(isSignupToken('a'.repeat(64))).toBe(true);
    expect(isSignupToken('A'.repeat(64))).toBe(false);
    expect(isSignupToken('a'.repeat(63))).toBe(false);
    expect(isSignupToken(`${'a'.repeat(60)}&x=1`)).toBe(false);
    expect(isSignupToken(undefined)).toBe(false);
    expect(isSignupToken(12345)).toBe(false);
  });

  it('stores a hash, not the token', () => {
    const token = 'b'.repeat(64);
    const hash = hashSignupToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(token);
    expect(hashSignupToken(token)).toBe(hash);
    expect(hashSignupToken('c'.repeat(64))).not.toBe(hash);
  });
});

describe('signupThrottle', () => {
  it('lets a fresh visitor through', () => {
    expect(signupThrottle({ fromThisIpLastHour: 0, allLastDay: 0 }, 40)).toBe('ok');
    expect(signupThrottle({ fromThisIpLastHour: SIGNUP_MAX_PER_IP_PER_HOUR - 1, allLastDay: 39 }, 40)).toBe('ok');
  });

  it('stops one address before it stops everyone', () => {
    expect(signupThrottle({ fromThisIpLastHour: SIGNUP_MAX_PER_IP_PER_HOUR, allLastDay: 0 }, 40)).toBe('ip_limit');
    expect(signupThrottle({ fromThisIpLastHour: SIGNUP_MAX_PER_IP_PER_HOUR, allLastDay: 40 }, 40)).toBe('ip_limit');
  });

  it('stops at the daily cap, and a cap of zero switches signup sessions off', () => {
    expect(signupThrottle({ fromThisIpLastHour: 0, allLastDay: 40 }, 40)).toBe('daily_cap');
    expect(signupThrottle({ fromThisIpLastHour: 0, allLastDay: 0 }, 0)).toBe('daily_cap');
  });
});

describe('maskPan', () => {
  it('shows only the last four characters', () => {
    expect(maskPan('ABCDE1234F')).toBe('••••••234F');
    expect(maskPan(null)).toBeNull();
    expect(maskPan('AB')).toBeNull();
  });
});

describe('readCallbackQuery', () => {
  it('reads the redirect the vendor actually sends as a completed consent', () => {
    const q = readCallbackQuery({ session_id: 'abc123', state: 'st-1', documents: 'pan aadhaar', has_verified_data: '1' });
    expect(q).toEqual({ sessionId: 'abc123', state: 'st-1', declined: false, error: null });
  });

  it('still accepts the older id parameter', () => {
    expect(readCallbackQuery({ id: 'abc123' }).sessionId).toBe('abc123');
  });

  it('treats the redirect as a refusal only when it says so', () => {
    expect(readCallbackQuery({ session_id: 'a', error: 'access_denied' })).toMatchObject({ declined: true, error: 'access_denied' });
    expect(readCallbackQuery({ session_id: 'a', success: 'false' })).toMatchObject({ declined: true, error: 'consent_declined' });
    expect(readCallbackQuery({ session_id: 'a', has_verified_data: '0' }).declined).toBe(true);
    expect(readCallbackQuery({ session_id: 'a' }).declined).toBe(false);
  });

  it('ignores repeated or non-string parameters', () => {
    expect(readCallbackQuery({ session_id: ['a', 'b'], state: { x: 1 } })).toMatchObject({ sessionId: '', state: '' });
  });
});
