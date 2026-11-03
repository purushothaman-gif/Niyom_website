// mf-market-data — scheduled jobs for the central MF market database.
//
//   { action: "master" }  AMFI scheme-data file -> mf_asset_class master columns
//   { action: "health" }  check the pipeline; email MF_ALERT_EMAILS on problems
//
// NAV jobs stay where they were: nav-refresh (nightly NAVAll) and nav-backfill
// (history). Market data only — client holdings, registrar feeds and Wylth SSO
// are untouched.
//
// Auth: verify_jwt off so pg_cron can call it; the NAV_REFRESH_SECRET header is
// required, the same "refresh public market data" privilege as nav-refresh.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { envConfig } from '../_shared/cas/db.ts';
import { refreshSchemeMaster } from '../_shared/cas/schemeMaster.ts';
import { runMarketHealth } from '../_shared/cas/marketHealth.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function authorised(req: Request): boolean {
  const expected = Deno.env.get('NAV_REFRESH_SECRET');
  if (!expected) return false;
  return req.headers.get('x-nav-secret') === expected;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!authorised(req)) return json({ error: 'Unauthorized' }, 401);
  let action = '';
  try {
    action = String((await req.json())?.action ?? '');
  } catch {
    /* no body */
  }
  if (action === 'master') {
    const r = await refreshSchemeMaster(envConfig());
    return json(r, r.ok ? 200 : 502);
  }
  if (action === 'health') return json(await runMarketHealth(envConfig()));
  return json({ error: 'Unknown action — use "master" or "health"' }, 400);
});
