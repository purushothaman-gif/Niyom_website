import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { computeAll, downsampleNav, parseDate, isoDate, type NavPoint } from "../_shared/mfReturns.ts";
import { asJson } from '../_shared/json.ts';
import { dayToIso, readNavSeries, readSchemeMeta, seriesToNavPoints } from '../_shared/amfiNavSeries.ts';
import { pickScheme, type SchemeCandidate } from '../_shared/curatedFundPick.ts';

/**
 * update-mutual-funds
 * -------------------
 * Populates the `mutual_funds` table with REAL fund data. For a curated set of
 * funds it resolves the AMFI scheme code from our own scheme universe
 * (mf_scheme_cache, itself fed by AMFI's scheme master), reads the scheme's NAV
 * history from mf_nav_series (AMFI's own NAVs), and computes real YTD / 6M /
 * 1Y / 3Y / 5Y / since-inception returns plus current NAV, NAV date and
 * 52-week high/low.
 *
 * TRANSITIONAL: a scheme whose AMFI history has not been loaded into
 * mf_nav_series yet still falls back to mfapi.in for that one fetch. That
 * fallback is removed once the backfill completes.
 *
 * AMFI's NAV data does NOT carry AUM or expense ratio, so those columns stay null and
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

// Curated funds to track. `match` locates the Regular-Growth plan in our scheme
// universe; `aka` lists the name(s) the fund trades under TODAY when it has
// been renamed since it was added here (SEBI's category clean-up renamed most
// "Bluechip" and "Equity Hybrid" funds) — the scheme code is unchanged, only
// the label moved. `category` is the top-level bucket the UI filters by; `risk`
// is a house view (AMFI has no risk field). ~50 well-known schemes across
// equity, debt and hybrid.
const TARGETS: { match: string; aka?: string[]; category: "Equity" | "Debt" | "Hybrid"; risk: string }[] = [
  // --- Equity: flexi / multi cap ---
  { match: "Parag Parikh Flexi Cap Fund", category: "Equity", risk: "High" },
  { match: "HDFC Flexi Cap Fund", category: "Equity", risk: "High" },
  { match: "Kotak Flexicap Fund", category: "Equity", risk: "High" },
  { match: "UTI Flexi Cap Fund", category: "Equity", risk: "High" },
  { match: "Quant Active Fund", aka: ["Quant Multi Cap Fund"], category: "Equity", risk: "High" },
  // --- Equity: large cap / bluechip ---
  { match: "Mirae Asset Large Cap Fund", category: "Equity", risk: "Moderate" },
  { match: "ICICI Prudential Bluechip Fund", aka: ["ICICI Prudential Large Cap Fund"], category: "Equity", risk: "Moderate" },
  { match: "Canara Robeco Bluechip Equity Fund", aka: ["Canara Robeco Large Cap Fund"], category: "Equity", risk: "Moderate" },
  { match: "Nippon India Large Cap Fund", category: "Equity", risk: "Moderate" },
  { match: "SBI Bluechip Fund", aka: ["SBI Large Cap Fund"], category: "Equity", risk: "Moderate" },
  { match: "Axis Bluechip Fund", aka: ["Axis Large Cap Fund"], category: "Equity", risk: "Moderate" },
  // --- Equity: large & mid / mid cap ---
  { match: "Axis Midcap Fund", category: "Equity", risk: "High" },
  { match: "Kotak Emerging Equity Fund", aka: ["Kotak Mid Cap Fund"], category: "Equity", risk: "High" },
  { match: "HDFC Mid-Cap Opportunities Fund", aka: ["HDFC Mid Cap Fund"], category: "Equity", risk: "High" },
  { match: "Motilal Oswal Midcap Fund", category: "Equity", risk: "High" },
  { match: "PGIM India Midcap Opportunities Fund", aka: ["PGIM India Midcap Fund"], category: "Equity", risk: "High" },
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
  { match: "ICICI Prudential Value Discovery Fund", aka: ["ICICI Prudential Value Fund"], category: "Equity", risk: "Moderate" },
  { match: "SBI Focused Equity Fund", aka: ["SBI Focused Fund"], category: "Equity", risk: "High" },
  { match: "ICICI Prudential Technology Fund", category: "Equity", risk: "High" },
  { match: "Nippon India Pharma Fund", category: "Equity", risk: "High" },
  // --- Equity: index ---
  { match: "UTI Nifty 50 Index Fund", category: "Equity", risk: "Moderate" },
  { match: "HDFC Index Fund Nifty 50 Plan", aka: ["HDFC Nifty 50 Index Fund"], category: "Equity", risk: "Moderate" },
  // --- Debt: corporate bond / banking & PSU ---
  { match: "HDFC Corporate Bond Fund", category: "Debt", risk: "Low" },
  { match: "ICICI Prudential Corporate Bond Fund", category: "Debt", risk: "Low" },
  { match: "Aditya Birla Sun Life Corporate Bond Fund", category: "Debt", risk: "Low" },
  { match: "Kotak Corporate Bond Fund", category: "Debt", risk: "Low" },
  // --- Debt: gilt ---
  { match: "SBI Magnum Gilt Fund", aka: ["SBI Gilt Fund"], category: "Debt", risk: "Low" },
  { match: "ICICI Prudential Gilt Fund", category: "Debt", risk: "Low" },
  // --- Debt: short / low duration / liquid ---
  { match: "HDFC Short Term Debt Fund", aka: ["HDFC Short Term Fund"], category: "Debt", risk: "Low" },
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
  { match: "SBI Equity Hybrid Fund", aka: ["SBI Aggressive Hybrid Fund"], category: "Hybrid", risk: "Moderate" },
  { match: "ICICI Prudential Equity & Debt Fund", aka: ["ICICI Prudential Aggressive Hybrid Fund"], category: "Hybrid", risk: "Moderate" },
  { match: "Canara Robeco Equity Hybrid Fund", aka: ["Canara Robeco Aggressive Hybrid Fund"], category: "Hybrid", risk: "Moderate" },
  // --- Hybrid: multi asset / conservative ---
  { match: "ICICI Prudential Multi-Asset Fund", aka: ["ICICI Prudential Multi Asset Allocation Fund"], category: "Hybrid", risk: "Moderate" },
  { match: "SBI Conservative Hybrid Fund", category: "Hybrid", risk: "Low" },
];

interface SchemeDetail {
  meta: { scheme_name: string; scheme_category?: string; scheme_type?: string; fund_house?: string };
  data: NavPoint[];
}

function pickSubCategory(schemeCategory?: string): string {
  if (!schemeCategory) return "";
  const parts = schemeCategory.split(" - ");
  return (parts[1] ?? parts[0]).replace(/Fund$/i, "").trim();
}

/**
 * Find the REGULAR-Growth scheme code for a fund name.
 *
 * Regular because NIYOM is an ARN distributor and cannot transact Direct — this
 * table feeds the public MF Research page, so a Direct code here publishes
 * returns no reader could obtain through us. Rule shared via _shared/mfPlan.ts.
 */
/** How stale a NAV may be before a scheme stops counting as live (as in mf-returns-backfill). */
const MAX_NAV_AGE_DAYS = 15;

// deno-lint-ignore no-explicit-any
async function resolveCode(supabase: any, target: { match: string; aka?: string[] }): Promise<number | null> {
  const names = [target.match, ...(target.aka ?? [])];
  const navFloor = new Date(Date.now() - MAX_NAV_AGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  // mf_scheme_cache holds Regular-Growth schemes only (mf-universe applies the
  // shared rule on the way in). Candidates: every LIVE scheme from the same
  // fund house, found by the first word of each name the fund may go by.
  const firstWords = [...new Set(names.map((n) => n.trim().split(/\s+/)[0]).filter(Boolean))];
  const candidates: SchemeCandidate[] = [];
  for (const w of firstWords) {
    const { data } = await supabase
      .from("mf_scheme_cache")
      .select("scheme_code, scheme_name")
      .ilike("scheme_name", `${w.replace(/[%_\\]/g, (c: string) => `\\${c}`)}%`)
      .not("current_nav", "is", null)
      .gte("nav_date", navFloor)
      .limit(1000);
    candidates.push(...((data ?? []) as SchemeCandidate[]));
  }
  return pickScheme(candidates, names);
}

/**
 * A scheme's identity and full history: our AMFI series when it is loaded,
 * otherwise (transitionally) mfapi.in.
 */
// deno-lint-ignore no-explicit-any
async function loadDetail(supabase: any, code: number): Promise<{ detail: SchemeDetail; launch_date: string | null } | null> {
  const series = await readNavSeries(supabase, String(code));
  if (series) {
    // Keep the name/category this fund already shows, if it has been cached.
    const prior = await supabase.from("mf_detail_cache").select("payload").eq("scheme_code", String(code)).maybeSingle();
    const priorMeta = (prior.data?.payload as { meta?: SchemeDetail["meta"] } | null)?.meta;
    const meta = priorMeta?.scheme_name ? priorMeta : await readSchemeMeta(supabase, String(code));
    return {
      detail: {
        meta: {
          scheme_name: meta.scheme_name,
          scheme_category: meta.scheme_category ?? undefined,
          scheme_type: meta.scheme_type ?? undefined,
          fund_house: meta.fund_house ?? undefined,
        },
        data: seriesToNavPoints(series),
      },
      launch_date: dayToIso(series.d[0]),
    };
  }
  const detail = await getJson<SchemeDetail>(`https://api.mfapi.in/mf/${code}`);
  if (!detail || !detail.data?.length) return null;
  const first = detail.data[detail.data.length - 1];
  return { detail, launch_date: first ? isoDate(parseDate(first.date)) : null };
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

    // 1–2. Resolve each target to a scheme code from our own scheme universe.
    const resolved = (await Promise.all(
      TARGETS.map(async (t) => ({ ...t, code: await resolveCode(supabase, t) })),
    )).filter((t): t is typeof t & { code: number } => t.code != null);

    // Make sure every curated scheme's AMFI history is queued ahead of the bulk.
    await supabase.rpc("mf_nav_series_enqueue", { p_codes: resolved.map((t) => String(t.code)), p_priority: 1 })
      .then(() => undefined, () => undefined);

    // 3. Fetch each fund's NAV history in parallel and compute the full metric spread.
    const details = await Promise.all(
      resolved.map(async (t) => {
        const loaded = await loadDetail(supabase, t.code);
        if (!loaded) return null;
        const { detail, launch_date } = loaded; // inception ≈ oldest NAV point

        const metrics = computeAll(detail.data);
        if (!metrics) return null;

        const row = {
          fund_name: detail.meta.scheme_name.replace(/\s*-\s*(regular|growth).*$/i, "").trim(),
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
          // jsonb column: FundMetrics is plain data but not provably `Json`.
          payload: asJson({
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
          }),
          last_synced_at: new Date().toISOString(),
        };

        return { row, cache };
      }),
    );

    const ok = details.filter((d): d is NonNullable<typeof d> => d !== null);
    if (ok.length === 0) throw new Error("No fund data could be computed");

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

    const unresolved = TARGETS.filter((t) => !resolved.some((r) => r.match === t.match)).map((t) => t.match);
    return json({ success: true, updated: funds.length, warmed, codes: funds.map((f) => f.fund_code), skipped: TARGETS.length - funds.length, unresolved });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ success: false, error: message }, 500);
  }
});
