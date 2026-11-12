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
      | {
          fileName?: string;
          dataBase64?: string;
          registrar?: string;
          messageId?: string;
          // Queue ops: KFintech delivers a download LINK, and its WAF blocks every
          // datacenter IP (Apps Script, the droplet, Supabase) with "Request
          // Rejected". So the script ENQUEUEs the decoded links here, and a
          // residential-IP agent (the user's Mac) lists them, downloads the ZIP
          // where the WAF allows it, and posts the bytes back on the normal path.
          enqueue?: {
            messageId: string;
            directUrl: string;
            trackerUrl?: string;
            reportHint?: string;
            registrar?: string;
            subject?: string;
          }[];
          listPending?: boolean;
          markError?: { messageId: string; error?: string };
        }
      | null;

    // The queue table is new and not in the generated Database types yet; it is
    // only ever touched here, so go through a loosely typed handle rather than
    // regenerating types across the whole app.
    const queue = () => (sb as unknown as { from: (t: string) => any }).from('mf_rta_pending_downloads');

    // The Mac agent asks for links waiting to be fetched.
    if (body?.listPending) {
      const { data } = await queue()
        .select('message_id, registrar, report_hint, subject, direct_url, tracker_url, attempts')
        .eq('status', 'pending')
        .lt('attempts', 8)
        .order('created_at', { ascending: true })
        .limit(50);
      return json({ ok: true, pending: data ?? [] });
    }

    // The Apps Script enqueues the KFintech links it decoded but cannot fetch.
    if (body?.enqueue?.length) {
      const rows = body.enqueue
        .filter((e) => e?.messageId && e?.directUrl)
        .map((e) => ({
          message_id: e.messageId,
          direct_url: e.directUrl,
          tracker_url: e.trackerUrl ?? null,
          report_hint: e.reportHint ?? null,
          subject: e.subject ?? null,
          registrar: (e.registrar ?? 'KFINTECH').toUpperCase(),
        }));
      if (rows.length) {
        await queue().upsert(rows, { onConflict: 'message_id', ignoreDuplicates: true });
      }
      return json({ ok: true, enqueued: rows.length });
    }

    // The Mac agent reports a download it could not complete, so we can retry /
    // surface it rather than lose it.
    if (body?.markError?.messageId) {
      const { data: row } = await queue()
        .select('attempts')
        .eq('message_id', body.markError.messageId)
        .maybeSingle();
      await queue()
        .update({ attempts: ((row?.attempts as number) ?? 0) + 1, error: body.markError.error ?? null })
        .eq('message_id', body.markError.messageId);
      return json({ ok: true });
    }

    if (!body?.dataBase64) throw new RtaError('No file was supplied.', 400);
    const registrar = (body.registrar ?? 'CAMS').toUpperCase() === 'KFINTECH' ? 'KFINTECH' : 'CAMS';

    // Candidate passwords to try, in order. KFintech can use a different
    // password per report (SIP subscription vs AUM report), so fall back to the
    // CAMS password too; deduped, blanks dropped.
    const cams = Deno.env.get('RTA_CAMS_PASSWORD') ?? '';
    // Optional second CAMS password: a report requested via another channel
    // (e.g. Wylth) can be encrypted with that requester's own password.
    const cams2 = Deno.env.get('RTA_CAMS_PASSWORD_2') ?? '';
    const kf = Deno.env.get('RTA_KFINTECH_PASSWORD') ?? '';
    const kf2 = Deno.env.get('RTA_KFINTECH_PASSWORD_2') ?? '';
    const passwords = (registrar === 'KFINTECH' ? [kf, kf2, cams, cams2] : [cams, cams2])
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
    // When the Mac agent fed in a queued link's bytes, close the queue row.
    if (body.messageId) {
      await queue()
        .update({ status: 'done', fetched_at: new Date().toISOString(), error: null })
        .eq('message_id', body.messageId);
    }
    return json(result);
  } catch (e) {
    const status = e instanceof RtaError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Ingest failed.';
    return json({ ok: false, error: message }, status);
  }
});
