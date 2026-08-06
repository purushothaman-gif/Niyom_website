/**
 * Narrowing app objects to what the generated schema expects.
 *
 * The frontend counterpart of `supabase/functions/_shared/json.ts`, and it
 * exists for the same reason: typing the Supabase clients against the real
 * schema turned a class of silent looseness into compile errors, and for most
 * of them the honest answer is "yes, this really is that shape" rather than a
 * change in behaviour.
 *
 * Both helpers are casts. Naming them keeps the claim visible and in one place
 * instead of scattering `as` through the CRM, and makes it obvious where to
 * look if a write ever lands in the database looking wrong.
 */
import type { Database, Json } from './database.types';

/**
 * A plain, JSON-serialisable value on its way to a jsonb column.
 *
 * `Record<string, unknown>` is not assignable to `Json`, and correctly so —
 * `unknown` could be a Date, a Map or a function, none of which survive jsonb.
 * Calling this asserts the value is genuinely JSON. If you cannot assert that,
 * serialise it properly instead.
 */
export function asJson(value: unknown): Json {
  return value as Json;
}

/** The row shape a table's `.insert()` accepts. */
export type Insertable<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];

/** The row shape a table's `.update()` accepts. */
export type Updatable<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
