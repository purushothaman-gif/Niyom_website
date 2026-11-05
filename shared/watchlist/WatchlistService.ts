/**
 * Watchlist — bonds, funds and unlisted shares a client is watching, or a
 * partner has shortlisted to pitch. Backed by nw_watchlist, whose owner columns
 * default from the caller's own session and whose RLS limits every caller to
 * their own rows, so nothing here ever sends an owner id.
 *
 * The sample (demo) portals have no database session; they keep the list in
 * the ephemeral store for the session, so the feature still demos end to end.
 */
import type { NiyomDb } from '../platform/db';
import { ephemeralGet, ephemeralSet } from '../platform/ephemeralStore';

export type WatchType = 'bond' | 'share' | 'fund';

export const watchKey = (type: WatchType, ref: string) => `${type}:${ref}`;

/** One demo list per portal, so the sample client and sample partner don't share. */
const demoKey = (scope: string) => `nw_demo_watchlist_${scope}`;

function demoRead(scope: string): Set<string> {
  try {
    return new Set(JSON.parse(ephemeralGet(demoKey(scope)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function demoWrite(scope: string, keys: Set<string>) {
  ephemeralSet(demoKey(scope), JSON.stringify([...keys]));
}

export const WatchlistService = {
  async list(db: NiyomDb | null, demoScope = 'client'): Promise<Set<string>> {
    if (!db) return demoRead(demoScope);
    const { data, error } = await db.from('nw_watchlist').select('item_type, item_ref').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return new Set((data ?? []).map((r) => watchKey(r.item_type as WatchType, r.item_ref)));
  },

  async add(db: NiyomDb | null, type: WatchType, ref: string, demoScope = 'client'): Promise<void> {
    if (!db) {
      const s = demoRead(demoScope);
      s.add(watchKey(type, ref));
      demoWrite(demoScope, s);
      return;
    }
    const { error } = await db.from('nw_watchlist').insert({ item_type: type, item_ref: ref });
    // Already watched (unique index) is success, not a failure.
    if (error && error.code !== '23505') throw new Error(error.message);
  },

  async remove(db: NiyomDb | null, type: WatchType, ref: string, demoScope = 'client'): Promise<void> {
    if (!db) {
      const s = demoRead(demoScope);
      s.delete(watchKey(type, ref));
      demoWrite(demoScope, s);
      return;
    }
    const { error } = await db.from('nw_watchlist').delete().eq('item_type', type).eq('item_ref', ref);
    if (error) throw new Error(error.message);
  },
};
