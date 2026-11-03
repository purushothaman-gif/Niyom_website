// Admin manual upload of a registrar mailback feed (CAMS WBR9 holdings or
// WBR49 SIPs). An admin uploads the encrypted ZIP from the CRM "MF Feeds" page;
// this resolves the caller, requires an active admin, and hands the ZIP to the
// shared runImport pipeline, which decrypts, detects the report, upserts and
// matches. The automated daily path is mf-rta-ingest; this stays for ad-hoc
// re-imports and corrections, so it does NOT dedupe (a re-upload re-applies).
//
// verify_jwt is ON: the feed carries the whole book's PANs and contact details,
// so only an admin may push one. Writes use the service role.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { base64ToBytes, RtaError, runImport } from '../_shared/rta/pipeline.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function service() {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
}

/** Resolve the caller from their JWT and require an active admin employee. */
async function requireAdmin(req: Request, sb: ReturnType<typeof service>): Promise<string> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) throw new RtaError('Sign in again.', 401);
  const { data: userData, error } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  const uid = userData?.user?.id;
  if (error || !uid) throw new RtaError('Your session has expired. Sign in again.', 401);
  const { data: emp } = await sb
    .from('nw_employees').select('id, role').eq('auth_user_id', uid).eq('status', 'active').maybeSingle();
  const role = (emp as { role?: string } | null)?.role;
  if (!emp || !(role === 'admin' || role === 'super_admin')) {
    throw new RtaError('Only an admin can import registrar feeds.', 403);
  }
  return uid;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const sb = service();
  try {
    const uid = await requireAdmin(req, sb);

    const body = await req.json().catch(() => null) as
      | { fileName?: string; dataBase64?: string; registrar?: string }
      | null;
    if (!body?.dataBase64) throw new RtaError('No file was uploaded.', 400);
    const registrar = (body.registrar ?? 'CAMS').toUpperCase() === 'KFINTECH' ? 'KFINTECH' : 'CAMS';

    const password = registrar === 'KFINTECH'
      ? Deno.env.get('RTA_KFINTECH_PASSWORD')
      : Deno.env.get('RTA_CAMS_PASSWORD');
    if (!password) throw new RtaError(`The ${registrar} mailback password is not configured on the server.`, 500);

    const result = await runImport(sb, {
      zipBytes: base64ToBytes(body.dataBase64),
      password,
      registrar,
      sourceFile: body.fileName ?? null,
      source: 'manual',
      importedBy: uid,
      dedupe: false,
    });
    return json(result);
  } catch (e) {
    const status = e instanceof RtaError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Import failed.';
    return json({ ok: false, error: message }, status);
  }
});
