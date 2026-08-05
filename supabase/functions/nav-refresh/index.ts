// Nightly NAV refresh — AMFI's published NAVs, and the category each scheme
// sits under.
//
// Moved off the BSE droplet, which exists for a whitelisted static IP that this
// job never needed. AMFI is a public, unauthenticated file.
//
// Two things land per run:
//   nav_daily        one row per ISIN per day, so a portfolio can be revalued
//   mf_asset_class   what each scheme HOLDS, from AMFI's category headings —
//                    the only source we have for whether a fund is
//                    equity-oriented, which fixes its capital-gains rate and
//                    holding period
//
// ## Auth
//
// verify_jwt is off because pg_cron reaches this through pg_net and has no user
// session. It is NOT public: the caller must present NAV_REFRESH_SECRET, the
// same shared-secret design the droplet route used, set as a function secret.
//
// A dedicated secret rather than the service-role key on purpose. Triggering a
// NAV refresh is the least privilege this job can run with, and it ends up
// written into a pg_cron command stored in the database — the service-role key
// has no business being there.
//
// A run is logged whether it succeeds or fails. A NAV feed that quietly stops
// updating is worse than one that is plainly absent: the client keeps seeing a
// figure that looks current, and nothing on the screen says otherwise.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { refreshNavs } from '../_shared/cas/nav.ts';
import { envConfig } from '../_shared/cas/db.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Nav-Secret',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/** Only a caller holding the shared trigger secret may run this. */
function authorised(req: Request): boolean {
  const expected = Deno.env.get('NAV_REFRESH_SECRET');
  // Unset means unreachable rather than open — a missing secret must never
  // degrade into "allow everyone".
  if (!expected) return false;
  return req.headers.get('x-nav-secret') === expected;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!authorised(req)) return json({ error: 'Unauthorized' }, 401);

  const result = await refreshNavs(envConfig());
  return json(result, result.ok ? 200 : 502);
});
