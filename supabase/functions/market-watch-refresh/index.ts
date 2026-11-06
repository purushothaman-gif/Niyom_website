import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { MARKET_SYMBOLS, parseYahooChart } from "../_shared/marketWatch.ts";

/**
 * market-watch-refresh
 * --------------------
 * Pulls index and currency quotes server-side and caches them in
 * `market_quotes`, which the CRM / client / partner Market Watch pages read.
 * The browser never calls the market source itself.
 *
 * Source: Yahoo Finance's public chart endpoint (unofficial, no key, no SLA).
 * The user chose it over a broker API; figures are labelled indicative and
 * each carries the source's own last-trade time. A failed symbol keeps its
 * previous price and records `error`, so a blip never blanks the page.
 *
 * POST {} → refresh (pg_cron calls this every 2 min in market hours, hourly
 *           otherwise). Skipped when the cache is under a minute old, so an
 *           anonymous caller cannot hammer the source through us.
 *
 * verify_jwt = false so pg_cron can call it without a JWT. Safe to leave open:
 * it accepts no input and only writes values it fetched itself.
 */

const MIN_INTERVAL_MS = 60_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function fetchYahoo(yahooSymbol: string) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NiyomMarketWatch/1.0)", Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseYahooChart(await res.json());
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: last } = await db
    .from("market_quotes")
    .select("fetched_at")
    .order("fetched_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (last?.fetched_at && Date.now() - new Date(last.fetched_at).getTime() < MIN_INTERVAL_MS) {
    return json({ skipped: true, reason: "fresh" });
  }

  const fetchedAt = new Date().toISOString();
  const results = await Promise.allSettled(MARKET_SYMBOLS.map((s) => fetchYahoo(s.yahoo)));

  const out: Record<string, string> = {};
  for (let i = 0; i < MARKET_SYMBOLS.length; i++) {
    const sym = MARKET_SYMBOLS[i];
    const r = results[i];
    if (r.status === "fulfilled") {
      const q = r.value;
      const { error } = await db.from("market_quotes").update({
        price: q.price,
        prev_close: q.prevClose,
        change: q.change,
        change_pct: q.changePct,
        as_of: q.asOf,
        source: "yahoo",
        fetched_at: fetchedAt,
        error: null,
      }).eq("symbol", sym.key);
      out[sym.key] = error ? `db: ${error.message}` : "ok";
    } else {
      const msg = String((r.reason as Error)?.message ?? r.reason).slice(0, 200);
      // Keep the last good price; stamp the attempt so the skip-guard holds.
      await db.from("market_quotes").update({ error: msg, fetched_at: fetchedAt }).eq("symbol", sym.key);
      out[sym.key] = `error: ${msg}`;
    }
  }
  return json({ fetched_at: fetchedAt, results: out });
});
