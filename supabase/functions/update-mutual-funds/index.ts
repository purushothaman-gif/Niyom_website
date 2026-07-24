import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * update-mutual-funds
 * -------------------
 * Populates the `mutual_funds` table with REAL fund data from mfapi.in
 * (free, no API key). For a curated set of funds it resolves the AMFI scheme
 * code, pulls the NAV history, and computes real 1Y / 3Y / 5Y returns.
 *
 * mfapi.in does NOT expose AUM, expense ratio or fund manager, so those fields
 * are left null and are not shown on the MF Research page.
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
// scheme list; `category` is the top-level bucket the UI filters by.
const TARGETS: { match: string; category: "Equity" | "Debt" | "Hybrid"; risk: string }[] = [
  { match: "Parag Parikh Flexi Cap Fund", category: "Equity", risk: "High" },
  { match: "Mirae Asset Large Cap Fund", category: "Equity", risk: "Moderate" },
  { match: "Axis Midcap Fund", category: "Equity", risk: "High" },
  { match: "SBI Small Cap Fund", category: "Equity", risk: "High" },
  { match: "Nippon India Small Cap Fund", category: "Equity", risk: "High" },
  { match: "HDFC Flexi Cap Fund", category: "Equity", risk: "High" },
  { match: "ICICI Prudential Bluechip Fund", category: "Equity", risk: "Moderate" },
  { match: "Kotak Emerging Equity Fund", category: "Equity", risk: "High" },
  { match: "Canara Robeco Bluechip Equity Fund", category: "Equity", risk: "Moderate" },
  { match: "Mirae Asset ELSS Tax Saver Fund", category: "Equity", risk: "Moderate" },
  { match: "HDFC Corporate Bond Fund", category: "Debt", risk: "Low" },
  { match: "ICICI Prudential Corporate Bond Fund", category: "Debt", risk: "Low" },
  { match: "SBI Magnum Gilt Fund", category: "Debt", risk: "Low" },
  { match: "HDFC Balanced Advantage Fund", category: "Hybrid", risk: "Moderate" },
  { match: "ICICI Prudential Balanced Advantage Fund", category: "Hybrid", risk: "Moderate" },
  { match: "SBI Equity Hybrid Fund", category: "Hybrid", risk: "Moderate" },
];

interface SchemeListEntry { schemeCode: number; schemeName: string; }
interface NavPoint { date: string; nav: string; }
interface SchemeDetail {
  meta: { scheme_name: string; scheme_category?: string; fund_house?: string };
  data: NavPoint[];
}

/** Parse mfapi.in "dd-mm-yyyy" into a Date. */
function parseDate(s: string): Date {
  const [d, m, y] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** NAV closest to (but not after) `target`, scanning newest→oldest history. */
function navOnOrBefore(data: NavPoint[], target: Date): number | null {
  for (const p of data) {
    if (parseDate(p.date).getTime() <= target.getTime()) {
      const v = parseFloat(p.nav);
      return Number.isFinite(v) && v > 0 ? v : null;
    }
  }
  return null;
}

/** Annualised (CAGR) return % over `years`; simple % when years === 1. */
function computeReturn(data: NavPoint[], latest: number, latestDate: Date, years: number): number {
  const target = new Date(latestDate);
  target.setFullYear(target.getFullYear() - years);
  const past = navOnOrBefore(data, target);
  if (!past) return 0;
  const growth = latest / past;
  const r = years === 1 ? growth - 1 : Math.pow(growth, 1 / years) - 1;
  return Math.round(r * 1000) / 10; // one decimal place, as a percentage
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

    // 3. Fetch each fund's NAV history in parallel and compute returns.
    const details = await Promise.all(
      resolved.map(async (t) => {
        const detail = await getJson<SchemeDetail>(`https://api.mfapi.in/mf/${t.code}`);
        if (!detail || !detail.data?.length) return null;

        const latest = parseFloat(detail.data[0].nav);
        const latestDate = parseDate(detail.data[0].date);
        if (!Number.isFinite(latest) || latest <= 0) return null;

        return {
          fund_name: detail.meta.scheme_name.replace(/\s*-\s*(direct|regular|growth).*$/i, "").trim(),
          fund_code: String(t.code),
          category: t.category,
          sub_category: pickSubCategory(detail.meta.scheme_category),
          return_1y: computeReturn(detail.data, latest, latestDate, 1),
          return_3y: computeReturn(detail.data, latest, latestDate, 3),
          return_5y: computeReturn(detail.data, latest, latestDate, 5),
          risk_level: t.risk,
          min_investment: 500,
          updated_at: new Date().toISOString(),
        };
      }),
    );

    const funds = details.filter((f): f is NonNullable<typeof f> => f !== null);
    if (funds.length === 0) throw new Error("No fund data could be computed from mfapi.in");

    const { error } = await supabase.from("mutual_funds").upsert(funds, { onConflict: "fund_code" });
    if (error) throw error;

    // Purge the earlier placeholder funds (their codes contain dashes;
    // real AMFI scheme codes are purely numeric).
    await supabase.from("mutual_funds").delete().like("fund_code", "%-%");

    return json({ success: true, updated: funds.length, skipped: TARGETS.length - funds.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ success: false, error: message }, 500);
  }
});
