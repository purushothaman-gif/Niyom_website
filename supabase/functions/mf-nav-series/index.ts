// mf-nav-series — loads each scheme's full NAV history from AMFI into
// `mf_nav_series`, a window at a time.
//
// AMFI's per-scheme history feed is too slow to call while a client waits, so
// this runs in the background from pg_cron (mf_nav_series_tick, every minute,
// a no-op when the queue is empty). Each invocation claims two schemes and
// fetches one ~2.5-year window for each, walking BACKWARDS from today until a
// window comes back empty — that is the scheme's launch. Progress is stored
// per window, so an invocation that dies loses at most the window in flight.
//
//   { action: "load", max_priority? }  work the queue (the cron call)
//   { action: "seed" }                 queue every scheme the site can show
//   { action: "append" }               add the days nav_daily has that we don't
//   { action: "status" }               queue counts
//
// Auth matches nav-refresh: verify_jwt off so pg_cron can reach it, and the
// NAV_REFRESH_SECRET header required so nobody else can.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  HISTORY_FLOOR,
  dayToIso,
  fetchAmfiWindow,
  isoToDay,
  todayIst,
  windowEndingAt,
} from '../_shared/amfiNavSeries.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Nav-Secret',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Two at a time: AMFI rate-limits at about three simultaneous requests. */
const PARALLEL = 2;
/** Keep starting new rounds until this much of the invocation is spent. */
const ROUND_BUDGET_MS = 30_000;

interface Claim {
  amfi_code: string;
  status: 'pending' | 'tail';
  cursor_to: string | null;
  last_date: string | null;
  points: number;
}

interface Outcome {
  code: string;
  result: 'window' | 'done' | 'empty' | 'retry';
  rows?: number;
  note?: string;
}

function createSupabase() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing Supabase environment variables');
  return createClient(url, key);
}

type Db = ReturnType<typeof createSupabase>;

async function merge(db: Db, code: string, d: number[], n: number[], cursorTo: string | null, done: boolean) {
  const { error } = await db.rpc('mf_nav_series_merge', {
    // p_cursor_to is a nullable date; the generated type cannot say so.
    p_code: code, p_d: d, p_n: n, p_cursor_to: cursorTo as unknown as string, p_done: done,
  });
  if (error) throw new Error(`merge failed: ${error.message}`);
}

/** One window for one scheme. Never throws: a failure is left for the retry. */
async function step(db: Db, c: Claim, today: string): Promise<Outcome> {
  const code = c.amfi_code;
  try {
    // A loaded series that fell behind: fetch only the missing recent stretch.
    if (c.status === 'tail' && c.last_date) {
      const from = dayToIso(Math.max(isoToDay(c.last_date) + 1, isoToDay(today) - 899));
      const got = await fetchAmfiWindow(code, from, today);
      if (got.status === 'transient') throw new Error(got.reason);
      const s = got.status === 'ok' ? got.series : { d: [], n: [] };
      await merge(db, code, s.d, s.n, null, true);
      return { code, result: 'done', rows: s.d.length, note: 'tail' };
    }

    const win = windowEndingAt(c.cursor_to, today);
    const got = await fetchAmfiWindow(code, win.from, win.to);
    if (got.status === 'transient') throw new Error(got.reason);

    const next = dayToIso(isoToDay(win.from) - 1);
    const beforeFloor = next < HISTORY_FLOOR;

    if (got.status === 'empty') {
      // Nothing in this window. With history already in hand, that is the
      // launch date reached. With none yet, the scheme may simply be dormant —
      // a matured fund a client once held — so keep walking back to the floor.
      const done = c.points > 0 || beforeFloor;
      await merge(db, code, [], [], done ? null : next, done);
      return { code, result: done ? (c.points > 0 ? 'done' : 'empty') : 'window', rows: 0 };
    }

    await merge(db, code, got.series.d, got.series.n, beforeFloor ? null : next, beforeFloor);
    return { code, result: beforeFloor ? 'done' : 'window', rows: got.series.d.length };
  } catch (err) {
    const note = (err as Error)?.message ?? 'unknown';
    await db.rpc('mf_nav_series_fail', { p_code: code, p_error: note }).then(() => undefined, () => undefined);
    return { code, result: 'retry', note };
  }
}

async function load(db: Db, maxPriority: number): Promise<Response> {
  const started = Date.now();
  const today = todayIst();
  const outcomes: Outcome[] = [];
  let force = false;

  while (Date.now() - started < ROUND_BUDGET_MS) {
    const { data, error } = await db.rpc('mf_nav_series_claim', {
      p_limit: PARALLEL, p_max_priority: maxPriority, p_force: force,
    });
    if (error) throw new Error(`claim failed: ${error.message}`);
    const claims = (data ?? []) as Claim[];
    if (!claims.length) break;
    force = true; // later rounds are ours; an overlapping invocation still backs off
    outcomes.push(...(await Promise.all(claims.map((c) => step(db, c, today)))));
    // Rate-limited: stop for this minute rather than push on.
    if (outcomes.some((o) => o.result === 'retry' && /429/.test(o.note ?? ''))) break;
  }

  return json({ ok: true, windows: outcomes.length, elapsedMs: Date.now() - started, outcomes });
}

async function status(db: Db): Promise<Response> {
  const count = async (filter: (q: ReturnType<Db['from']>) => unknown) => {
    // deno-lint-ignore no-explicit-any
    const q: any = db.from('mf_nav_series').select('amfi_code', { count: 'exact', head: true });
    const { count: c } = await (filter(q) as Promise<{ count: number | null }>);
    return c ?? 0;
  };
  // deno-lint-ignore no-explicit-any
  const eq = (s: string) => (q: any) => q.eq('status', s);
  const [pending, loaded, tail, empty, stuck] = await Promise.all([
    count(eq('pending')), count(eq('loaded')), count(eq('tail')), count(eq('empty')),
    // deno-lint-ignore no-explicit-any
    count((q: any) => q.in('status', ['pending', 'tail']).gte('attempts', 8)),
  ]);
  return json({ ok: true, pending, loaded, tail, empty, gave_up: stuck });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const expected = Deno.env.get('NAV_REFRESH_SECRET');
  if (!expected || req.headers.get('x-nav-secret') !== expected) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : 'load';
    const db = createSupabase();

    if (action === 'seed') {
      const { data, error } = await db.rpc('mf_nav_series_seed');
      if (error) throw new Error(error.message);
      return json({ ok: true, queued: data });
    }
    if (action === 'append') {
      const { data, error } = await db.rpc('mf_nav_series_append');
      if (error) throw new Error(error.message);
      return json({ ok: true, appended: data });
    }
    if (action === 'status') return await status(db);

    const maxPriority = Number.isFinite(Number(body?.max_priority)) ? Number(body.max_priority) : 9;
    return await load(db, maxPriority);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[mf-nav-series] failed:', message);
    return json({ ok: false, error: message }, 500);
  }
});
