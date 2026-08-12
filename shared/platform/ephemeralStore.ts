/**
 * A scratch key/value store that lasts as long as the sign-in does.
 * -----------------------------------------------------------------------------
 * The website backs this with `sessionStorage`, which dies with the tab. A
 * mobile app has no tab, so it uses plain memory, which dies with the process —
 * the same guarantee, reached differently.
 *
 * Only ever holds flags about the CURRENT session (today: whether the partner
 * portal is running in demo mode). Nothing here is a credential and nothing
 * here should survive a sign-out.
 */

export interface EphemeralStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

/**
 * The fallback. Also what the app uses outright: an in-memory map is exactly
 * "cleared when the process ends", which is what sessionStorage means on web.
 */
function memoryStore(): EphemeralStore {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
}

let store: EphemeralStore = memoryStore();

/** Called at platform startup by the website; the app keeps the default. */
export function registerEphemeralStore(next: EphemeralStore): void {
  store = next;
}

export function ephemeralGet(key: string): string | null {
  try {
    return store.get(key);
  } catch {
    return null;
  }
}

export function ephemeralSet(key: string, value: string): void {
  try {
    store.set(key, value);
  } catch {
    /* a refusal here only costs the flag, never correctness */
  }
}

export function ephemeralRemove(key: string): void {
  try {
    store.remove(key);
  } catch {
    /* as above */
  }
}
