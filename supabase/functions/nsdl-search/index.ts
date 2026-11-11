import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Employee-facing security search. Runs with the default verify_jwt = true, so
// only authenticated CRM users reach it. It serves the local nsdl_securities
// cache first and only falls through to NSDL on a cache miss, then caches the
// result. NSDL is NEVER called from the browser (CORS-blocked and would leak the
// integration); this function is the single server-side proxy.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const NSDL_BASE = "https://nsdl.com/web/api/v1/participant/search";
const UPSTREAM_TIMEOUT_MS = 8000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

interface Security {
  isin: string;
  name: string;
  security_name: string;
  security_type: string;
  isin_status: string;
  nsdl_id: string;
}

// NSDL returns a status string; surface ACTIVE first in the UI.
function activeFirst(a: Security, b: Security): number {
  const rank = (s: string) => (s?.toUpperCase() === "ACTIVE" ? 0 : 1);
  const d = rank(a.isin_status) - rank(b.isin_status);
  return d !== 0 ? d : a.name.localeCompare(b.name);
}

// Escape LIKE/ILIKE wildcards so user input can't act as a pattern.
function escapeLike(s: string): string {
  return s.replace(/[%_\\]/g, (m) => `\\${m}`);
}

function mapNsdlRow(r: Record<string, unknown>): Security | null {
  const isin = String(r?.field_isin ?? "").trim().toUpperCase();
  if (!isin) return null;
  return {
    isin,
    name: String(r?.name ?? "").trim(),
    security_name: String(r?.isin_description__value ?? "").trim(),
    security_type: String(r?.security_description ?? "").trim(),
    isin_status: String(r?.isin_status ?? "").trim(),
    nsdl_id: String(r?.id ?? "").trim(),
  };
}

async function fetchNsdl(url: string): Promise<Record<string, unknown>[]> {
  // One attempt + one retry, each with its own timeout.
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`NSDL responded ${res.status}`);
      const json = await res.json();
      return Array.isArray(json?.data) ? json.data : [];
    } catch (err) {
      clearTimeout(timer);
      if (attempt === 1) throw err;
    }
  }
  return [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawQuery = String(body?.query ?? "").trim();
    let mode: "name" | "isin" = body?.mode === "isin" ? "isin" : "name";
    const limit = Math.min(Math.max(parseInt(String(body?.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    // Auto-detect an ISIN paste even if the client asked for name mode.
    const looksLikeIsin = /^[A-Z]{2}[A-Z0-9]{9,10}$/i.test(rawQuery);
    if (looksLikeIsin) mode = "isin";

    // --- Validation / sanitization -------------------------------------------
    if (mode === "name" && rawQuery.length < 2) {
      return json({ results: [], source: "cache", count: 0 }, 200);
    }
    const query = mode === "isin" ? rawQuery.toUpperCase() : rawQuery;
    if (mode === "isin" && !/^[A-Z0-9]{2,12}$/.test(query)) {
      return json({ results: [], source: "cache", count: 0 }, 200);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Missing Supabase environment variables");
    const supabase = createClient(supabaseUrl, supabaseKey);

    // --- 1) Cache-first (+ our own masters, in parallel) ---------------------
    const esc = escapeLike(query);
    let cacheQ = supabase.from("nsdl_securities").select("isin,name,security_name,security_type,isin_status,nsdl_id");
    cacheQ = mode === "isin"
      ? cacheQ.ilike("isin", `${esc}%`)
      : cacheQ.or(`name.ilike.%${esc}%,security_name.ilike.%${esc}%`);
    const [{ data: cached, error: cacheErr }, masters] = await Promise.all([
      cacheQ.limit(limit),
      searchMasters(supabase, mode, esc, limit),
    ]);
    if (cacheErr) throw cacheErr;

    if (cached && cached.length > 0) {
      const results = withMasters((cached as Security[]).sort(activeFirst), masters);
      return json({ results, source: "cache", count: results.length }, 200);
    }

    // A full ISIN we hold in our own master needs no NSDL round-trip (NSDL's
    // directory doesn't list every ISIN, so this would miss on every keystroke).
    if (mode === "isin" && masters.some((m) => m.isin === query)) {
      return json({ results: masters, source: "master", count: masters.length }, 200);
    }

    // --- 2) Cache miss → NSDL live ------------------------------------------
    const url = mode === "isin"
      ? `${NSDL_BASE}?search_type=DetailedSearch&isin=${encodeURIComponent(query)}&page=1&per_page=${limit}`
      : `${NSDL_BASE}?search_type=DetailedSearch&name=${encodeURIComponent(query)}&page=1&per_page=${limit}`;

    let rows: Record<string, unknown>[];
    try {
      rows = await fetchNsdl(url);
    } catch (err) {
      // Upstream down and nothing cached — degrade softly so the form stays usable.
      await logUpdate(supabase, "error", 0, `nsdl fetch failed: ${(err as Error).message}`);
      if (masters.length > 0) return json({ results: masters, source: "master", count: masters.length }, 200);
      return json({ results: [], source: "degraded", count: 0 }, 200);
    }

    const mapped = rows.map(mapNsdlRow).filter((r): r is Security => r !== null);

    // Cache the results (idempotent upsert on isin).
    if (mapped.length > 0) {
      const nowIso = new Date().toISOString();
      const { error: upsertErr } = await supabase
        .from("nsdl_securities")
        .upsert(
          mapped.map((m) => ({ ...m, source: "nsdl", last_synced_at: nowIso })),
          { onConflict: "isin" },
        );
      if (upsertErr) console.error("nsdl_securities upsert error:", upsertErr.message);
    }

    await logUpdate(supabase, "success", mapped.length, null);

    const results = withMasters(mapped.sort(activeFirst), masters);
    return json({ results, source: mapped.length > 0 ? "nsdl" : (masters.length > 0 ? "master" : "nsdl"), count: results.length }, 200);
  } catch (error) {
    console.error("nsdl-search error:", error);
    return json({ results: [], source: "degraded", error: (error as Error).message }, 500);
  }
});

// NSDL's public directory does not list every ISIN (e.g. INE926R07076), so a
// bond or unlisted share we already hold in our own masters must still be
// findable. security_type carries BOND / EQUITY SHARES so the deal form derives
// the Product Type exactly as it does for an NSDL pick. isin_status stays blank:
// it is NSDL's status and we have none for these rows. A master failure must
// never break the search, so errors degrade to "no master rows".
async function searchMasters(
  supabase: ReturnType<typeof createClient>,
  mode: "name" | "isin",
  esc: string,
  limit: number,
): Promise<Security[]> {
  try {
    let bondQ = supabase.from("bm_bonds").select("isin,bond_name,active_status");
    bondQ = mode === "isin" ? bondQ.ilike("isin", `${esc}%`) : bondQ.ilike("bond_name", `%${esc}%`);
    let shareQ = supabase.from("us_shares").select("isin,company_name");
    shareQ = mode === "isin" ? shareQ.ilike("isin", `${esc}%`) : shareQ.ilike("company_name", `%${esc}%`);

    const [bonds, shares] = await Promise.all([
      bondQ.order("active_status", { ascending: true }).limit(limit),
      shareQ.limit(limit),
    ]);
    if (bonds.error) console.error("bm_bonds search error:", bonds.error.message);
    if (shares.error) console.error("us_shares search error:", shares.error.message);

    const out: Security[] = [];
    for (const b of (bonds.data ?? []) as { isin: string | null; bond_name: string | null }[]) {
      const isin = String(b.isin ?? "").trim().toUpperCase();
      const name = String(b.bond_name ?? "").trim();
      if (!isin || !name) continue;
      out.push({ isin, name, security_name: name, security_type: "BOND · Niyom bond master", isin_status: "", nsdl_id: "bm" });
    }
    for (const s of (shares.data ?? []) as { isin: string | null; company_name: string | null }[]) {
      const isin = String(s.isin ?? "").trim().toUpperCase();
      const name = String(s.company_name ?? "").trim();
      if (!isin || !name) continue;
      out.push({ isin, name, security_name: name, security_type: "EQUITY SHARES · Niyom unlisted master", isin_status: "", nsdl_id: "us" });
    }
    return out;
  } catch (err) {
    console.error("master search error:", (err as Error).message);
    return [];
  }
}

// Master rows NSDL doesn't know about go first (they are our own inventory);
// where NSDL has the same ISIN its row wins, since it carries the live status.
function withMasters(nsdl: Security[], masters: Security[]): Security[] {
  const seen = new Set(nsdl.map((r) => r.isin));
  const extras: Security[] = [];
  for (const m of masters) {
    if (seen.has(m.isin)) continue;
    seen.add(m.isin);
    extras.push(m);
  }
  return [...extras, ...nsdl];
}

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function logUpdate(
  supabase: ReturnType<typeof createClient>,
  status: string,
  records: number,
  errorMessage: string | null,
): Promise<void> {
  try {
    await supabase.from("data_update_log").insert({
      source_name: "nsdl",
      data_type: "security_search",
      last_update: new Date().toISOString(),
      status,
      records_updated: records,
      error_message: errorMessage,
    });
  } catch (_) {
    // Logging must never break the request path.
  }
}
