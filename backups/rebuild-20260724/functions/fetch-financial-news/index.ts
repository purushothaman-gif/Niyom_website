import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface NewsArticle {
  title: string;
  description: string;
  content: string;
  url: string;
  image_url: string;
  source: string;
  category: string;
  published_at: string;
}

async function fetchFinancialNews(): Promise<NewsArticle[]> {
  const articles: NewsArticle[] = [];

  const categoryImages: Record<string, string[]> = {
    "stock market": [
      "https://images.pexels.com/photos/6801648/pexels-photo-6801648.jpeg",
      "https://images.pexels.com/photos/6802042/pexels-photo-6802042.jpeg",
      "https://images.pexels.com/photos/5912366/pexels-photo-5912366.jpeg",
      "https://images.pexels.com/photos/7621726/pexels-photo-7621726.jpeg",
      "https://images.pexels.com/photos/7567443/pexels-photo-7567443.jpeg",
      "https://images.pexels.com/photos/6771607/pexels-photo-6771607.jpeg",
      "https://images.pexels.com/photos/8761578/pexels-photo-8761578.jpeg",
      "https://images.pexels.com/photos/7621138/pexels-photo-7621138.jpeg"
    ],
    "IPO": [
      "https://images.pexels.com/photos/7788009/pexels-photo-7788009.jpeg",
      "https://images.pexels.com/photos/8353813/pexels-photo-8353813.jpeg",
      "https://images.pexels.com/photos/6801874/pexels-photo-6801874.jpeg",
      "https://images.pexels.com/photos/7567527/pexels-photo-7567527.jpeg",
      "https://images.pexels.com/photos/6771900/pexels-photo-6771900.jpeg",
      "https://images.pexels.com/photos/3943716/pexels-photo-3943716.jpeg",
      "https://images.pexels.com/photos/7567443/pexels-photo-7567443.jpeg",
      "https://images.pexels.com/photos/6772076/pexels-photo-6772076.jpeg"
    ],
    "investments": [
      "https://images.pexels.com/photos/7567486/pexels-photo-7567486.jpeg",
      "https://images.pexels.com/photos/7621133/pexels-photo-7621133.jpeg",
      "https://images.pexels.com/photos/6801874/pexels-photo-6801874.jpeg",
      "https://images.pexels.com/photos/5912366/pexels-photo-5912366.jpeg",
      "https://images.pexels.com/photos/7567527/pexels-photo-7567527.jpeg",
      "https://images.pexels.com/photos/6772076/pexels-photo-6772076.jpeg",
      "https://images.pexels.com/photos/6771900/pexels-photo-6771900.jpeg",
      "https://images.pexels.com/photos/3943716/pexels-photo-3943716.jpeg"
    ],
    "mutual funds": [
      "https://images.pexels.com/photos/6772076/pexels-photo-6772076.jpeg",
      "https://images.pexels.com/photos/7621133/pexels-photo-7621133.jpeg",
      "https://images.pexels.com/photos/7567486/pexels-photo-7567486.jpeg",
      "https://images.pexels.com/photos/6801874/pexels-photo-6801874.jpeg",
      "https://images.pexels.com/photos/3943716/pexels-photo-3943716.jpeg",
      "https://images.pexels.com/photos/6771900/pexels-photo-6771900.jpeg",
      "https://images.pexels.com/photos/7788009/pexels-photo-7788009.jpeg",
      "https://images.pexels.com/photos/7567527/pexels-photo-7567527.jpeg"
    ],
    "commodities": [
      "https://images.pexels.com/photos/6102538/pexels-photo-6102538.jpeg",
      "https://images.pexels.com/photos/8370752/pexels-photo-8370752.jpeg",
      "https://images.pexels.com/photos/4386467/pexels-photo-4386467.jpeg",
      "https://images.pexels.com/photos/7567443/pexels-photo-7567443.jpeg",
      "https://images.pexels.com/photos/6771607/pexels-photo-6771607.jpeg",
      "https://images.pexels.com/photos/5912366/pexels-photo-5912366.jpeg",
      "https://images.pexels.com/photos/7621726/pexels-photo-7621726.jpeg",
      "https://images.pexels.com/photos/6801648/pexels-photo-6801648.jpeg"
    ]
  };

  const usedImages = new Set<string>();

  function getImageForCategory(category: string, articleIndex: number): string {
    const images = categoryImages[category] || categoryImages["stock market"];

    let selectedImage = images[articleIndex % images.length];
    let attempts = 0;

    while (usedImages.has(selectedImage) && attempts < images.length) {
      articleIndex++;
      selectedImage = images[articleIndex % images.length];
      attempts++;
    }

    usedImages.add(selectedImage);
    return selectedImage;
  }

  const feeds = [
    {
      url: "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
      source: "Economic Times",
      category: "stock market"
    },
    {
      url: "https://economictimes.indiatimes.com/markets/ipo/rssfeeds/67656811.cms",
      source: "Economic Times",
      category: "IPO"
    },
    {
      url: "https://economictimes.indiatimes.com/wealth/invest/rssfeeds/837555174.cms",
      source: "Economic Times",
      category: "investments"
    },
    {
      url: "https://economictimes.indiatimes.com/mf/rssfeeds/46607993.cms",
      source: "Economic Times",
      category: "mutual funds"
    },
    {
      url: "https://economictimes.indiatimes.com/commoditiesmarkets/rssfeeds/1808152121.cms",
      source: "Economic Times",
      category: "commodities"
    }
  ];

  for (const feed of feeds) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(feed.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        const xmlText = await response.text();

        const items = xmlText.match(/<item>[\s\S]*?<\/item>/g) || [];

        for (let i = 0; i < Math.min(items.length, 8); i++) {
          const item = items[i];

          let title = '';
          let url = '';
          let description = '';
          let pubDate = new Date().toISOString();

          const titleMatch = item.match(/<title>(.*?)<\/title>/s);
          if (titleMatch) {
            title = titleMatch[1]
              .replace(/<!\[CDATA\[/, '')
              .replace(/\]\]>/, '')
              .trim();
          }

          const linkMatch = item.match(/<link>(.*?)<\/link>/s);
          const guidMatch = item.match(/<guid[^>]*>(.*?)<\/guid>/s);
          url = linkMatch ? linkMatch[1].trim() : (guidMatch ? guidMatch[1].trim() : '');

          const descCdata = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/s);
          const descPlain = item.match(/<description>(.*?)<\/description>/s);
          const rawDesc = descCdata ? descCdata[1] : (descPlain ? descPlain[1] : '');
          description = rawDesc.replace(/<[^>]*>/g, '').trim().substring(0, 300);

          const pubDateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/s);
          if (pubDateMatch) {
            try {
              pubDate = new Date(pubDateMatch[1]).toISOString();
            } catch {
              pubDate = new Date().toISOString();
            }
          }

          if (title && url && url.startsWith('http')) {
            articles.push({
              title: title.substring(0, 200),
              description: description || title.substring(0, 300),
              content: description || title,
              url,
              image_url: getImageForCategory(feed.category, articles.length),
              source: feed.source,
              category: feed.category,
              published_at: pubDate
            });
          }
        }

        console.log(`Fetched ${Math.min(items.length, 8)} articles from ${feed.source} (${feed.category})`);
      } else {
        console.log(`Failed to fetch from ${feed.source}: ${response.status}`);
      }
    } catch (error) {
      console.error(`Error fetching RSS from ${feed.source}:`, error);
    }
  }

  return articles;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Starting news fetch...");

    const articles = await fetchFinancialNews();

    if (articles.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No articles could be fetched from RSS feeds",
          fetched: 0,
          inserted: 0
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Fetched ${articles.length} total articles`);

    const uniqueArticles = new Map<string, NewsArticle>();
    for (const article of articles) {
      if (!uniqueArticles.has(article.url)) {
        uniqueArticles.set(article.url, article);
      }
    }

    const uniqueArticlesList = Array.from(uniqueArticles.values());
    uniqueArticlesList.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());

    const { data: existingNews } = await supabase
      .from("news")
      .select("url")
      .in("url", uniqueArticlesList.map(a => a.url));

    const existingUrls = new Set(existingNews?.map(n => n.url) || []);
    const newArticles = uniqueArticlesList.filter(a => !existingUrls.has(a.url));

    if (newArticles.length > 0) {
      const { error: insertError } = await supabase
        .from("news")
        .insert(newArticles);

      if (insertError) {
        console.error("Error inserting news:", insertError);
        throw insertError;
      }

      console.log(`Successfully inserted ${newArticles.length} new articles`);
    } else {
      console.log("No new articles to insert");
    }

    return new Response(
      JSON.stringify({
        success: true,
        fetched: uniqueArticlesList.length,
        inserted: newArticles.length,
        sources: "Economic Times RSS Feeds",
        message: `Fetched ${uniqueArticlesList.length} articles, inserted ${newArticles.length} new ones`
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error in fetch-financial-news:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
