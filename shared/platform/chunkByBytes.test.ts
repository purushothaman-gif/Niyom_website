/**
 * The cases here are the ones that actually break it: scripts where a character
 * is not a byte, and astral characters where a code point is not a UTF-16 unit.
 * An ASCII-only test suite passes against the broken implementation.
 */
import { describe, expect, it } from 'vitest';
import { chunkByBytes } from './chunkByBytes';

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

const BUDGET = 1800;

const SAMPLES: [name: string, value: string][] = [
  ['ascii', 'a'.repeat(5000)],
  ['devanagari', 'अनिल कुमार '.repeat(400)],
  ['tamil', 'செல்வன் '.repeat(400)],
  ['astral (emoji)', '🙏'.repeat(1200)],
  ['mixed scripts', 'Anand अनिल செல்வன் 🙏 '.repeat(300)],
  ['exactly one budget', 'a'.repeat(BUDGET)],
  ['one byte over', 'a'.repeat(BUDGET + 1)],
  ['single astral char', '🙏'],
  ['empty', ''],
];

describe('chunkByBytes', () => {
  for (const [name, value] of SAMPLES) {
    it(`${name}: no chunk exceeds the byte budget`, () => {
      for (const part of chunkByBytes(value, BUDGET)) {
        expect(utf8Bytes(part)).toBeLessThanOrEqual(BUDGET);
      }
    });

    it(`${name}: rejoining reproduces the original exactly`, () => {
      expect(chunkByBytes(value, BUDGET).join('')).toBe(value);
    });
  }

  it('never splits a surrogate pair', () => {
    // A budget that lands mid-emoji if the split is done by UTF-16 unit.
    for (const part of chunkByBytes('🙏'.repeat(50), 7)) {
      // A lone surrogate survives neither JSON nor the keychain; catching it
      // here is the point of iterating by code point.
      expect(part).toBe(part.normalize());
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(part)).toBe(false);
    }
  });

  it('round-trips a realistic Supabase session with a non-ASCII name', () => {
    /*
     * Sized to span several chunks on purpose. A Supabase access token carrying
     * app_metadata and user_metadata runs to a couple of kilobytes on its own,
     * so a single-chunk fixture would exercise none of the splitting.
     */
    const session = JSON.stringify({
      access_token: `eyJ${'x'.repeat(2400)}`,
      refresh_token: 'y'.repeat(64),
      expires_at: 1786566616,
      user: {
        id: '019aa187-18b7-48da-96d9-5a65d9712741',
        email: 'anand@example.com',
        user_metadata: { full_name: 'अनिल कुमार செல்வன்', is_client: true },
      },
    });

    const parts = chunkByBytes(session, BUDGET);
    expect(parts.join('')).toBe(session);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(utf8Bytes(part)).toBeLessThanOrEqual(BUDGET);
  });

  it('refuses a budget too small for one code point', () => {
    expect(() => chunkByBytes('x', 3)).toThrow();
  });
});
