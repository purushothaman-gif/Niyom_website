/**
 * Just enough Deno and Deno-specifier typing for `tsc` to check these files.
 *
 * ## Why this exists
 *
 * Edge Functions are Deno, and `supabase/functions` sat in no tsconfig at all —
 * so nothing typechecked 91 files and 64 deployed functions. That is not a
 * theoretical gap. Extracting a module dropped its `node:crypto` import and
 * left `randomUUID` undefined in three places; it shipped, and every CAS import
 * died with a generic 500 until it was tracked down by hand. `tsc` would have
 * said "Cannot find name 'randomUUID'" in under a second.
 *
 * ## What this is NOT
 *
 * A substitute for `deno check`. Deno's own checker knows the real shape of
 * `npm:` and `jsr:` specifiers and of the Deno API; this only knows what is
 * written below. It is deliberately the cheap 80%: it catches undefined
 * identifiers, wrong local imports, bad argument counts and type errors in OUR
 * code, which is where our bugs have actually been. If Deno is ever installed
 * on CI, `deno check` should run alongside this, not instead of it.
 *
 * Anything declared loosely here is a place where a mistake would still get
 * through, so keep the loose declarations few and obvious.
 */

/**
 * Remote specifiers, typed as `any`.
 *
 * `npm:@supabase/supabase-js@2` is mapped to the real installed package by
 * `paths` in tsconfig.json, so the one dependency that actually matters keeps
 * its types. Everything else falls to these, which is a known blind spot rather
 * than an oversight.
 */
declare module 'npm:*';
declare module 'jsr:*';
declare module 'https://*';

/**
 * supabase-js, mapped onto the REAL package types and the generated schema.
 *
 * This was deliberately `any` until `Database` existed, because the real types
 * resolve every `.from(x).insert(y)` to `never` without a schema — ~80 errors,
 * all noise. With the schema generated, every table, column and return shape in
 * these functions is now checked against the actual database.
 */
declare module 'npm:@supabase/supabase-js@2' {
  /*
   * Inline `import(...)` types, NOT top-level `import type`. A .d.ts with any
   * top-level import or export stops being a global script and becomes a
   * module — at which point `declare namespace Deno` below is no longer global
   * and 263 usages across 66 files fail with "Cannot find name 'Deno'".
   * Inline import types carry no such penalty.
   */
  type Db = import('./_shared/database.types.ts').Database;

  export type SupabaseClient = import('@supabase/supabase-js').SupabaseClient<Db>;
  export type User = { id: string; email?: string; user_metadata?: Record<string, unknown> };
  export function createClient(
    url: string,
    key: string,
    options?: Record<string, unknown>,
  ): import('@supabase/supabase-js').SupabaseClient<Db>;
}

/**
 * The slice of the Deno API these functions use. Extend it when a function
 * needs more — a missing member should fail the check and be added here
 * deliberately, not be silenced with `any`.
 *
 * Must stay in a file with NO top-level import or export, or these stop being
 * global and every `Deno.` usage fails at once.
 */
declare namespace Deno {
  export const env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    toObject(): Record<string, string>;
  };

  export function serve(
    handler: (req: Request, info?: unknown) => Response | Promise<Response>,
  ): unknown;
  export function serve(
    options: { port?: number; hostname?: string; onListen?: (p: unknown) => void },
    handler: (req: Request, info?: unknown) => Response | Promise<Response>,
  ): unknown;

  export function memoryUsage(): {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };

  export const version: { deno: string; v8: string; typescript: string };

  export function exit(code?: number): never;
  export function readTextFile(path: string | URL): Promise<string>;
  export function writeTextFile(path: string | URL, data: string): Promise<void>;
}
