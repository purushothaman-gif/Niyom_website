// Import a registrar mailback feed (Phase 1: CAMS WBR9 / CRMS) into the
// mf_rta_* tables. An admin uploads the encrypted ZIP from the CRM "MF Feeds"
// page; this function opens it with the mailback password (a server secret the
// admin never handles), parses the DBF, and upserts folios + holdings, then
// matches each folio to a client by PAN. See docs/mf-rta-feeds-plan.md.
//
// ## Authorisation
//
// verify_jwt is ON. The caller is resolved from their own token and must be an
// active admin/super_admin employee — the feed carries the whole book's PANs,
// bank and contact details, so it is never exposed to an RM or a client here.
// Writes use the service role (RLS-bypassing); staff read the tables directly
// under the RLS added in the mf_rta_feeds migration.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { parseDbf } from '../_shared/rta/dbf.ts';
import { parseWbr9 } from '../_shared/rta/wbr9.ts';
import { unzipSingleDbf, WinzipError } from '../_shared/rta/winzip.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** A base64 body inflates by a third; the ZIPs are a few KB, cap well above. */
const MAX_ZIP_BYTES = 8 * 1024 * 1024;

class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function service() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}

/** Resolve the caller from their JWT and require an active admin employee. */
async function requireAdmin(req: Request): Promise<string> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) throw new ApiError('Sign in again.', 401);
  const sb = service();
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const { data: userData, error } = await sb.auth.getUser(token);
  const uid = userData?.user?.id;
  if (error || !uid) throw new ApiError('Your session has expired. Sign in again.', 401);

  const { data: emp } = await sb
    .from('nw_employees')
    .select('id, role')
    .eq('auth_user_id', uid)
    .eq('status', 'active')
    .maybeSingle();
  const role = (emp as { role?: string } | null)?.role;
  if (!emp || !(role === 'admin' || role === 'super_admin')) {
    throw new ApiError('Only an admin can import registrar feeds.', 403);
  }
  return uid;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Open the WinZip-AES ZIP with the password and return its DBF member. */
async function unzipDbf(data: Uint8Array, password: string): Promise<{ name: string; bytes: Uint8Array }> {
  try {
    return await unzipSingleDbf(data, password);
  } catch (e) {
    if (e instanceof WinzipError) {
      if (e.message === 'WRONG_PASSWORD' || e.message === 'AUTH_FAILED') {
        throw new ApiError('Could not open the ZIP — the stored mailback password may be wrong.', 422);
      }
      throw new ApiError(e.message, 422);
    }
    throw e;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let registrar = 'CAMS';
  let sourceFile: string | null = null;
  let fileHash: string | null = null;
  const started = Date.now();
  let uid: string | null = null;

  try {
    uid = await requireAdmin(req);

    const body = await req.json().catch(() => null) as
      | { fileName?: string; dataBase64?: string; registrar?: string }
      | null;
    if (!body?.dataBase64) throw new ApiError('No file was uploaded.', 400);
    registrar = (body.registrar ?? 'CAMS').toUpperCase() === 'KFINTECH' ? 'KFINTECH' : 'CAMS';
    sourceFile = body.fileName ?? null;

    const password = registrar === 'KFINTECH'
      ? Deno.env.get('RTA_KFINTECH_PASSWORD')
      : Deno.env.get('RTA_CAMS_PASSWORD');
    if (!password) {
      throw new ApiError(`The ${registrar} mailback password is not configured on the server.`, 500);
    }

    const zipBytes = base64ToBytes(body.dataBase64);
    if (zipBytes.length === 0) throw new ApiError('The uploaded file is empty.', 400);
    if (zipBytes.length > MAX_ZIP_BYTES) throw new ApiError('That file is too large.', 413);
    fileHash = await sha256Hex(zipBytes);

    const { name, bytes } = await unzipDbf(zipBytes, password);
    if (!sourceFile) sourceFile = name;

    const parsed = parseWbr9(parseDbf(bytes), registrar);
    const nowIso = new Date().toISOString();
    const sb = service();

    // Folios: one master row per folio. client_id / matched_at / first_seen_at
    // are left out of the payload so a re-import never clobbers an existing
    // match; last_seen_at is refreshed on every upsert.
    const folioList = [...parsed.folios.values()].map((f) => ({
      registrar: f.registrar,
      folio: f.folio,
      amc_code: f.amc_code,
      holder_name: f.holder_name,
      pan: f.pan,
      joint_names: f.joint_names,
      joint_pans: f.joint_pans,
      tax_status: f.tax_status,
      arn: f.arn,
      sub_broker: f.sub_broker,
      email: f.email,
      mobile: f.mobile,
      demat: f.demat,
      folio_open_date: f.folio_open_date,
      last_seen_at: nowIso,
    }));

    const folioIdByFolio = new Map<string, string>();
    const clientByFolio = new Map<string, string | null>();
    if (folioList.length) {
      const { data: folioRows, error: fErr } = await sb
        .from('mf_rta_folios')
        .upsert(folioList, { onConflict: 'registrar,folio' })
        .select('id, folio, client_id');
      if (fErr) throw new ApiError(`Could not save folios: ${fErr.message}`, 500);
      for (const row of (folioRows ?? []) as { id: string; folio: string; client_id: string | null }[]) {
        folioIdByFolio.set(row.folio, row.id);
        clientByFolio.set(row.folio, row.client_id);
      }
    }

    // Holdings: one row per scheme-folio, keyed so re-imports overwrite.
    const holdingList = parsed.holdings
      .filter((h) => folioIdByFolio.has(h.folio))
      .map((h) => ({
        folio_id: folioIdByFolio.get(h.folio)!,
        registrar: h.registrar,
        folio: h.folio,
        scheme_code: h.scheme_code,
        scheme_name: h.scheme_name,
        amc_code: h.amc_code,
        units: h.units,
        rta_value: h.rta_value,
        snapshot_date: h.snapshot_date,
        updated_at: nowIso,
      }));
    if (holdingList.length) {
      const { error: hErr } = await sb
        .from('mf_rta_holdings')
        .upsert(holdingList, { onConflict: 'registrar,folio,scheme_code' });
      if (hErr) throw new ApiError(`Could not save holdings: ${hErr.message}`, 500);
    }

    // Match folios to clients by first-holder PAN. Runs for every folio in the
    // file so a client onboarded after an earlier import gets linked too.
    const pans = [...new Set([...parsed.folios.values()].map((f) => f.pan).filter((p): p is string => !!p))];
    const clientByPan = new Map<string, string>();
    if (pans.length) {
      const { data: clients } = await sb.from('nw_clients').select('id, pan').in('pan', pans);
      for (const c of (clients ?? []) as { id: string; pan: string | null }[]) {
        if (c.pan) clientByPan.set(c.pan.toUpperCase(), c.id);
      }
    }

    let matched = 0;
    let unmatched = 0;
    for (const f of parsed.folios.values()) {
      const resolved = f.pan ? clientByPan.get(f.pan) : undefined;
      const existing = clientByFolio.get(f.folio) ?? null;
      if (resolved && resolved !== existing) {
        const { error: uErr } = await sb
          .from('mf_rta_folios')
          .update({ client_id: resolved, matched_at: nowIso })
          .eq('registrar', f.registrar)
          .eq('folio', f.folio);
        if (!uErr) matched++;
      }
      if (!(resolved ?? existing)) unmatched++;
    }

    const summary = {
      ok: true,
      registrar,
      report: 'WBR9',
      sourceFile,
      snapshotDate: parsed.snapshotDate,
      rowsTotal: parsed.holdings.length,
      foliosUpserted: folioList.length,
      holdingsUpserted: holdingList.length,
      matched,
      unmatched,
      durationMs: Date.now() - started,
    };

    await sb.from('mf_rta_import_log').insert({
      registrar,
      report: 'WBR9',
      source_file: sourceFile,
      file_hash: fileHash,
      snapshot_date: parsed.snapshotDate,
      rows_total: summary.rowsTotal,
      folios_upserted: summary.foliosUpserted,
      holdings_upserted: summary.holdingsUpserted,
      matched,
      unmatched,
      status: 'ok',
      duration_ms: summary.durationMs,
      imported_by: uid,
    });

    return json(summary);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Import failed.';
    // Log the failure (best-effort) so a bad feed is visible in the CRM.
    if (uid) {
      try {
        await service().from('mf_rta_import_log').insert({
          registrar,
          report: 'WBR9',
          source_file: sourceFile,
          file_hash: fileHash,
          status: 'error',
          error: message.slice(0, 500),
          duration_ms: Date.now() - started,
          imported_by: uid,
        });
      } catch { /* ignore logging failures */ }
    }
    return json({ ok: false, error: message }, status);
  }
});
