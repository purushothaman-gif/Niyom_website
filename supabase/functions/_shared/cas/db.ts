/**
 * Service-role Supabase access for the CAS modules, and the error type they
 * answer with.
 *
 * No SDK on purpose — four verbs over plain fetch against PostgREST, the way
 * the droplet did it. Pulling in a client library for four calls would be the
 * larger dependency, and this code has to run identically in Deno and in the
 * Node test runner.
 *
 * Everything here runs as the service role, which bypasses RLS. That is
 * deliberate and is the whole reason the CAS tables are readable by a client
 * but writable by nobody: a browser session cannot forge a consent record or
 * move a request's status, because it cannot write these tables at all.
 *
 * ## Why the config is a parameter and not `Deno.env`
 *
 * `SbConfig` is structurally what `ProxyConfig` already provided on the
 * droplet, so `nav.ts` and `navHistory.ts` moved across with nothing changed
 * but an import line. It also keeps these modules importable by vitest, which
 * has no `Deno` global — `envConfig()` is the only thing that touches it, and
 * only a function actually running in Deno ever calls it.
 */

/** The two things every call needs. Satisfied by the droplet's ProxyConfig too. */
export interface SbConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string | null;
}

/**
 * An error with a status the caller can hand straight back.
 *
 * Messages reach a client verbatim, so they are written for an investor rather
 * than an operator — no table names, no status codes in the prose.
 */
export class CasError extends Error {
  constructor(
    message: string,
    readonly httpStatus = 400,
  ) {
    super(message);
    this.name = 'CasError';
  }
}

/**
 * Config from the environment Supabase injects into every function.
 *
 * Called only at request time, never at module load, so importing this file
 * from a test does not require a Deno global to exist.
 */
export function envConfig(): SbConfig {
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  return {
    supabaseUrl: env?.get('SUPABASE_URL') ?? '',
    supabaseServiceRoleKey: env?.get('SUPABASE_SERVICE_ROLE_KEY') ?? null,
  };
}

function serviceHeaders(cfg: SbConfig): Record<string, string> {
  const key = cfg.supabaseServiceRoleKey;
  if (!key) throw new CasError('Portfolio import is not configured on this server.', 503);
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

export async function sbSelect<T>(cfg: SbConfig, path: string): Promise<T[]> {
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, { headers: serviceHeaders(cfg) });
  if (!r.ok) {
    throw new CasError(`Could not read from the database (${r.status}).`, 502);
  }
  return (await r.json()) as T[];
}

/**
 * Rows carry client-generated ids so children can be built before anything is
 * sent — one round trip per table instead of one per row, and no dependence on
 * PostgREST returning inserted rows in the order they were given.
 */
export async function sbInsert(
  cfg: SbConfig,
  table: string,
  rows: unknown[],
  /**
   * Overrides for this call — chiefly `Prefer` for an upsert
   * (`resolution=merge-duplicates` alongside `?on_conflict=` in the path), which
   * is what lets the NAV refresh run twice in a day without failing.
   */
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  if (!rows.length) return;
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...serviceHeaders(cfg), Prefer: 'return=minimal', ...extraHeaders },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new CasError(`Could not save the statement (${table}: ${body.slice(0, 200)}).`, 502);
  }
}

/** `path` carries the filter, e.g. `cas_requests?id=eq.<uuid>`. */
export async function sbPatch(
  cfg: SbConfig,
  path: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...serviceHeaders(cfg), Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new CasError(`Could not update the request (${body.slice(0, 200)}).`, 502);
  }
}

export async function sbDelete(cfg: SbConfig, path: string): Promise<void> {
  await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: serviceHeaders(cfg),
  }).catch(() => undefined);
}
