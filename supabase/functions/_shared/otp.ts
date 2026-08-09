/*
 * OTP primitives and the verification decision, kept free of Deno imports so
 * the logic that actually gates account access is unit-testable under vitest.
 *
 * `_shared/onboarding.ts` owns the database I/O; this module owns the decision.
 * The split exists because the onboarding OTP shipped without an attempt cap —
 * a 6-digit code with unlimited guesses inside a 10-minute window, where a
 * success mints a magic-link token. That is the kind of rule that should be
 * provable by a test rather than by reading the caller.
 *
 * WebCrypto is used directly (globalThis.crypto), which is present in both the
 * Deno edge runtime and Node 18+, so the same code runs in production and test.
 */

/** Max failed verifications before a code is dead. Matches the reset flows. */
export const MAX_OTP_ATTEMPTS = 3;

/** Cryptographically secure 6-digit OTP with rejection sampling (no modulo bias). */
export function generateOtp(): string {
  const max = 1_000_000;
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return (n % max).toString().padStart(6, "0");
}

/** SHA-256 of `${otp}:${key}:${pepper}`. `key` is the phone for onboarding OTPs. */
export async function hashOtp(otp: string, key: string, pepper: string): Promise<string> {
  const data = new TextEncoder().encode(`${otp}:${key}:${pepper}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare — no early return on first differing byte. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface StoredOtp {
  /** DEPRECATED cleartext code on rows written before the hashed flow shipped. */
  otp?: string | null;
  otp_hash?: string | null;
  attempts?: number | null;
  expires_at: string;
}

export type OtpDecision =
  /** Correct code. Caller must consume (delete) the row. */
  | { outcome: "ok" }
  /** Dead code. Caller must delete the row. */
  | { outcome: "expired" | "exhausted"; error: string }
  /** Wrong code, still alive. Caller must persist `attempts`. */
  | { outcome: "wrong"; error: string; attempts: number };

/**
 * Decide the fate of a submitted OTP. Pure apart from hashing: it reads no
 * clock but the one passed in and touches no database.
 *
 * `exhausted` is returned both when the row arrives already at the cap and when
 * this submission reaches it, so a caller that deletes on `exhausted` closes the
 * window in either case.
 */
export async function decideOtp(
  stored: StoredOtp,
  submitted: string,
  opts: { key: string; pepper: string; nowMs: number; maxAttempts?: number },
): Promise<OtpDecision> {
  const maxAttempts = opts.maxAttempts ?? MAX_OTP_ATTEMPTS;
  const used = stored.attempts ?? 0;

  if (new Date(stored.expires_at).getTime() < opts.nowMs) {
    return { outcome: "expired", error: "OTP expired. Please request a new one." };
  }

  if (used >= maxAttempts) {
    return {
      outcome: "exhausted",
      error: "Too many incorrect attempts. Please request a new code.",
    };
  }

  const code = submitted.trim();
  // Transitional: rows predating the hashed flow carry cleartext and no hash.
  // Remove this branch together with the DROP COLUMN on nw_otps.otp.
  const match = stored.otp_hash
    ? safeEqual(await hashOtp(code, opts.key, opts.pepper), stored.otp_hash)
    : !!stored.otp && safeEqual(stored.otp, code);

  if (match) return { outcome: "ok" };

  const attempts = used + 1;
  if (attempts >= maxAttempts) {
    return {
      outcome: "exhausted",
      error: "Too many incorrect attempts. Please request a new code.",
    };
  }
  const remaining = maxAttempts - attempts;
  return {
    outcome: "wrong",
    attempts,
    error: `Incorrect OTP. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`,
  };
}
