/**
 * PIN hashing + the lockout rules, shared by the client-pin-* functions.
 *
 * PBKDF2-SHA256 via Web Crypto rather than bcrypt: it is native to the Deno
 * runtime (no npm dependency in the hot path of a login) and, at these
 * iteration counts, costs an attacker who somehow obtained the table roughly a
 * second per guess per row.
 *
 * The work factor matters less here than it would for a password, because four
 * digits is only 10,000 possibilities — offline, no KDF saves you. What saves
 * you is that a PIN is useless without the device it is bound to, and that the
 * server stops counting long before an online attacker gets through.
 */

const ITERATIONS = 310_000;

const encoder = new TextEncoder();

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const fromHex = (hex: string): Uint8Array =>
  new Uint8Array((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)));

export function newSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
}

export async function hashPin(
  pin: string,
  salt: string,
  iterations = ITERATIONS,
): Promise<{ hash: string; salt: string; iterations: number }> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(salt), iterations },
    key,
    256,
  );
  return { hash: toHex(bits), salt, iterations };
}

/** Constant-time compare, so a wrong PIN cannot be narrowed by timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPin(
  pin: string,
  salt: string,
  iterations: number,
  expectedHash: string,
): Promise<boolean> {
  const { hash } = await hashPin(pin, salt, iterations);
  return timingSafeEqual(hash, expectedHash);
}

/** A PIN is exactly four digits. Anything else never reaches the KDF. */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

/**
 * Trivial PINs are refused. "1234" and "0000" are the first guesses anyone
 * makes, and the whole scheme rests on an online attacker running out of tries
 * before they run out of obvious candidates.
 */
const BANNED_PINS = new Set([
  "0000", "1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999",
  "1234", "2345", "3456", "4567", "5678", "6789", "0123", "4321", "9876", "1212",
  "1122", "2580", "0852", "1010", "2020",
]);

export function isWeakPin(pin: string): boolean {
  return BANNED_PINS.has(pin);
}

/* ----------------------------- Lockout policy ----------------------------- */

/** Wrong tries before the device has to cool off. */
export const ATTEMPTS_BEFORE_LOCK = 5;
/** How long that cool-off lasts. */
export const LOCK_MINUTES = 15;
/** Total wrong tries before the PIN is burned and a full login is required. */
export const ATTEMPTS_BEFORE_BURN = 10;
/** A remembered device is remembered for this long, extended on each use. */
export const DEVICE_DAYS = 30;

export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
}

export function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}
