import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * fetch-financial-news
 * --------------------
 * Pulls REAL financial news from Economic Times RSS feeds, parses the items,
 * and inserts new articles into the `news` table used by the public News page.
 * Dedupes by URL so repeated calls only add genuinely new stories.
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

// Google News RSS search feed for a topic query, scoped to India / English.
// Used for categories whose dedicated publisher feeds are unreliable.
const googleNews = (query: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;

// News feeds mapped onto the News page's filter categories. Economic Times RSS
// covers stock market + commodities. The ET IPO and mutual-fund category feeds
// return no items, so those two use Google News RSS topic search (India/EN),
// which is reliable and not IP-blocked (Moneycontrol / Business Standard 403).
const FEEDS: { url: string; source: string; category: string; google?: boolean }[] = [
  { url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", source: "Economic Times", category: "stock market" },
  { url: "https://economictimes.indiatimes.com/wealth/invest/rssfeeds/837555174.cms", source: "Economic Times", category: "stock market" },
  { url: "https://economictimes.indiatimes.com/commoditiesmarkets/rssfeeds/1808152121.cms", source: "Economic Times", category: "commodities" },
  { url: googleNews("India IPO GMP listing subscription allotment when:7d"), source: "Google News", category: "IPO", google: true },
  { url: googleNews("mutual fund India SIP NFO when:7d"), source: "Google News", category: "mutual funds", google: true },
];

// Per-category fallback images used when an RSS item carries none (e.g. Google
// News items have no image). A pool per category — picked deterministically from
// the article URL — so cards don't all share one image. The News page also
// renders its own branded placeholder if an image fails to load.
const px = (id: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=800`;

const CATEGORY_IMAGES: Record<string, string[]> = {
  "stock market": [6801648, 187041, 210607, 159888, 5980856, 6770610].map(px),
  "IPO": [7788009, 6266285, 5716001, 3943716, 8353802, 4386370].map(px),
  "mutual funds": [6772076, 4386366, 5849577, 6289065, 4968630, 259027].map(px),
  "commodities": [259165, 730547, 259200, 6801874, 7567443, 4968391].map(px),
};

// Stable 32-bit string hash (FNV-1a) so a given article URL always maps to the
// same pooled image across refreshes.
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const first = (s: string, re: RegExp): string | null => {
  const m = s.match(re);
  return m ? m[1] : null;
};

const clean = (s: string) =>
  s.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/<[^>]*>/g, "").trim();

function parseFeed(xml: string, feed: { source: string; category: string; google?: boolean }): Article[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const out: Article[] = [];

  for (const item of items.slice(0, 20)) {
    let title = clean(first(item, /<title>([\s\S]*?)<\/title>/) ?? "");
    const link = (first(item, /<link>([\s\S]*?)<\/link>/) ?? first(item, /<guid[^>]*>([\s\S]*?)<\/guid>/) ?? "").trim();
    let description = clean(first(item, /<description>([\s\S]*?)<\/description>/) ?? "").slice(0, 300);
    let source = feed.source;

    // Google News titles are "Headline - Publisher" and descriptions are a
    // related-articles blob; pull out the real publisher and drop the blob so
    // the card falls back to the clean headline.
    if (feed.google) {
      const dash = title.lastIndexOf(" - ");
      if (dash > 0) {
        source = title.slice(dash + 3).trim() || feed.source;
        title = title.slice(0, dash).trim();
      }
      description = "";
    }

    let publishedAt = new Date().toISOString();
    const pub = first(item, /<pubDate>([\s\S]*?)<\/pubDate>/);
    if (pub) {
      const d = new Date(pub);
      if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
    }

    const pool = CATEGORY_IMAGES[feed.category] ?? CATEGORY_IMAGES["stock market"];
    const image =
      first(item, /<enclosure[^>]*url="([^"]+)"/) ??
      first(item, /<media:content[^>]*url="([^"]+)"/) ??
      pool[hashStr(link) % pool.length];

    if (title && link.startsWith("http")) {
      out.push({
        title: title.slice(0, 200),
        description: description || title.slice(0, 300),
        content: description || title,
        url: link,
        image_url: image,
        source,
        category: feed.category,
        published_at: publishedAt,
      });
    }
  }
  return out;
}

async function fetchFeed(feed: { url: string; source: string; category: string; google?: boolean }): Promise<Article[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(feed.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`Feed ${feed.source}/${feed.category} returned ${res.status}`);
      return [];
    }
    return parseFeed(await res.text(), feed);
  } catch (err) {
    console.error(`Feed ${feed.source}/${feed.category} failed:`, err);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Fetch all feeds in parallel, then dedupe by URL.
    const results = await Promise.all(FEEDS.map(fetchFeed));
    const byUrl = new Map<string, Article>();
    for (const article of results.flat()) {
      if (!byUrl.has(article.url)) byUrl.set(article.url, article);
    }
    const articles = [...byUrl.values()].sort(
      (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
    );

    if (articles.length === 0) {
      return json({ success: false, fetched: 0, inserted: 0, sources: "Economic Times + Google News RSS", message: "No articles fetched (feeds unreachable)" });
    }

    // Purge the earlier placeholder seed (fake articles used news.niyomwealth.com URLs).
    await supabase.from("news").delete().like("url", "https://news.niyomwealth.com/%");

    // Insert only URLs we don't already have. We fetch all existing URLs (the
    // table is capped at ~20/category, so this is a small, bounded query) rather
    // than filtering with `.in(...)` — Google News URLs are ~600 chars each and
    // would overflow the request URL length.
    const { data: existing, error: selError } = await supabase
      .from("news")
      .select("url")
      .limit(2000);
    if (selError) throw selError;

    const known = new Set((existing ?? []).map((r: { url: string }) => r.url));
    const fresh = articles.filter((a) => !known.has(a.url));

    if (fresh.length > 0) {
      const { error: insError } = await supabase.from("news").insert(fresh);
      if (insError) throw insError;
    }

    // Keep only the newest 20 articles per category; older ones auto-delete.
    await supabase.rpc("prune_news_to_cap", { max_per_category: 20 });

    return json({
      success: true,
      fetched: articles.length,
      inserted: fresh.length,
      sources: "Economic Times + Google News RSS",
      message: `Fetched ${articles.length} articles, inserted ${fresh.length} new`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ success: false, error: message }, 500);
  }
});
