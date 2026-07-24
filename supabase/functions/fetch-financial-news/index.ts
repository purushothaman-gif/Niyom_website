import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * fetch-financial-news
 * --------------------
 * Populates the `news` table used by the public News page. Currently generates
 * a curated set of illustrative articles (no external API); it dedupes by URL
 * so repeated calls only insert genuinely new items. To integrate a real feed,
 * replace `buildArticles()` with your provider's fetch + mapping — the response
 * contract ({ fetched, inserted, sources }) stays the same.
 *
 * POST → { success, fetched, inserted, sources, message }.
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

interface Article {
  title: string;
  description: string;
  content: string;
  url: string;
  image_url: string;
  source: string;
  category: string;
  published_at: string;
}

const IMG = "https://images.pexels.com/photos/6801648/pexels-photo-6801648.jpeg";

// Curated sample set spanning the categories the UI filters by. `published_at`
// is spread across recent days so the feed looks natural; URLs are stable so
// re-running the function does not create duplicates.
const SEED: Omit<Article, "published_at" | "image_url">[] = [
  { title: "Sensex and Nifty end higher as banking stocks rally", description: "Frontline indices closed in the green led by gains in financials and IT.", content: "Indian benchmark indices advanced as buying in banking and IT majors lifted sentiment through the session.", url: "https://news.niyomwealth.com/markets/indices-rally-banking", source: "Market Desk", category: "stock market" },
  { title: "Auto stocks in focus ahead of monthly sales data", description: "Investors eye volume numbers from leading auto makers.", content: "Auto counters saw active interest as the street positioned ahead of the monthly wholesale dispatch figures.", url: "https://news.niyomwealth.com/markets/auto-sales-preview", source: "Market Desk", category: "stock market" },
  { title: "Tech unicorn files draft papers for ₹4,000 crore IPO", description: "The offer includes a fresh issue and an offer for sale by early backers.", content: "A homegrown technology firm has filed its draft red herring prospectus for a public issue expected later this year.", url: "https://news.niyomwealth.com/ipo/tech-unicorn-drhp", source: "IPO Watch", category: "IPO" },
  { title: "SME IPO subscribed 30x on final day", description: "Strong retail and HNI demand drives heavy oversubscription.", content: "The small and medium enterprise offering saw robust demand across investor categories on its concluding day.", url: "https://news.niyomwealth.com/ipo/sme-oversubscribed", source: "IPO Watch", category: "IPO" },
  { title: "Gold holds near record as investors seek safety", description: "Bullion steadies with global cues and a softer rupee in play.", content: "Spot gold traded firm as safe-haven demand and currency moves supported prices in the domestic market.", url: "https://news.niyomwealth.com/commodities/gold-record-safety", source: "Commodity Desk", category: "commodities" },
  { title: "Silver outperforms as industrial demand strengthens", description: "The white metal gains on solar and electronics consumption.", content: "Silver extended gains on the back of firm industrial off-take alongside its role as a precious metal.", url: "https://news.niyomwealth.com/commodities/silver-industrial-demand", source: "Commodity Desk", category: "commodities" },
  { title: "Equity mutual fund inflows stay strong for the ninth month", description: "SIP contributions touch a fresh high, industry data shows.", content: "Net inflows into equity schemes remained healthy as systematic investment plan contributions scaled a new record.", url: "https://news.niyomwealth.com/mf/equity-inflows-record", source: "Fund Flows", category: "mutual funds" },
  { title: "New flexi-cap fund opens for subscription", description: "The NFO targets diversification across market capitalisations.", content: "A leading asset manager launched a new flexi-cap offering aimed at investors seeking across-the-board equity exposure.", url: "https://news.niyomwealth.com/mf/flexicap-nfo", source: "Fund Flows", category: "mutual funds" },
  { title: "Debt funds see renewed interest as yields stabilise", description: "Investors return to fixed-income schemes amid rate calm.", content: "Fixed-income funds attracted fresh allocations as bond yields steadied, improving the outlook for accrual strategies.", url: "https://news.niyomwealth.com/mf/debt-funds-interest", source: "Fund Flows", category: "mutual funds" },
  { title: "Pre-IPO shares of consumer brand see active demand", description: "Unlisted market values the company at a premium to peers.", content: "Interest in the unlisted equity of a fast-growing consumer brand rose as investors sought exposure ahead of a potential listing.", url: "https://news.niyomwealth.com/unlisted/consumer-brand-demand", source: "Unlisted Desk", category: "unlisted shares" },
  { title: "Unlisted shares: what investors should know about liquidity", description: "Understanding exit routes and pricing in private markets.", content: "Participation in unlisted shares offers growth potential but requires awareness of lower liquidity and valuation nuances.", url: "https://news.niyomwealth.com/unlisted/liquidity-explainer", source: "Unlisted Desk", category: "unlisted shares" },
  { title: "RBI holds policy rate; markets react positively", description: "The central bank keeps its stance unchanged as expected.", content: "Equity and bond markets welcomed the monetary policy decision as the rate-setting panel maintained the status quo.", url: "https://news.niyomwealth.com/markets/rbi-policy-hold", source: "Market Desk", category: "stock market" },
];

function buildArticles(): Article[] {
  const now = Date.now();
  return SEED.map((a, i) => ({
    ...a,
    image_url: IMG,
    // Stagger published_at a few hours apart across recent days.
    published_at: new Date(now - i * 7 * 3600 * 1000).toISOString(),
  }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const articles = buildArticles();

    // Insert only URLs we don't already have.
    const { data: existing, error: selError } = await supabase
      .from("news")
      .select("url")
      .in("url", articles.map((a) => a.url));
    if (selError) throw selError;

    const known = new Set((existing ?? []).map((r) => r.url));
    const fresh = articles.filter((a) => !known.has(a.url));

    if (fresh.length > 0) {
      const { error: insError } = await supabase.from("news").insert(fresh);
      if (insError) throw insError;
    }

    return json({
      success: true,
      fetched: articles.length,
      inserted: fresh.length,
      sources: "Niyom Curated Feed",
      message: `Fetched ${articles.length} articles, inserted ${fresh.length} new`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ success: false, error: message }, 500);
  }
});
