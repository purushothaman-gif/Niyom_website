import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * mf-universe
 * -----------
 * Serves the public MF Research page's "search every fund" feature from a local
 * mirror of the AMFI Direct-Growth scheme universe (`mf_scheme_cache`). mfapi.in
 * is NEVER called from the browser (CORS + payload size); this function is the
 * single server-side proxy, mirroring the nsdl-search convention.
 *
 *   { action: "refresh" }        → re-pull the whole AMFI list into the cache.
 *   { action: "search", q, ... } → ILIKE search over the cached scheme names.
 *   GET ?q=…                     → same as a search action (handy for the page).
 *
 * Public (verify_jwt = false): the page is unauthenticated. The refresh action
 * is also invoked by pg_cron via pg_net with the service-role bearer.
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

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 40;

interface SchemeListEntry { schemeCode: number; schemeName: string; }

/** Escape LIKE/ILIKE wildcards so user input can't act as a pattern. */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (m) => `\\${m}`);
}

/**
 * Keep only Direct-Growth plans (the plan variant we compute returns for) and
 * skip IDCW/dividend options — one canonical row per fund.
 */
function isDirectGrowth(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("direct") && n.includes("growth") &&
    !n.includes("idcw") && !n.includes("dividend");
}

async function getJson<T>(url: string, timeoutMs = 45000): Promise<T | null> {
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

// deno-lint-ignore no-explicit-any
function createSupabase() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase environment variables");
  return createClient(supabaseUrl, serviceKey);
}

async function refresh(): Promise<Response> {
  const supabase = createSupabase();
  const list = await getJson<SchemeListEntry[]>("https://api.mfapi.in/mf");
  if (!list) throw new Error("Could not reach mfapi.in scheme list");

  /*
   * fund_house is deliberately NOT written here.
   *
   * It used to be the first three words of the scheme name, which is not an
   * AMC — it made "Axis Multicap Fund" a fund house of its own. AMFI names the
   * real house above each block of its daily file, so nav-refresh sets the
   * column from that (52 houses, spelled consistently). This job runs at 02:00
   * and nav-refresh at 23:45, so writing a guess here would simply overwrite
   * the good value for most of every day.
   *
   * A scheme this job newly inserts therefore carries a blank house until that
   * night's NAV run. Blank for a day beats wrong all day, and the browse-by-AMC
   * screen filters blanks out rather than inventing a house for them.
   */
  const rows = list
    .filter((s) => isDirectGrowth(s.schemeName))
    .map((s) => {
      const scheme_name = s.schemeName.replace(/\s*-\s*direct.*$/i, "").trim();
      return {
        scheme_code: String(s.schemeCode),
        scheme_name,
        search_name: scheme_name.toLowerCase(),
        last_synced_at: new Date().toISOString(),
      };
    });

  // Upsert in chunks to stay within statement limits.
  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("mf_scheme_cache")
      .upsert(chunk, { onConflict: "scheme_code" });
    if (error) throw error;
    upserted += chunk.length;
  }

  return json({ success: true, upserted });
}

async function search(q: string, limit: number): Promise<Response> {
  const term = q.trim();
  if (term.length < 2) return json({ success: true, results: [] });

  const supabase = createSupabase();
  const { data, error } = await supabase
    .from("mf_scheme_cache")
    .select("scheme_code, scheme_name, fund_house")
    .ilike("search_name", `%${escapeLike(term.toLowerCase())}%`)
    .order("scheme_name", { ascending: true })
    .limit(limit);
  if (error) throw error;

  return json({ success: true, results: data ?? [] });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const url = new URL(req.url);

    // GET ?q= → search
    if (req.method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const limit = Math.min(Number(url.searchParams.get("limit")) || DEFAULT_LIMIT, MAX_LIMIT);
      return await search(q, limit);
    }

    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "search";

    if (action === "refresh") return await refresh();

    const limit = Math.min(Number(body.limit) || DEFAULT_LIMIT, MAX_LIMIT);
    return await search(String(body.q ?? ""), limit);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ success: false, error: message }, 500);
  }
});
