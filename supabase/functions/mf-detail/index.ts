import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { computeAll, downsampleNav, parseDate, isoDate, type NavPoint } from "../_shared/mfReturns.ts";

/**
 * mf-detail
 * ---------
 * On-demand detail for a single AMFI scheme, powering the fund detail view on
 * the public MF Research page. Proxies mfapi.in/mf/{code} (never called from the
 * browser), computes the full metric spread and returns a chart-ready,
 * downsampled NAV history.
 *
 *   GET ?code=NNNN  →  { success, meta, metrics, navHistory }
 *
 * Public (verify_jwt = false): the page is unauthenticated.
 */

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

async function handle(code: string): Promise<Response> {
  const clean = code.replace(/[^0-9]/g, "");
  if (!clean) return json({ success: false, error: "Missing or invalid scheme code" }, 400);

  // mfapi.in can be slow on a cold fetch for funds with long NAV histories
  // (10+ years → thousands of points), so allow a generous upstream timeout.
  const detail = await getJson<SchemeDetail>(`https://api.mfapi.in/mf/${clean}`, 25000);
  if (!detail || !detail.data?.length) {
    return json({ success: false, error: "Fund data unavailable" }, 404);
  }

  const metrics = computeAll(detail.data);
  if (!metrics) return json({ success: false, error: "Could not compute fund metrics" }, 422);

  const first = detail.data[detail.data.length - 1];
  const launch_date = first ? isoDate(parseDate(first.date)) : null;

  return json({
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
  });
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
