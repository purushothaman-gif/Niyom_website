import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { computeAll, downsampleNav, parseDate, isoDate, type NavPoint } from "../_shared/mfReturns.ts";

/**
 * update-mutual-funds
 * -------------------
 * Populates the `mutual_funds` table with REAL fund data from mfapi.in
 * (free, no API key). For a curated set of funds it resolves the AMFI scheme
 * code, pulls the NAV history, and computes real YTD / 6M / 1Y / 3Y / 5Y /
 * since-inception returns plus current NAV, NAV date and 52-week high/low.
 *
 * mfapi.in does NOT expose AUM or expense ratio, so those columns stay null and
 * are not shown on the MF Research page. `fund_house` (AMC) and an inception
 * `launch_date` (oldest NAV point) ARE derived and stored.
 *
 * POST → { success, updated, skipped }.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Curated funds to track. `match` locates the Direct-Growth plan in the AMFI
// scheme list; `category` is the top-level bucket the UI filters by; `risk` is
// a house view (mfapi.in has no risk field). ~50 well-known schemes across
// equity, debt and hybrid.
const TARGETS: { match: string; category: "Equity" | "Debt" | "Hybrid"; risk: string }[] = [
  // --- Equity: flexi / multi cap ---
  { match: "Parag Parikh Flexi Cap Fund", category: "Equity", risk: "High" },
  { match: "HDFC Flexi Cap Fund", category: "Equity", risk: "High" },
  { match: "Kotak Flexicap Fund", category: "Equity", risk: "High" },
  { match: "UTI Flexi Cap Fund", category: "Equity", risk: "High" },
  { match: "Quant Active Fund", category: "Equity", risk: "High" },
  // --- Equity: large cap / bluechip ---
  { match: "Mirae Asset Large Cap Fund", category: "Equity", risk: "Moderate" },
  { match: "ICICI Prudential Bluechip Fund", category: "Equity", risk: "Moderate" },
  { match: "Canara Robeco Bluechip Equity Fund", category: "Equity", risk: "Moderate" },
  { match: "Nippon India Large Cap Fund", category: "Equity", risk: "Moderate" },
  { match: "SBI Bluechip Fund", category: "Equity", risk: "Moderate" },
  { match: "Axis Bluechip Fund", category: "Equity", risk: "Moderate" },
  // --- Equity: large & mid / mid cap ---
  { match: "Axis Midcap Fund", category: "Equity", risk: "High" },
  { match: "Kotak Emerging Equity Fund", category: "Equity", risk: "High" },
  { match: "HDFC Mid-Cap Opportunities Fund", category: "Equity", risk: "High" },
  { match: "Motilal Oswal Midcap Fund", category: "Equity", risk: "High" },
  { match: "PGIM India Midcap Opportunities Fund", category: "Equity", risk: "High" },
  { match: "Mirae Asset Large & Midcap Fund", category: "Equity", risk: "High" },
  // --- Equity: small cap ---
  { match: "SBI Small Cap Fund", category: "Equity", risk: "High" },
  { match: "Nippon India Small Cap Fund", category: "Equity", risk: "High" },
  { match: "Axis Small Cap Fund", category: "Equity", risk: "High" },
  { match: "HDFC Small Cap Fund", category: "Equity", risk: "High" },
  { match: "Quant Small Cap Fund", category: "Equity", risk: "High" },
  // --- Equity: ELSS (tax saver) ---
  { match: "Mirae Asset ELSS Tax Saver Fund", category: "Equity", risk: "Moderate" },
  { match: "Quant ELSS Tax Saver Fund", category: "Equity", risk: "High" },
  { match: "Canara Robeco ELSS Tax Saver", category: "Equity", risk: "Moderate" },
  // --- Equity: value / focused / sectoral ---
  { match: "ICICI Prudential Value Discovery Fund", category: "Equity", risk: "Moderate" },
  { match: "SBI Focused Equity Fund", category: "Equity", risk: "High" },
  { match: "ICICI Prudential Technology Fund", category: "Equity", risk: "High" },
  { match: "Nippon India Pharma Fund", category: "Equity", risk: "High" },
  // --- Equity: index ---
  { match: "UTI Nifty 50 Index Fund", category: "Equity", risk: "Moderate" },
  { match: "HDFC Index Fund Nifty 50 Plan", category: "Equity", risk: "Moderate" },
  // --- Debt: corporate bond / banking & PSU ---
  { match: "HDFC Corporate Bond Fund", category: "Debt", risk: "Low" },
  { match: "ICICI Prudential Corporate Bond Fund", category: "Debt", risk: "Low" },
  { match: "Aditya Birla Sun Life Corporate Bond Fund", category: "Debt", risk: "Low" },
  { match: "Kotak Corporate Bond Fund", category: "Debt", risk: "Low" },
  // --- Debt: gilt ---
  { match: "SBI Magnum Gilt Fund", category: "Debt", risk: "Low" },
  { match: "ICICI Prudential Gilt Fund", category: "Debt", risk: "Low" },
  // --- Debt: short / low duration / liquid ---
  { match: "HDFC Short Term Debt Fund", category: "Debt", risk: "Low" },
  { match: "ICICI Prudential Short Term Fund", category: "Debt", risk: "Low" },
  { match: "Axis Liquid Fund", category: "Debt", risk: "Low" },
  { match: "SBI Liquid Fund", category: "Debt", risk: "Low" },
  // --- Debt: dynamic bond ---
  { match: "ICICI Prudential All Seasons Bond Fund", category: "Debt", risk: "Moderate" },
  // --- Hybrid: balanced advantage / dynamic asset allocation ---
  { match: "HDFC Balanced Advantage Fund", category: "Hybrid", risk: "Moderate" },
  { match: "ICICI Prudential Balanced Advantage Fund", category: "Hybrid", risk: "Moderate" },
  { match: "Edelweiss Balanced Advantage Fund", category: "Hybrid", risk: "Moderate" },
  // --- Hybrid: aggressive / equity hybrid ---
  { match: "SBI Equity Hybrid Fund", category: "Hybrid", risk: "Moderate" },
  { match: "ICICI Prudential Equity & Debt Fund", category: "Hybrid", risk: "Moderate" },
  { match: "Canara Robeco Equity Hybrid Fund", category: "Hybrid", risk: "Moderate" },
  // --- Hybrid: multi asset / conservative ---
  { match: "ICICI Prudential Multi-Asset Fund", category: "Hybrid", risk: "Moderate" },
  { match: "SBI Conservative Hybrid Fund", category: "Hybrid", risk: "Low" },
];

interface SchemeListEntry { schemeCode: number; schemeName: string; }
interface SchemeDetail {
  meta: { scheme_name: string; scheme_category?: string; scheme_type?: string; fund_house?: string };
  data: NavPoint[];
}

function pickSubCategory(schemeCategory?: string): string {
  if (!schemeCategory) return "";
  const parts = schemeCategory.split(" - ");
  return (parts[1] ?? parts[0]).replace(/Fund$/i, "").trim();
}

/** Find the Direct-Growth scheme code for a fund name. */
function resolveCode(list: SchemeListEntry[], match: string): number | null {
  const m = match.toLowerCase();
  const candidates = list.filter((s) => {
    const n = s.schemeName.toLowerCase();
    return n.includes(m) && n.includes("direct") && n.includes("growth") &&
      !n.includes("idcw") && !n.includes("dividend");
  });
  return candidates.length ? candidates[0].schemeCode : null;
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase environment variables");
    const supabase = createClient(supabaseUrl, serviceKey);

    // 1. Whole AMFI scheme list (to resolve codes by fund name). Large payload —
    //    allow a longer timeout.
    const list = await getJson<SchemeListEntry[]>("https://api.mfapi.in/mf", 45000);
    if (!list) throw new Error("Could not reach mfapi.in scheme list");

    // 2. Resolve each target to a scheme code.
    const resolved = TARGETS
      .map((t) => ({ ...t, code: resolveCode(list, t.match) }))
      .filter((t): t is typeof t & { code: number } => t.code != null);

    // 3. Fetch each fund's NAV history in parallel and compute the full metric spread.
    const details = await Promise.all(
      resolved.map(async (t) => {
        const detail = await getJson<SchemeDetail>(`https://api.mfapi.in/mf/${t.code}`);
        if (!detail || !detail.data?.length) return null;

        const metrics = computeAll(detail.data);
        if (!metrics) return null;

        // Inception ≈ oldest NAV point in the history.
        const first = detail.data[detail.data.length - 1];
        const launch_date = first ? isoDate(parseDate(first.date)) : null;

        const row = {
          fund_name: detail.meta.scheme_name.replace(/\s*-\s*(direct|regular|growth).*$/i, "").trim(),
          fund_code: String(t.code),
          category: t.category,
          sub_category: pickSubCategory(detail.meta.scheme_category),
          fund_house: detail.meta.fund_house ?? null,
          fund_manager: detail.meta.fund_house ?? null,
          current_nav: metrics.current_nav,
          nav_date: metrics.nav_date,
          return_ytd: metrics.return_ytd,
          return_6m: metrics.return_6m,
          return_1y: metrics.return_1y,
          return_3y: metrics.return_3y,
          return_5y: metrics.return_5y,
          return_si: metrics.return_si,
          launch_date,
          risk_level: t.risk,
          min_investment: 500,
          updated_at: new Date().toISOString(),
        };

        // Pre-warm the mf-detail cache from the SAME fetch — the detail modal
        // reads this table keyed by fund_code, so building the payload here (the
        // exact shape mf-detail returns) means the nightly refresh warms every
        // curated fund without any extra mfapi.in calls.
        const cache = {
          scheme_code: String(t.code),
          payload: {
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
          },
          last_synced_at: new Date().toISOString(),
        };

        return { row, cache };
      }),
    );

    const ok = details.filter((d): d is NonNullable<typeof d> => d !== null);
    if (ok.length === 0) throw new Error("No fund data could be computed from mfapi.in");

    const funds = ok.map((d) => d.row);
    const { error } = await supabase.from("mutual_funds").upsert(funds, { onConflict: "fund_code" });
    if (error) throw error;

    // Purge the earlier placeholder funds (their codes contain dashes;
    // real AMFI scheme codes are purely numeric).
    await supabase.from("mutual_funds").delete().like("fund_code", "%-%");

    // Pre-warm the detail cache (best-effort — a cache write failure must never
    // fail the primary table refresh).
    let warmed = 0;
    try {
      const { error: cacheErr } = await supabase
        .from("mf_detail_cache")
        .upsert(ok.map((d) => d.cache), { onConflict: "scheme_code" });
      if (!cacheErr) warmed = ok.length;
    } catch {
      // swallow — cache pre-warm is non-critical
    }

    return json({ success: true, updated: funds.length, warmed, skipped: TARGETS.length - funds.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ success: false, error: message }, 500);
  }
});
