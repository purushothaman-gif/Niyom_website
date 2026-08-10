// Trailing returns for the whole AMFI scheme universe, computed a slice at a
// time.
//
// NAV is cheap: AMFI publishes every scheme's price in one file, so nav-refresh
// prices all ~5,000 cached schemes nightly for free. Returns are not — they need
// the full NAV *history* per scheme, which mfapi.in serves one scheme per HTTP
// call. Five thousand calls do not fit in one edge-function invocation, and
// hammering a free public API that way would be rude besides.
//
// So this runs as a queue rather than a sweep. Each invocation claims the
// stalest BATCH schemes, computes their returns, and stamps returns_synced_at.
// Because that column orders the queue (NULLS FIRST), the job walks the whole
// universe once and then keeps cycling it oldest-first, with no cursor to store
// and nothing to reset if an invocation dies halfway.
//
// The same computeAll the curated `mutual_funds` feed uses, deliberately: a
// scheme that appears in both must not show one 3Y number on the research page
// and a different one on the fund card. One implementation, one answer.
//
// ## Auth
//
// verify_jwt is off because pg_cron reaches this through pg_net with no user
// session; the caller must present NAV_REFRESH_SECRET. It shares that secret
// with nav-refresh rather than minting another: both are the same privilege —
// "refresh public market data" — and a second secret would be a second thing to
// rotate for no gain in isolation.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { computeAll, parseDate, isoDate, type NavPoint } from '../_shared/mfReturns.ts';

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

/**
 * Schemes per invocation.
 *
 * Sized against the edge-function wall clock, not throughput: at ~1.5s per
 * mfapi call with CONCURRENCY in flight, 300 schemes lands well inside the
 * limit with room for a slow tail. Raising it risks the invocation being killed
 * mid-batch — which loses only the unstamped remainder, but wastes the calls.
 */
const BATCH = 300;

/** Parallel mfapi.in calls. Enough to be quick, low enough to stay a good citizen. */
const CONCURRENCY = 6;

/**
 * A scheme computed within this many hours is left alone.
 *
 * Under a day, because AMFI publishes a fresh NAV each evening and the returns
 * should follow within the same day — but comfortably over the few hours a full
 * pass takes, so a pass never laps itself and starts re-doing its own work.
 */
const FRESH_HOURS = 18;

/**
 * How stale a scheme's NAV may be before it stops counting as investable.
 *
 * Wide enough to ride out a long weekend plus a slow-reporting debt or
 * international fund, narrow enough that a wound-up scheme frozen months ago
 * cannot pass. See the queue filter for why this is the liveness test.
 */
const MAX_NAV_AGE_DAYS = 15;

interface SchemeDetail {
  meta?: { scheme_name?: string; fund_house?: string | null };
  data?: NavPoint[];
}

interface QueueRow {
  scheme_code: string;
}

function createSupabase() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing Supabase environment variables');
  return createClient(url, key);
}

async function getJson<T>(url: string, timeoutMs = 20000): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Run tasks with a bounded number in flight. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

interface Update {
  scheme_code: string;
  return_6m: number | null;
  return_1y: number | null;
  return_3y: number | null;
  return_5y: number | null;
  return_si: number | null;
  launch_date: string | null;
  returns_synced_at: string;
  returns_error: string | null;
}

async function backfill(): Promise<Response> {
  const supabase = createSupabase();
  const startedAt = Date.now();

  /*
   * The queue: never-computed first (NULLS FIRST), then stalest.
   *
   * returns_error is excluded so a scheme mfapi has no history for cannot wedge
   * the head of the queue and starve everything behind it. Those are retried by
   * clearing the column, not by this job — see the note on that below.
   *
   * The FRESH_HOURS floor is what lets the cron run often without being
   * wasteful. Trailing returns move once a day, when the NAV does; a queue
   * ordered only by staleness would happily re-fetch the same scheme every
   * cycle simply because it is the oldest thing left. With the floor, a run
   * finds work only while the universe is genuinely behind — so the first pass
   * chews through ~5,000 schemes in a few hours, and every run after that
   * returns "queue empty" in one query and costs nothing.
   */
  const freshCutoff = new Date(Date.now() - FRESH_HOURS * 3600 * 1000).toISOString();
  const navFloor = new Date(Date.now() - MAX_NAV_AGE_DAYS * 86400 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data: queue, error: queueErr } = await supabase
    .from('mf_scheme_cache')
    .select('scheme_code')
    .is('returns_error', null)
    /*
     * Live schemes only. This is a correctness guard, not an optimisation.
     *
     * computeAll anchors every window to the NEWEST NAV point it is given, not
     * to today. Feed it a scheme that stopped trading and "1Y return" silently
     * becomes the year ending whenever that scheme died, presented on screen as
     * current. The error is systematically flattering, too: a fund that closed
     * after a good run keeps that run forever, while live funds still have to
     * survive the next drawdown. Ranked by return, the dead float to the top of
     * "Top performers" — past performance shown to a client for something no
     * one can buy.
     *
     * Freshness of nav_date is the test, NOT presence of current_nav. AMFI
     * leaves wound-up schemes in the daily file with their final NAV frozen:
     * Franklin's wound-up short-term plan still ships today carrying a
     * 02-May-2025 price, and a unit consolidation during its wind-up left it
     * reporting a 192% "1Y" on a short-term DEBT fund. It has a current_nav; it
     * has not been investable in over a year.
     *
     * MAX_NAV_AGE_DAYS is generous on purpose — some debt and international
     * schemes legitimately report a few days late, and a fund must never be
     * dropped from research for a slow week.
     */
    .not('current_nav', 'is', null)
    .gte('nav_date', navFloor)
    .or(`returns_synced_at.is.null,returns_synced_at.lt.${freshCutoff}`)
    .order('returns_synced_at', { ascending: true, nullsFirst: true })
    .limit(BATCH);
  if (queueErr) throw queueErr;

  const codes = ((queue ?? []) as QueueRow[]).map((r) => r.scheme_code);
  if (!codes.length) return json({ success: true, processed: 0, note: 'queue empty' });

  const now = new Date().toISOString();

  const updates = await pooled(codes, CONCURRENCY, async (code): Promise<Update> => {
    const blank: Update = {
      scheme_code: code,
      return_6m: null,
      return_1y: null,
      return_3y: null,
      return_5y: null,
      return_si: null,
      launch_date: null,
      returns_synced_at: now,
      returns_error: null,
    };

    const detail = await getJson<SchemeDetail>(`https://api.mfapi.in/mf/${code}`);

    /*
     * A scheme with no history is marked and dropped from the queue.
     *
     * ~2,500 of the cached codes are wound-up schemes that mfapi.in still lists
     * but AMFI no longer prices. Retrying them every cycle would spend half the
     * budget re-learning the same nothing, so the answer is recorded. It is
     * plain text rather than a boolean because "why" matters when the cause is
     * actually a transient outage: clearing returns_error re-queues the lot.
     */
    if (!detail?.data?.length) return { ...blank, returns_error: 'no history from mfapi.in' };

    const m = computeAll(detail.data);
    if (!m) return { ...blank, returns_error: 'history present but no usable NAV' };

    const oldest = detail.data[detail.data.length - 1];

    return {
      ...blank,
      return_6m: m.return_6m,
      return_1y: m.return_1y,
      return_3y: m.return_3y,
      return_5y: m.return_5y,
      return_si: m.return_si,
      launch_date: oldest ? isoDate(parseDate(oldest.date)) : null,
    };
  });

  /*
   * current_nav and nav_date are deliberately NOT written here.
   *
   * nav-refresh owns those, from AMFI — the registrar's own file, published for
   * every scheme on the same day. mfapi.in mirrors it with a lag, so writing
   * NAV from this job too would let a stale mirror overwrite the authoritative
   * price whenever the two jobs interleave. Each column has exactly one writer.
   */
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const { error } = await supabase
      .from('mf_scheme_cache')
      .upsert(updates.slice(i, i + CHUNK), { onConflict: 'scheme_code' });
    if (error) throw error;
    written += Math.min(CHUNK, updates.length - i);
  }

  const failed = updates.filter((u) => u.returns_error !== null).length;
  return json({
    success: true,
    processed: written,
    computed: written - failed,
    noHistory: failed,
    elapsedMs: Date.now() - startedAt,
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const secret = Deno.env.get('NAV_REFRESH_SECRET');
  if (!secret) return json({ success: false, error: 'NAV_REFRESH_SECRET is not set' }, 500);

  const presented = req.headers.get('X-Nav-Secret') ?? '';
  if (presented !== secret) return json({ success: false, error: 'Unauthorized' }, 401);

  try {
    return await backfill();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[mf-returns-backfill] failed:', message);
    return json({ success: false, error: message }, 500);
  }
});
