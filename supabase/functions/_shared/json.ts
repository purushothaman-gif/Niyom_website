/**
 * Narrowing an ordinary object to the `Json` type a jsonb column expects.
 *
 * `Record<string, unknown>` is not assignable to `Json`, and TypeScript is
 * right to say so: `unknown` could hold a function, a Date, a Map — none of
 * which survive a round trip through jsonb. The values we actually pass are
 * always plain, JSON-serialisable data being written to a metadata or payload
 * column.
 *
 * So this is a cast, but a NAMED one in a single place rather than eight
 * scattered `as Json`s. Calling it is a claim that the value is JSON-safe; if
 * you cannot make that claim, serialise properly instead of reaching for this.
 *
 * It exists because generating the database types turned a whole class of
 * silent looseness into eight compile errors, and the honest answer to most of
 * them is "yes, this really is JSON" rather than a change in behaviour.
 */
import type { Json } from './database.types.ts';

export function asJson(value: unknown): Json {
  return value as Json;
}
