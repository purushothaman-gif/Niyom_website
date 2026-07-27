import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { computeAll, downsampleNav, parseDate, isoDate, type NavPoint } from "../_shared/mfReturns.ts";

/**
 * mf-detail
 * ---------
 * On-demand detail for a single AMFI scheme, powering the fund detail view on
 * the public MF Research page. Proxies mfapi.in/mf/{code} (never called from the
 * browser), computes the full metric spread and returns a chart-ready,
 * downsampled NAV history.
 *
 *   GET ?code=NNNN  →  { success, meta, metrics, navHistory, cached }
 *
 * Caching: the computed payload is stored in `mf_detail_cache` keyed by scheme
 * code. A fresh hit (< CACHE_TTL_MS) is served instantly without touching
 * mfapi.in — liquid funds carry ~4,500 daily NAV points, so an uncached fetch
 * is slow (~8s) and occasionally fails transiently. On a miss/stale entry we
 * re-fetch and refresh the cache; if mfapi is unreachable we fall back to the
 * stale cached copy rather than erroring.
 *
 * Public (verify_jwt = false): the page is unauthenticated.
 */

// NAV publishes at most once per business day, so a few hours of staleness is
// invisible to users while cutting cold mfapi fetches to a handful per day/fund.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface SchemeDetail {
  meta: {
    scheme_name: string;
    scheme_category?: string;
    scheme_type?: string;
    fund_house?: string;
  };
  data: NavPoint[];
}

/** Computed response body persisted in the cache and returned to the client. */
interface DetailPayload {
  success: true;
  meta: {
    scheme_name: string;
    scheme_category: string | null;
    scheme_type: string | null;
    fund_house: string | null;
    launch_date: string | null;
  };
  metrics: ReturnType<typeof computeAll>;
  navHistory: NavPoint[];
}

// deno-lint-ignore no-explicit-any
function createSupabase(): any | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}

async function getJson<T>(url: string, timeoutMs = 12000): Promise<T | null> {
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

/** Read a cached row; returns the payload plus its age in ms, or null. */
// deno-lint-ignore no-explicit-any
async function readCache(supabase: any, code: string): Promise<{ payload: DetailPayload; ageMs: number } | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("mf_detail_cache")
      .select("payload, last_synced_at")
      .eq("scheme_code", code)
      .maybeSingle();
    if (error || !data?.payload) return null;
    const ageMs = Date.now() - new Date(data.last_synced_at).getTime();
    return { payload: data.payload as DetailPayload, ageMs };
  } catch {
    return null;
  }
}

/** Upsert the computed payload; failures are swallowed (cache is best-effort). */
// deno-lint-ignore no-explicit-any
async function writeCache(supabase: any, code: string, payload: DetailPayload): Promise<void> {
  if (!supabase) return;
  try {
    await supabase
      .from("mf_detail_cache")
      .upsert({ scheme_code: code, payload, last_synced_at: new Date().toISOString() }, { onConflict: "scheme_code" });
  } catch {
    // Best-effort — never fail the request because the cache write failed.
  }
}

async function handle(code: string): Promise<Response> {
  const clean = code.replace(/[^0-9]/g, "");
  if (!clean) return json({ success: false, error: "Missing or invalid scheme code" }, 400);

  const supabase = createSupabase();

  // 1) Fresh cache hit → serve instantly, no upstream call.
  const cached = await readCache(supabase, clean);
  if (cached && cached.ageMs < CACHE_TTL_MS) {
    return json({ ...cached.payload, cached: true });
  }

  // 2) Miss or stale → refresh from mfapi.in. Its cold fetch for funds with
  //    long NAV histories can be slow, so allow a generous upstream timeout.
  const detail = await getJson<SchemeDetail>(`https://api.mfapi.in/mf/${clean}`, 25000);
  if (!detail || !detail.data?.length) {
    // Upstream unavailable — serve the stale cache if we have one.
    if (cached) return json({ ...cached.payload, cached: true, stale: true });
    return json({ success: false, error: "Fund data unavailable" }, 404);
  }

  const metrics = computeAll(detail.data);
  if (!metrics) {
    if (cached) return json({ ...cached.payload, cached: true, stale: true });
    return json({ success: false, error: "Could not compute fund metrics" }, 422);
  }

  const first = detail.data[detail.data.length - 1];
  const launch_date = first ? isoDate(parseDate(first.date)) : null;

  const payload: DetailPayload = {
    success: true,
    meta: {
      scheme_name: detail.meta.scheme_name,
      scheme_category: detail.meta.scheme_category ?? null,
      scheme_type: detail.meta.scheme_type ?? null,
      fund_house: detail.meta.fund_house ?? null,
      launch_date,
    },
    metrics,
    navHistory: downsampleNav(detail.data, 220),
  };

  await writeCache(supabase, clean, payload);

  return json({ ...payload, cached: false });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    if (req.method === "GET") {
      const code = new URL(req.url).searchParams.get("code") ?? "";
      return await handle(code);
    }
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      return await handle(String(body.code ?? ""));
    }
    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ success: false, error: message }, 500);
  }
});
