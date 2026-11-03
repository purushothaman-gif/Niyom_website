// Automated ingest of a registrar mailback feed, pushed by the Google Apps
// Script that watches the distributor mailbox (see scripts/mf-rta-gmail-sync.gs
// and docs/mf-rta-feeds-plan.md). Runs daily, with no human in the loop, so it
// authenticates NOT with a user JWT (the script has none) but with a shared
// secret in the X-Ingest-Secret header, compared in constant time against the
// RTA_INGEST_SECRET server secret.
//
// verify_jwt is OFF (the caller is the script, not a signed-in user); the shared
// secret is the whole of the auth. It dedupes by content hash, so re-sending the
// same attachment — the script retrying, or two triggers overlapping — is a
// no-op rather than a double import.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { base64ToBytes, RtaError, runImport } from '../_shared/rta/pipeline.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Ingest-Secret',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Length-safe constant-time compare so the secret can't be timed out byte by byte. */
function secretsMatch(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const expected = Deno.env.get('RTA_INGEST_SECRET') ?? '';
  const provided = req.headers.get('X-Ingest-Secret') ?? '';
  if (!expected || !secretsMatch(provided, expected)) {
    return json({ ok: false, error: 'Unauthorized.' }, 401);
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  try {
    const body = await req.json().catch(() => null) as
      | { fileName?: string; dataBase64?: string; registrar?: string; messageId?: string }
      | null;
    if (!body?.dataBase64) throw new RtaError('No file was supplied.', 400);
    const registrar = (body.registrar ?? 'CAMS').toUpperCase() === 'KFINTECH' ? 'KFINTECH' : 'CAMS';

    // Candidate passwords to try, in order. KFintech can use a different
    // password per report (SIP subscription vs AUM report), so fall back to the
    // CAMS password too; deduped, blanks dropped.
    const cams = Deno.env.get('RTA_CAMS_PASSWORD') ?? '';
    const kf = Deno.env.get('RTA_KFINTECH_PASSWORD') ?? '';
    const kf2 = Deno.env.get('RTA_KFINTECH_PASSWORD_2') ?? '';
    const passwords = (registrar === 'KFINTECH' ? [kf, kf2, cams] : [cams])
      .filter((p, i, a) => p && a.indexOf(p) === i);
    if (!passwords.length) throw new RtaError(`The ${registrar} mailback password is not configured on the server.`, 500);

    const result = await runImport(sb, {
      zipBytes: base64ToBytes(body.dataBase64),
      passwords,
      registrar,
      sourceFile: body.fileName ?? null,
      messageId: body.messageId ?? null,
      source: 'auto',
      importedBy: null,
      dedupe: true,
    });
    return json(result);
  } catch (e) {
    const status = e instanceof RtaError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Ingest failed.';
    return json({ ok: false, error: message }, status);
  }
});
