/**
 * The database handles, without knowing which platform provides them.
 * -----------------------------------------------------------------------------
 * `shared/` is imported by BOTH niyomwealth.com and the mobile app, so it cannot
 * construct a Supabase client itself: the website reads its URL and key from
 * `import.meta.env` (Vite syntax Hermes cannot parse) and stores sessions in
 * localStorage, while the app reads `process.env.EXPO_PUBLIC_*` and stores them
 * in the device keychain. Both produce the same three clients; only the making
 * of them differs.
 *
 * So each platform builds its own and registers it here at startup, and every
 * shared service asks for one by SURFACE rather than importing a concrete
 * instance.
 *
 * ## The surfaces are not interchangeable
 *
 * A staff member, a client and a partner can all be signed in at once, each
 * with their own session. Handing a service the wrong one is not a style
 * mistake — RLS and the `is_client` / `nw_current_dsa_id()` checks then run as
 * the wrong identity, which is how a CRM session once leaked into the client
 * portal and made every client edge function answer 401. Keep using the surface
 * the service was written for.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';

export type DbSurface = 'default' | 'client' | 'partner';

export type NiyomDb = SupabaseClient<Database>;

const clients: Partial<Record<DbSurface, NiyomDb>> = {};

/** Called once per surface at platform startup, before any service runs. */
export function registerDb(surface: DbSurface, client: NiyomDb): void {
  clients[surface] = client;
}

/**
 * The registered client for a surface.
 *
 * Throws rather than falling back to another surface: a missing registration is
 * a wiring bug at startup, and silently substituting `default` would run a
 * client's query as an anonymous or staff user — the exact confusion the three
 * separate sessions exist to prevent.
 */
export function getDb(surface: DbSurface): NiyomDb {
  const client = clients[surface];
  if (!client) {
    throw new Error(
      `No Supabase client registered for the "${surface}" surface. ` +
        'The platform entry point must call registerDb() before any service runs.',
    );
  }
  return client;
}

/** Whether a surface has been wired up — for platform startup checks only. */
export function hasDb(surface: DbSurface): boolean {
  return !!clients[surface];
}

/**
 * A stand-in for a client that resolves on every property access.
 *
 * This exists so the moved services did not have to change: they still read
 * `supabase.from(...)`, and the lookup happens when that line RUNS rather than
 * when the module is imported. A plain `const supabase = getDb('client')` at
 * module scope would evaluate during the import graph — before the platform has
 * registered anything — and throw on startup.
 *
 * Methods are bound to the real client so `this` is never the proxy.
 */
function lazyClient(surface: DbSurface): NiyomDb {
  return new Proxy({} as NiyomDb, {
    get(_target, prop) {
      const client = getDb(surface) as unknown as Record<string | symbol, unknown>;
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
    has(_target, prop) {
      return prop in (getDb(surface) as unknown as object);
    },
  });
}

/** Employee / CRM and public-anon reads. */
export const defaultDb = lazyClient('default');
/** The client Wealth Portal. */
export const clientDb = lazyClient('client');
/** The partner (DSA) portal. */
export const partnerDb = lazyClient('partner');
