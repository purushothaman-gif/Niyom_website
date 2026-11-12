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
