// NAV on a date in the past — in practice, 31-Jan-2018.
//
// Equity units bought before 01-Feb-2018 are grandfathered under s.55(2)(ac):
// the gain that accrued up to that date is exempt, and the cost of acquisition
// is rebuilt around that day's NAV. Without it a unit bought in 2005 is taxed on
// twenty years of growth Parliament exempted.
//
// Separate from nav-refresh on purpose. AMFI serves history from a different
// endpoint in a DIFFERENT COLUMN ORDER (name second, plus repurchase and sale
// prices), so it has its own parser — feeding one file to the other's reader
// does not fail loudly, it reads the wrong columns.
//
// Not scheduled: a past NAV does not change. One run settles a date permanently
// for every client, including ones who have not signed up yet.
//
// Auth matches nav-refresh: verify_jwt off so pg_cron can reach it, and a
// NAV_REFRESH_SECRET header required so nobody else can.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { backfillNavOn, GRANDFATHER_DATE } from '../_shared/cas/navHistory.ts';
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

function authorised(req: Request): boolean {
  const expected = Deno.env.get('NAV_REFRESH_SECRET');
  if (!expected) return false;
  return req.headers.get('x-nav-secret') === expected;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!authorised(req)) return json({ error: 'Unauthorized' }, 401);

  // Defaults to the grandfathering date precisely so the common case needs no
  // body at all.
  let date = GRANDFATHER_DATE;
  try {
    const body = await req.json();
    if (typeof body?.date === 'string') date = body.date;
  } catch {
    // no body — take the default
  }

  const result = await backfillNavOn(envConfig(), date);
  return json(result, result.ok ? 200 : 502);
});
