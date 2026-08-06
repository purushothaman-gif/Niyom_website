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
 * supabase-js, named explicitly so `SupabaseClient` is a TYPE.
 *
 * Under the `npm:*` wildcard the whole module is `any`, which makes an imported
 * `SupabaseClient` a namespace — and `function f(db: SupabaseClient)` then fails
 * with "cannot use namespace as a type" in eight places that are perfectly
 * correct code.
 *
 * Loose on purpose. The real package types would be better, but they resolve
 * every `.from(x).insert(y)` to `never` without generated `Database` types,
 * which buries the check in ~80 false errors. Generating those types is the
 * right fix and its own piece of work; until then this keeps the signal clean.
 */
declare module 'npm:@supabase/supabase-js@2' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type SupabaseClient = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type User = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createClient(url: string, key: string, options?: any): any;
}

/**
 * The slice of the Deno API these functions use. Extend it when a function
 * needs more — a missing member should fail the check and be added here
 * deliberately, not be silenced with `any`.
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
