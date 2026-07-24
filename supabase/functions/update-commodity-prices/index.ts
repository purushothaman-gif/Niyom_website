import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * update-commodity-prices
 * -----------------------
 * Maintains the `commodity_prices` table (gold per 10g, silver per kg) shown on
 * the public Learning page.
 *
 * Live source: metalpriceapi.com. Set the Supabase secret `METALS_API_KEY`:
 *     supabase secrets set METALS_API_KEY=your_key
 * (free tier: https://metalpriceapi.com). The API returns INTERNATIONAL SPOT per
 * troy ounce; we convert to Indian retail units (gold/10g, silver/kg) AND to
 * Indian retail rates by adding import duty + GST + a market premium. All factors
 * are env-overridable: METAL_IMPORT_DUTY, METAL_GST, GOLD_MARKET_PREMIUM,
 * SILVER_MARKET_PREMIUM.
 *
 * POST {}                                → fetch live prices for today (needs key).
 *                                          Without a key, clears any placeholder
 *                                          rows and reports that the key is unset.
 * POST { commodity, price, price_date }  → manual single upsert (source 'manual').
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

const OZ_TO_GRAM = 31.1034768; // one troy ounce in grams

// deno-lint-ignore no-explicit-any
function createDb() {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}

/** Remove the earlier synthetic seed (source 'MCX') so no placeholder prices linger. */
async function purgePlaceholder(db: ReturnType<typeof createDb>) {
  await db.from("commodity_prices").delete().eq("source", "MCX");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const db = createDb();

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));

      // Manual single entry.
      if (body?.commodity || body?.price || body?.price_date) {
        const { commodity, price, price_date } = body;
        if (!commodity || price == null || !price_date) {
          return json({ error: "commodity, price and price_date are required" }, 400);
        }
        if (!["gold", "silver"].includes(commodity)) {
          return json({ error: "commodity must be 'gold' or 'silver'" }, 400);
        }
        const { data, error } = await db
          .from("commodity_prices")
          .upsert({ commodity, price, price_date, source: "manual" }, { onConflict: "commodity,price_date" })
          .select()
          .single();
        if (error) throw error;
        return json({ success: true, data });
      }

      // Live fetch.
      const key = Deno.env.get("METALS_API_KEY");
      if (!key) {
        await purgePlaceholder(db);
        return json({
          success: false,
          message: "METALS_API_KEY is not set. Placeholder prices cleared. Set the secret and re-run for live prices.",
        }, 200);
      }

      const url = `https://api.metalpriceapi.com/v1/latest?api_key=${key}&base=INR&currencies=XAU,XAG`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`metalpriceapi returned ${res.status}`);
      const payload = await res.json();
      const rates = payload?.rates;
      if (!rates || typeof rates.XAU !== "number" || typeof rates.XAG !== "number") {
        throw new Error("Unexpected metalpriceapi response (missing XAU/XAG rates)");
      }

      // rates.X = troy ounces of metal per 1 INR → INR per troy ounce = 1 / rate.
      // metalpriceapi returns INTERNATIONAL SPOT (INR/troy-oz). Indian retail
      // rates add import duty + GST + a market/dealer premium, so convert spot →
      // Indian rate. Every factor is env-overridable for easy tuning.
      const num = (name: string, def: number) => Number(Deno.env.get(name) ?? def);
      const IMPORT_DUTY = num("METAL_IMPORT_DUTY", 0.06); // 6% customs duty
      const GST = num("METAL_GST", 0.03);                 // 3% GST
      const GOLD_PREMIUM = num("GOLD_MARKET_PREMIUM", 0.03);
      const SILVER_PREMIUM = num("SILVER_MARKET_PREMIUM", 0.19);
      const indiaFactor = (premium: number) => (1 + IMPORT_DUTY) * (1 + GST) * (1 + premium);

      const goldPerOz = 1 / rates.XAU;
      const silverPerOz = 1 / rates.XAG;
      const priceDate = new Date().toISOString().slice(0, 10);

      const rows = [
        { commodity: "gold", price: Math.round((goldPerOz / OZ_TO_GRAM) * 10 * indiaFactor(GOLD_PREMIUM)), price_date: priceDate, source: "metalpriceapi" },
        { commodity: "silver", price: Math.round((silverPerOz / OZ_TO_GRAM) * 1000 * indiaFactor(SILVER_PREMIUM)), price_date: priceDate, source: "metalpriceapi" },
      ];

      const { error } = await db
        .from("commodity_prices")
        .upsert(rows, { onConflict: "commodity,price_date" });
      if (error) throw error;

      await purgePlaceholder(db);
      return json({ success: true, updated: rows.length, prices: rows });
    }

    // GET → latest reading per commodity.
    const { data, error } = await db
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
