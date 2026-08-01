/**
 * Service-role Supabase access for the CAS modules, and the error type they
 * answer with.
 *
 * Extracted from import.ts once a second CAS router needed the same four calls.
 * There is no SDK here on purpose — the proxy talks to PostgREST over plain
 * fetch everywhere else too, and pulling in a client library for four verbs
 * would be the larger dependency.
 *
 * Everything here runs as the service role, which bypasses RLS. That is
 * deliberate and is the whole reason the CAS tables are readable by a client
 * but writable by nobody: a browser session cannot forge a consent record or
 * move a request's status, because it cannot write these tables at all.
 */
import type { ProxyConfig } from '../config.js';

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

function serviceHeaders(cfg: ProxyConfig): Record<string, string> {
  const key = cfg.supabaseServiceRoleKey;
  if (!key) throw new CasError('Portfolio import is not configured on this server.', 503);
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

export async function sbSelect<T>(cfg: ProxyConfig, path: string): Promise<T[]> {
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
export async function sbInsert(cfg: ProxyConfig, table: string, rows: unknown[]): Promise<void> {
  if (!rows.length) return;
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...serviceHeaders(cfg), Prefer: 'return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new CasError(`Could not save the statement (${table}: ${body.slice(0, 200)}).`, 502);
  }
}

/** `path` carries the filter, e.g. `cas_requests?id=eq.<uuid>`. */
export async function sbPatch(
  cfg: ProxyConfig,
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

export async function sbDelete(cfg: ProxyConfig, path: string): Promise<void> {
  await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: serviceHeaders(cfg),
  }).catch(() => undefined);
}
