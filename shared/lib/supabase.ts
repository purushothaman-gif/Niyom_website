/**
 * The three Supabase handles, as the shared services already expect them.
 * -----------------------------------------------------------------------------
 * Every service under `shared/` was written against `src/lib/supabase.ts` and
 * imports `'../../lib/supabase'`. Because `shared/` mirrors the website's folder
 * depth, that import now lands here — so the services did not have to change a
 * single line when they moved.
 *
 * What they get is not a client but a lazy stand-in (see platform/db.ts): the
 * real instance is looked up on each property access, so whichever platform is
 * running has had a chance to register its own. The names, and which surface
 * each one belongs to, are exactly as they were on the website.
 */
export { clientDb as clientSupabase, partnerDb as partnerSupabase, defaultDb as supabase } from '../platform/db';
export type { NiyomDb, DbSurface } from '../platform/db';
