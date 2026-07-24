import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * update-commodity-prices
 * -----------------------
 * Maintains the `commodity_prices` table (gold per 10g, silver per kg) used by
 * the public Learning page's commodity widget. Illustrative MCX-aligned data —
 * no external API. Swap `seedSeries()` for a live spot-price feed when needed.
 *
 * POST { commodity, price, price_date }  → upsert a single reading.
 * POST {} (or { seed: true })            → seed the last 30 days for gold+silver.
 * GET                                    → latest reading per commodity.
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

type Commodity = "gold" | "silver";

interface PriceRow {
  commodity: Commodity;
  price: number;
  price_date: string;
  source: string;
}

// Approximate 2026 base prices; a gentle deterministic wave gives a realistic
// 30-day series without pretending to be live market data.
const BASE: Record<Commodity, number> = { gold: 74000, silver: 92000 };

function seedSeries(days = 30): PriceRow[] {
  const rows: PriceRow[] = [];
  const today = new Date();
  for (const commodity of ["gold", "silver"] as Commodity[]) {
    const base = BASE[commodity];
    for (let d = days - 1; d >= 0; d--) {
      const date = new Date(today);
      date.setDate(today.getDate() - d);
      const wave = Math.sin((days - d) / 4) * 0.012 + Math.cos((days - d) / 9) * 0.006;
      rows.push({
        commodity,
        price: Math.round(base * (1 + wave)),
        price_date: date.toISOString().slice(0, 10),
        source: "MCX",
      });
    }
  }
  return rows;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));

      // Single manual entry.
      if (body?.commodity || body?.price || body?.price_date) {
        const { commodity, price, price_date } = body;
        if (!commodity || price == null || !price_date) {
          return json({ error: "commodity, price and price_date are required" }, 400);
        }
        if (!["gold", "silver"].includes(commodity)) {
          return json({ error: "commodity must be 'gold' or 'silver'" }, 400);
        }
        const { data, error } = await supabase
          .from("commodity_prices")
          .upsert({ commodity, price, price_date, source: "MCX" }, { onConflict: "commodity,price_date" })
          .select()
          .single();
        if (error) throw error;
        return json({ success: true, data });
      }

      // Bulk seed the recent series.
      const rows = seedSeries();
      const { error } = await supabase
        .from("commodity_prices")
        .upsert(rows, { onConflict: "commodity,price_date" });
      if (error) throw error;
      return json({ success: true, seeded: rows.length });
    }

    // GET → latest reading per commodity.
    const { data, error } = await supabase
      .from("commodity_prices")
      .select("*")
      .order("price_date", { ascending: false })
      .limit(2);
    if (error) throw error;
    return json({ data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: message }, 500);
  }
});
