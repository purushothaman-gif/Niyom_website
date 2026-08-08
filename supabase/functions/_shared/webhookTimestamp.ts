/**
 * Normalising a webhook's `x-webhook-timestamp` to epoch SECONDS.
 *
 * ## Why this exists
 *
 * Cashfree sends epoch MILLISECONDS on payment webhooks (`1786178797553`, 13
 * digits). The replay-window check read that as seconds, which put every real
 * payment delivery roughly 56,000 years in the future and rejected it with
 * `401 Stale webhook timestamp` — while the dashboard's own test payload, which
 * does not carry a millisecond stamp, sailed through. The result was a webhook
 * that passed its provider's connectivity test and silently refused every
 * actual payment, so money was taken and never booked.
 *
 * ## Scope — freshness only
 *
 * This is for the staleness comparison and NOTHING else. The HMAC must be
 * computed over the timestamp header EXACTLY as received: the provider signed
 * those bytes, so normalising, trimming or re-formatting the value before
 * hashing breaks every signature. Callers pass the raw header string to the
 * signature function and this one only to the age check.
 *
 * ## The discriminator
 *
 * 1e11 as seconds is the year 5138; 1e11 as milliseconds is 1973. No timestamp
 * a live system will ever see is ambiguous between the two, so magnitude is a
 * safe way to tell them apart — and it keeps working if a provider switches
 * units, which is exactly the change that caused this bug.
 */

/** Above this, a value can only be milliseconds. See the note above. */
const MILLISECOND_THRESHOLD = 1e11;

/**
 * Epoch seconds for a raw timestamp header, whether the provider sent seconds
 * or milliseconds. Returns NaN for anything non-numeric, so callers can decide
 * whether a missing/garbled timestamp should skip the check or reject.
 */
export function toEpochSeconds(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return NaN;
  const trimmed = String(raw).trim();
  // Number("") and Number("   ") are 0, not NaN. Left unguarded, an empty
  // header would read as epoch 0 and be rejected as ~56 years stale — the same
  // class of silent misreading this module exists to prevent.
  if (trimmed === "") return NaN;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return NaN;
  return Math.abs(n) > MILLISECOND_THRESHOLD ? n / 1000 : n;
}

/**
 * How old a delivery is, in seconds, relative to `nowMs`. Absolute value, so a
 * clock a little ahead of the provider's reads as age rather than as a negative
 * that would slip past a naive `age > tolerance` test.
 */
export function timestampAgeSeconds(raw: string | null | undefined, nowMs: number = Date.now()): number {
  const seconds = toEpochSeconds(raw);
  if (!Number.isFinite(seconds)) return NaN;
  return Math.abs(nowMs / 1000 - seconds);
}
