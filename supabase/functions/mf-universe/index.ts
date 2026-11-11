import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { isRegularGrowth } from "../_shared/mfPlan.ts";

/**
 * mf-universe
 * -----------
 * Serves the public MF Research page's "search every fund" feature from a local
 * mirror of the AMFI REGULAR-Growth scheme universe (`mf_scheme_cache`).
 *
 * Regular, not Direct: NIYOM is an ARN distributor and cannot transact a Direct
 * plan, so a Direct scheme here is one we could never execute, quoted at
 * returns nobody could earn through us. The rule lives in _shared/mfPlan.ts and
 * is shared with the app — do not re-implement it here. The list comes from
 * AMFI's own daily NAV file (already in nav_daily), not from any third party.
 *
 *   { action: "refresh" }        → add schemes new to AMFI's daily file to the cache.
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

/** A full AMFI daily file carries ~12,000 priced ISINs; a partial one, hundreds. */
const FULL_DAY_ROWS = 5000;

interface MasterRow { amfi_code: string | null; scheme_name: string | null; }

/** Escape LIKE/ILIKE wildcards so user input can't act as a pattern. */
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (m) => `\\${m}`);
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
  /*
   * The scheme list is AMFI's own daily NAV file, which nav-refresh already
   * loads into nav_daily every night — no third-party list is consulted.
   *
   * The daily file and not the scheme master, on purpose: a scheme that has a
   * NAV dated today is one that exists and is priced. The master also lists
   * matured closed-ended series, and its closure_date is the NFO closing date,
   * not a wind-up date, so it cannot tell a live scheme from a dead one.
   */
  const latest = await supabase
    .from("nav_daily")
    .select("nav_date")
    .order("nav_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw latest.error;
  const newest = latest.data?.nav_date as string | undefined;
  if (!newest) throw new Error("nav_daily holds no NAVs — nothing to build the scheme list from");

  /*
   * The newest date is usually a PARTIAL file: funds that report a day late
   * have not published yet, and weekends carry only a few hundred liquid
   * funds. Take the most recent day that is a full trading day instead.
   */
  let navDate: string | null = null;
  for (let back = 0; back < 8 && !navDate; back++) {
    const day = new Date(Date.parse(`${newest}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
    const { count, error } = await supabase
      .from("nav_daily")
      .select("isin", { count: "exact", head: true })
      .eq("nav_date", day);
    if (error) throw error;
    if ((count ?? 0) >= FULL_DAY_ROWS) navDate = day;
  }
  if (!navDate) throw new Error("no full trading day in nav_daily in the last week");

  const master: MasterRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("nav_daily")
      .select("amfi_code, scheme_name")
      .eq("nav_date", navDate)
      .not("amfi_code", "is", null)
      .not("scheme_name", "is", null)
      .order("isin", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    master.push(...((data ?? []) as MasterRow[]));
    if (!data || data.length < 1000) break;
  }
  if (!master.length) throw new Error(`AMFI daily file for ${navDate} has no named schemes`);

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
  const byCode = new Map<string, { scheme_code: string; scheme_name: string; search_name: string; last_synced_at: string }>();
  for (const s of master) {
    const code = String(s.amfi_code ?? "");
    const name = s.scheme_name ?? "";
    if (!/^[0-9]+$/.test(code) || !name || byCode.has(code)) continue;
    if (!isRegularGrowth(name)) continue;
    const scheme_name = name.replace(/\s*-\s*regular.*$/i, "").trim();
    byCode.set(code, {
      scheme_code: code,
      scheme_name,
      search_name: scheme_name.toLowerCase(),
      last_synced_at: new Date().toISOString(),
    });
  }
  const rows = [...byCode.values()];

  // Upsert in chunks to stay within statement limits.
  const CHUNK = 500;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    // INSERT-only: a scheme already in the cache keeps the name it has. The
    // portal joins this catalog to others BY NAME, so re-spelling 9,000 rows
    // because the list changed source would silently break those joins.
    const { error } = await supabase
      .from("mf_scheme_cache")
      .upsert(chunk, { onConflict: "scheme_code", ignoreDuplicates: true });
    if (error) throw error;
    upserted += chunk.length;
  }

  return json({ success: true, upserted, source: "amfi-daily-file", nav_date: navDate });
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
