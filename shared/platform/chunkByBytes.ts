/**
 * Splitting a string to fit a byte budget.
 * -----------------------------------------------------------------------------
 * Lives here rather than beside its only caller because it is pure string
 * logic, and because the mistake it exists to prevent is invisible until it
 * reaches a real person.
 *
 * The mobile app stores Supabase sessions in the device keychain, which caps a
 * single value at 2048 BYTES. Chunking by character length passes every test
 * written in English and then fails for "अनिल" or "செல்வன்", whose characters
 * are three bytes each — the write throws, the session never persists, and the
 * client is signed out every time they close the app with nothing on screen to
 * explain it. For an Indian wealth app that is not an edge case.
 */

/** How many bytes one code point occupies in UTF-8. */
function byteLength(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Split `value` into pieces that each encode to at most `budget` UTF-8 bytes.
 *
 * Iterated by CODE POINT, not by UTF-16 unit, so an emoji is never cut in half
 * across two chunks: rejoining the parts must reproduce the original exactly,
 * and half a surrogate pair does not survive a round trip through the keychain.
 *
 * Always returns at least one element, so an empty value still round-trips.
 */
export function chunkByBytes(value: string, budget: number): string[] {
  if (budget < 4) throw new Error('Byte budget must fit at least one code point.');

  const parts: string[] = [];
  let current = '';
  let used = 0;

  for (const char of value) {
    const size = byteLength(char.codePointAt(0)!);
    if (used + size > budget) {
      parts.push(current);
      current = '';
      used = 0;
    }
    current += char;
    used += size;
  }
  if (current) parts.push(current);

  return parts.length > 0 ? parts : [''];
}
