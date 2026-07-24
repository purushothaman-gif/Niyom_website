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

// Economic Times RSS feeds mapped onto the News page's filter categories.
const FEEDS: { url: string; source: string; category: string }[] = [
  { url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms", source: "Economic Times", category: "stock market" },
  { url: "https://economictimes.indiatimes.com/markets/ipo/rssfeeds/67656811.cms", source: "Economic Times", category: "IPO" },
  { url: "https://economictimes.indiatimes.com/wealth/invest/rssfeeds/837555174.cms", source: "Economic Times", category: "stock market" },
  { url: "https://economictimes.indiatimes.com/mf/rssfeeds/46607993.cms", source: "Economic Times", category: "mutual funds" },
  { url: "https://economictimes.indiatimes.com/commoditiesmarkets/rssfeeds/1808152121.cms", source: "Economic Times", category: "commodities" },
];

// Per-category fallback image when an RSS item carries none. The News page also
// renders its own branded placeholder if the image fails to load.
const CATEGORY_IMAGE: Record<string, string> = {
  "stock market": "https://images.pexels.com/photos/6801648/pexels-photo-6801648.jpeg",
  "IPO": "https://images.pexels.com/photos/7788009/pexels-photo-7788009.jpeg",
  "mutual funds": "https://images.pexels.com/photos/6772076/pexels-photo-6772076.jpeg",
  "commodities": "https://images.pexels.com/photos/6102538/pexels-photo-6102538.jpeg",
};

const first = (s: string, re: RegExp): string | null => {
  const m = s.match(re);
  return m ? m[1] : null;
};

const clean = (s: string) =>
  s.replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/<[^>]*>/g, "").trim();

function parseFeed(xml: string, feed: { source: string; category: string }): Article[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const out: Article[] = [];

  for (const item of items.slice(0, 10)) {
    const title = clean(first(item, /<title>([\s\S]*?)<\/title>/) ?? "");
    const link = (first(item, /<link>([\s\S]*?)<\/link>/) ?? first(item, /<guid[^>]*>([\s\S]*?)<\/guid>/) ?? "").trim();
    const description = clean(first(item, /<description>([\s\S]*?)<\/description>/) ?? "").slice(0, 300);

    let publishedAt = new Date().toISOString();
    const pub = first(item, /<pubDate>([\s\S]*?)<\/pubDate>/);
    if (pub) {
      const d = new Date(pub);
      if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
    }

    const image =
      first(item, /<enclosure[^>]*url="([^"]+)"/) ??
      first(item, /<media:content[^>]*url="([^"]+)"/) ??
      CATEGORY_IMAGE[feed.category] ??
      CATEGORY_IMAGE["stock market"];

    if (title && link.startsWith("http")) {
      out.push({
        title: title.slice(0, 200),
        description: description || title.slice(0, 300),
        content: description || title,
        url: link,
        image_url: image,
        source: feed.source,
        category: feed.category,
        published_at: publishedAt,
      });
    }
  }
  return out;
}

async function fetchFeed(feed: { url: string; source: string; category: string }): Promise<Article[]> {
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
      return json({ success: false, fetched: 0, inserted: 0, sources: "Economic Times RSS", message: "No articles fetched (feeds unreachable)" });
    }

    // Purge the earlier placeholder seed (fake articles used news.niyomwealth.com URLs).
    await supabase.from("news").delete().like("url", "https://news.niyomwealth.com/%");

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
      sources: "Economic Times RSS",
      message: `Fetched ${articles.length} articles, inserted ${fresh.length} new`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ success: false, error: message }, 500);
  }
});
