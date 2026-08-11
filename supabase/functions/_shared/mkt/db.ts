// The two PostgREST verbs the marketing pipeline needs that ../cas/db.ts does
// not already provide: calling an RPC, and inserting a row and getting it back.
//
// Same shape as its neighbour on purpose — plain fetch, config as a parameter,
// no SDK — so these modules keep loading under vitest as readily as under Deno.
// sbSelect and sbPatch are imported from there rather than reimplemented; only
// what is genuinely missing lives here.

import type { SbConfig } from '../cas/db.ts';

function headers(cfg: SbConfig): Record<string, string> {
  const key = cfg.supabaseServiceRoleKey;
  if (!key) throw new Error('The automated content pipeline is not configured on this server.');
  return {
    'Content-Type': 'application/json',
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
}

/**
 * Call a SECURITY DEFINER function.
 *
 * A function that RETURNS void answers 204 with an empty body, so parsing the
 * response unconditionally throws "Unexpected end of JSON input" — on a call
 * that actually SUCCEEDED. That failure mode is nastier than it sounds: the
 * write lands, the caller sees an exception, and the slot gets recorded as
 * failed despite having worked.
 */
export async function sbRpc<T>(cfg: SbConfig, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify(args),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`${fn} failed (${r.status}): ${body.slice(0, 300)}`);
  }
  const text = await r.text();
  if (!text.trim()) return undefined as T;
  return JSON.parse(text) as T;
}

/**
 * Insert one row and return it.
 *
 * `Prefer: return=representation` rather than the neighbouring sbInsert's
 * `return=minimal`, because the caller needs the generated id and content_no —
 * mkt_content.content_no comes from a sequence default, so it cannot be known
 * before the insert.
 */
export async function sbInsertOne<T>(cfg: SbConfig, table: string, row: unknown): Promise<T> {
  const r = await fetch(`${cfg.supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...headers(cfg), Prefer: 'return=representation' },
    body: JSON.stringify([row]),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Insert into ${table} failed (${r.status}): ${body.slice(0, 300)}`);
  }
  const rows = (await r.json()) as T[];
  if (!rows.length) throw new Error(`Insert into ${table} returned no row`);
  return rows[0];
}
