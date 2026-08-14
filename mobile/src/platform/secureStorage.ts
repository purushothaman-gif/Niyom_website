/**
 * Where a signed-in session lives on a phone.
 * -----------------------------------------------------------------------------
 * The website keeps Supabase sessions in localStorage because that is all a
 * browser offers. A phone has somewhere better: the iOS Keychain and the
 * Android Keystore, which are encrypted at rest and tied to the device unlock.
 * A stolen, locked handset does not give up a session token from here.
 *
 * ## Why the chunking exists
 *
 * `expo-secure-store` refuses values over 2048 bytes. A Supabase session is a
 * JSON blob holding an access token, a refresh token and the user object, and a
 * Niyom client's JWT carries enough metadata to cross that line — so storing it
 * whole works in testing with a small account and then fails, silently, for a
 * real one. Values are therefore split across numbered keys, with an index key
 * recording how many parts there are.
 *
 * Reading is the reverse, and is deliberately strict: if any part is missing the
 * whole value is treated as absent rather than returned truncated. A half-read
 * session would be corrupt JSON, and Supabase's response to that is to sign the
 * user out anyway — better to arrive there cleanly than through a parse error.
 */
import * as SecureStore from 'expo-secure-store';
import { chunkByBytes } from '@shared/platform/chunkByBytes';

/**
 * SecureStore's ceiling is 2048 BYTES, not characters.
 *
 * Chunking by character length is the trap: a session for "अनिल" or "செல்வன்"
 * encodes to three bytes per character, so 1536 characters is 4608 bytes and
 * the write throws. The session then never persists and the client is signed
 * out every time they close the app — with nothing on screen to explain why,
 * and only for clients whose names are not ASCII. Which, for an Indian wealth
 * app, is a large share of them.
 */
const CHUNK_BYTES = 1800;

const countKey = (key: string) => `${key}__n`;
const partKey = (key: string, i: number) => `${key}__${i}`;

/**
 * SecureStore keys may only contain alphanumerics, `.`, `-` and `_`. Supabase
 * builds its own key from the project ref and our storageKey, so this normalises
 * whatever arrives rather than trusting it to be safe.
 */
function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}


async function readCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key));
  const n = raw ? Number(raw) : 0;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

async function clear(key: string): Promise<void> {
  const n = await readCount(key);
  const deletions: Promise<void>[] = [SecureStore.deleteItemAsync(countKey(key))];
  for (let i = 0; i < n; i += 1) deletions.push(SecureStore.deleteItemAsync(partKey(key, i)));
  await Promise.all(deletions);
}

export const secureStorage = {
  async getItem(rawKey: string): Promise<string | null> {
    const key = safeKey(rawKey);
    try {
      const n = await readCount(key);
      if (n === 0) return null;
      const parts = await Promise.all(
        Array.from({ length: n }, (_, i) => SecureStore.getItemAsync(partKey(key, i))),
      );
      // All-or-nothing: a gap means the value is unusable, not merely shorter.
      if (parts.some((p) => p === null)) {
        await clear(key);
        return null;
      }
      return parts.join('');
    } catch {
      return null;
    }
  },

  async setItem(rawKey: string, value: string): Promise<void> {
    const key = safeKey(rawKey);
    try {
      await clear(key);
      const parts = chunkByBytes(value, CHUNK_BYTES);
      await Promise.all(parts.map((part, i) => SecureStore.setItemAsync(partKey(key, i), part)));
      await SecureStore.setItemAsync(countKey(key), String(parts.length));
    } catch {
      /*
       * Losing the write costs persistence, not the session: the client keeps
       * the tokens in memory, so the user stays signed in until they close the
       * app and is asked to sign in again after that.
       */
    }
  },

  async removeItem(rawKey: string): Promise<void> {
    try {
      await clear(safeKey(rawKey));
    } catch {
      /* nothing useful to do — the caller is signing out regardless */
    }
  },
};
