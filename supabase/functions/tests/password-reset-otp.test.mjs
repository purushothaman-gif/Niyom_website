/*
 * Tests for the "Forgot Password with OTP" flow (CRM staff).
 *
 * Run:  node --test supabase/functions/tests/password-reset-otp.test.mjs
 *
 * Two layers:
 *  1. UNIT — pure algorithm tests that MIRROR the edge-function logic
 *     (send-reset-otp / reset-password-with-otp). They cover OTP generation,
 *     hashing, the password policy, and the verify/reset state machine
 *     (valid, expired, invalid, max-attempts, reuse).
 *  2. INTEGRATION — live HTTP tests against the deployed edge functions,
 *     run only when SUPABASE_URL + SUPABASE_ANON_KEY + TEST_RESET_EMAIL are
 *     set; otherwise they are skipped (so `node --test` is always green).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const webcrypto = globalThis.crypto;
const PEPPER = 'unit-test-pepper';
const MAX_ATTEMPTS = 3;
const OTP_TTL_MS = 5 * 60 * 1000;

/* ---- algorithm mirrors of the edge functions ---- */

function generateOTP() {
  const max = 1_000_000;
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let n;
  do { webcrypto.getRandomValues(buf); n = buf[0]; } while (n >= limit);
  return (n % max).toString().padStart(6, '0');
}

async function hashOTP(otp, email, pepper = PEPPER) {
  const data = new TextEncoder().encode(`${otp}:${email}:${pepper}`);
  const digest = await webcrypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function passwordError(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 72) return 'Password must be 72 characters or fewer.';
  if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include a symbol.';
  return null;
}

// Pure model of the reset-password-with-otp state machine, operating on an
// in-memory OTP "row". Returns { outcome, row } so tests can assert effects.
async function evaluate(row, otpInput, email, action, password, now = Date.now()) {
  if (!row || row.used) return { outcome: 'no_otp', row };
  if (new Date(row.expires_at).getTime() < now) return { outcome: 'expired', row: null };
  if (row.attempts >= MAX_ATTEMPTS) return { outcome: 'max_attempts', row: null };

  const candidate = await hashOTP(String(otpInput).trim(), email);
  if (!safeEqual(candidate, row.otp_hash)) {
    const attempts = row.attempts + 1;
    const updated = { ...row, attempts };
    if (MAX_ATTEMPTS - attempts <= 0) return { outcome: 'max_attempts', row: null };
    return { outcome: 'wrong', row: updated };
  }
  if (action === 'verify') return { outcome: 'verified', row };
  // reset
  const pwErr = passwordError(password);
  if (pwErr) return { outcome: 'weak_password', row, error: pwErr };
  return { outcome: 'reset', row: { ...row, used: true } };
}

function makeRow(email, otpHash, overrides = {}) {
  return {
    email, otp_hash: otpHash, attempts: 0, used: false,
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    ...overrides,
  };
}

/* ---------------------------- UNIT TESTS ---------------------------- */

test('OTP is always a 6-digit string', () => {
  for (let i = 0; i < 5000; i++) assert.match(generateOTP(), /^\d{6}$/);
});

test('OTP distribution covers the full 0-9 range with no obvious bias', () => {
  const counts = new Array(10).fill(0);
  for (let i = 0; i < 20000; i++) for (const ch of generateOTP()) counts[+ch]++;
  const total = counts.reduce((a, b) => a + b, 0);
  for (const c of counts) {
    const share = c / total;            // expected ~0.1 per digit
    assert.ok(share > 0.08 && share < 0.12, `digit share out of range: ${share}`);
  }
});

test('hashOTP is deterministic and never equals the plaintext', async () => {
  const h1 = await hashOTP('123456', 'a@b.com');
  const h2 = await hashOTP('123456', 'a@b.com');
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.notEqual(h1, '123456');
});

test('hashOTP changes with email and with pepper (binding)', async () => {
  const base = await hashOTP('123456', 'a@b.com');
  assert.notEqual(base, await hashOTP('123456', 'other@b.com'));
  assert.notEqual(base, await hashOTP('123456', 'a@b.com', 'different-pepper'));
});

test('password policy accepts strong and rejects weak passwords', () => {
  assert.equal(passwordError('Abcdef1!'), null);
  assert.equal(passwordError('GoodPass99$'), null);
  assert.match(passwordError('short1A'), /at least 8/);
  assert.match(passwordError('alllowercase1!'), /uppercase/);
  assert.match(passwordError('ALLUPPERCASE1!'), /lowercase/);
  assert.match(passwordError('NoNumbersHere!'), /number/);
  assert.match(passwordError('NoSymbols123'), /symbol/);
  assert.match(passwordError('A1!' + 'x'.repeat(80)), /72 characters/);
});

test('VALID OTP verifies and then resets, consuming the OTP', async () => {
  const email = 'staff@niyomwealth.com';
  const otp = '654321';
  const row = makeRow(email, await hashOTP(otp, email));

  const v = await evaluate(row, otp, email, 'verify');
  assert.equal(v.outcome, 'verified');

  const r = await evaluate(row, otp, email, 'reset', 'NewPass123!');
  assert.equal(r.outcome, 'reset');
  assert.equal(r.row.used, true);
});

test('EXPIRED OTP is rejected', async () => {
  const email = 'staff@niyomwealth.com';
  const otp = '111111';
  const row = makeRow(email, await hashOTP(otp, email), {
    expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  const r = await evaluate(row, otp, email, 'verify');
  assert.equal(r.outcome, 'expired');
});

test('INVALID OTP increments attempts', async () => {
  const email = 'staff@niyomwealth.com';
  const row = makeRow(email, await hashOTP('222222', email));
  const r = await evaluate(row, '000000', email, 'verify');
  assert.equal(r.outcome, 'wrong');
  assert.equal(r.row.attempts, 1);
});

test('MAX ATTEMPTS (3) locks out the OTP', async () => {
  const email = 'staff@niyomwealth.com';
  let row = makeRow(email, await hashOTP('333333', email));
  // three wrong tries
  let r = await evaluate(row, '000001', email, 'verify'); // attempts 1
  row = r.row;
  r = await evaluate(row, '000002', email, 'verify');     // attempts 2
  row = r.row;
  r = await evaluate(row, '000003', email, 'verify');     // attempts 3 -> lockout
  assert.equal(r.outcome, 'max_attempts');
  assert.equal(r.row, null, 'OTP row should be destroyed on lockout');
});

test('REUSING a consumed OTP fails', async () => {
  const email = 'staff@niyomwealth.com';
  const otp = '444444';
  const used = makeRow(email, await hashOTP(otp, email), { used: true });
  const r = await evaluate(used, otp, email, 'reset', 'NewPass123!');
  assert.equal(r.outcome, 'no_otp');
});

test('RESET with a weak password is rejected even when OTP is valid', async () => {
  const email = 'staff@niyomwealth.com';
  const otp = '555555';
  const row = makeRow(email, await hashOTP(otp, email));
  const r = await evaluate(row, otp, email, 'reset', 'weak');
  assert.equal(r.outcome, 'weak_password');
  assert.notEqual(r.row.used, true);
});

/* ------------------------- INTEGRATION TESTS ------------------------ */
// Live tests against deployed functions. Skipped unless env is configured.

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const TEST_EMAIL = process.env.TEST_RESET_EMAIL;
const integrationReady = Boolean(URL && ANON && TEST_EMAIL);

async function callFn(path, payload) {
  const res = await fetch(`${URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, Apikey: ANON },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('INTEGRATION: unknown email returns generic success (no enumeration)', { skip: !integrationReady }, async () => {
  const { status, data } = await callFn('send-reset-otp', { email: `nobody+${Date.now()}@example.com` });
  assert.equal(status, 200);
  assert.equal(data.success, true);
});

test('INTEGRATION: send OTP to a known email, then rate-limit a 2nd immediate request', { skip: !integrationReady }, async () => {
  const first = await callFn('send-reset-otp', { email: TEST_EMAIL });
  assert.equal(first.status, 200);
  const second = await callFn('send-reset-otp', { email: TEST_EMAIL });
  assert.equal(second.status, 429, 'second immediate request should be rate-limited');
});

test('INTEGRATION: wrong OTP is rejected', { skip: !integrationReady }, async () => {
  const { status, data } = await callFn('reset-password-with-otp', {
    action: 'verify', email: TEST_EMAIL, otp: '000000',
  });
  assert.equal(status, 400);
  assert.equal(data.success, false);
});
