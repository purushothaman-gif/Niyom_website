import { supabase } from '../../lib/supabase';

/**
 * News data-source abstraction.
 *
 * The News page depends only on the `NewsSource` interface, never on Supabase
 * directly. To integrate a real news API later, implement `NewsSource` against
 * that API and export it as `newsSource` — the page needs no changes.
 */

export interface NewsArticle {
  id: string;
  title: string;
  description: string | null;
  content: string | null;
  url: string | null;
  image_url: string | null;
  source: string | null;
  category: string | null;
  published_at: string;
  created_at: string;
}

export interface NewsListOptions {
  /** Category filter; omit or 'all' for everything. */
  category?: string;
  /** Max articles to return. */
  limit?: number;
  /** Only articles published within the last N days. */
  withinDays?: number;
}

export interface RefreshResult {
  fetched: number;
  inserted: number;
  sources?: string;
}

export interface NewsSource {
  /** Curated categories the UI can filter by (first entry should be 'all'). */
  categories: string[];
  /** Fetch articles, newest first. */
  list(options?: NewsListOptions): Promise<NewsArticle[]>;
  /** Trigger a server-side refresh of the underlying feed. */
  refresh(): Promise<RefreshResult>;
}

export const NEWS_CATEGORIES = [
  'all',
  'stock market',
  'IPO',
  'commodities',
  'mutual funds',
  'unlisted shares',
];

// RSS titles/descriptions arrive HTML-escaped (e.g. `&amp;`, `&#39;`, `&#8217;`).
// Decode them so cards render "M&M", "Q2's" rather than the raw entities.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

/** Default implementation backed by the `news` table + `fetch-financial-news`. */
class SupabaseNewsSource implements NewsSource {
  categories = NEWS_CATEGORIES;

  async list(options: NewsListOptions = {}): Promise<NewsArticle[]> {
    const { category, withinDays = 30 } = options;
    // A specific category is capped at 20 articles; the 'all' view shows the
    // aggregate across categories (each of which the backend caps at 20).
    const specific = Boolean(category && category !== 'all');
    const limit = options.limit ?? (specific ? 20 : 100);

    let query = supabase
      .from('news')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(limit);

    if (withinDays) {
      const since = new Date();
      since.setDate(since.getDate() - withinDays);
      query = query.gte('published_at', since.toISOString());
    }
    if (category && category !== 'all') {
      query = query.eq('category', category);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => ({
      ...(row as NewsArticle),
      title: decodeEntities((row as NewsArticle).title),
      description: (row as NewsArticle).description
        ? decodeEntities((row as NewsArticle).description as string)
        : (row as NewsArticle).description,
    })) as NewsArticle[];
  }

  async refresh(): Promise<RefreshResult> {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const res = await fetch(`${url}/functions/v1/fetch-financial-news`, { method: 'POST' });
    if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
    const json = await res.json();
    return { fetched: json.fetched ?? 0, inserted: json.inserted ?? 0, sources: json.sources };
  }
}

export const newsSource: NewsSource = new SupabaseNewsSource();
