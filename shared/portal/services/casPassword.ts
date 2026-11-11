/**
 * A statement password the client never has to invent or remember.
 *
 * CAMS makes the investor choose a password for the PDF, and its rules are
 * fussy enough that people fail the form on them: 8–15 characters, starting
 * with a letter, with an uppercase letter, a digit and one of `@ # $ * _`.
 * Generating one that already passes removes that failure, and because we made
 * it we can hand it straight back at upload instead of asking for it again.
 *
 * It is generated in the browser and kept only for the browser session — it is
 * never sent to our servers until it travels with the PDF it opens.
 */

/* No l/o/i or 0/1: the client may end up typing this by hand on the CAMS page. */
const UPPER = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';
const SPECIAL = '@#$*_';

function randomIndex(max: number): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    // Rejection sampling, so every character is equally likely.
    const limit = 256 - (256 % max);
    const buf = new Uint8Array(1);
    for (;;) {
      c.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % max;
    }
  }
  return Math.floor(Math.random() * max);
}

const pick = (set: string, n: number): string =>
  Array.from({ length: n }, () => set[randomIndex(set.length)]).join('');

/** e.g. `Kmrtqx@4827` — one upper, five lower, one special, four digits. */
export function generateCasPassword(): string {
  return pick(UPPER, 1) + pick(LOWER, 5) + pick(SPECIAL, 1) + pick(DIGITS, 4);
}

/** CAMS's own rules, as printed beside the password field on its form. */
export function isValidCasPassword(p: string): boolean {
  return (
    /^[A-Za-z][A-Za-z0-9@#$*_]{7,14}$/.test(p) &&
    /[A-Z]/.test(p) &&
    /[0-9]/.test(p) &&
    /[@#$*_]/.test(p)
  );
}

const storageKey = (requestId: string) => `niyom.cas.pw.${requestId}`;

/**
 * Session-scoped memory of the generated password, keyed by request.
 *
 * The statement arrives about five minutes after the request, and a client who
 * closes the dialog in between should not come back to a password they were
 * told they would not need to remember. sessionStorage dies with the tab, which
 * is as long as this is useful for.
 */
export const casPasswordStore = {
  save(requestId: string, password: string): void {
    try {
      globalThis.sessionStorage?.setItem(storageKey(requestId), password);
    } catch {
      /* storage blocked — the password stays on screen to copy */
    }
  },
  load(requestId: string): string {
    try {
      return globalThis.sessionStorage?.getItem(storageKey(requestId)) ?? '';
    } catch {
      return '';
    }
  },
  clear(requestId: string): void {
    try {
      globalThis.sessionStorage?.removeItem(storageKey(requestId));
    } catch {
      /* nothing to clear */
    }
  },
};
