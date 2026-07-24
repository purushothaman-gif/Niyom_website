import { useCallback, useEffect, useState } from 'react';
import { Newspaper, RefreshCw, ExternalLink, Clock, AlertCircle } from 'lucide-react';
import { PublicPageChrome } from './shared/PublicPageChrome';
import { newsSource, type NewsArticle } from './shared/newsSource';

/**
 * Public financial news feed. All data access goes through `newsSource`
 * (see shared/newsSource.ts), so a real news API can replace the current
 * Supabase-backed source without touching this component.
 */

const FALLBACK_IMAGE =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#0b2244"/><text x="50%" y="50%" fill="#d8bd86" font-family="sans-serif" font-size="20" text-anchor="middle" dominant-baseline="middle">Niyom Wealth</text></svg>`,
  );

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function CategoryBadge({ category }: { category: string | null }) {
  if (!category) return null;
  return (
    <span
      className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: 'rgba(var(--accent-soft-rgb),0.14)', color: 'rgb(var(--accent-soft-rgb))' }}
    >
      {category}
    </span>
  );
}

function ArticleCard({ article }: { article: NewsArticle }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <article
      className="lift group rounded-2xl overflow-hidden flex flex-col h-full"
      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="relative h-44 overflow-hidden" style={{ background: 'var(--bg-raised)' }}>
        <img
          src={imgOk && article.image_url ? article.image_url : FALLBACK_IMAGE}
          alt=""
          loading="lazy"
          onError={() => setImgOk(false)}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute top-3 left-3"><CategoryBadge category={article.category} /></div>
      </div>
      <div className="p-5 flex flex-col flex-1">
        <h3 className="text-base font-bold text-text-primary leading-snug mb-2 line-clamp-2" style={{ fontFamily: 'var(--font-display)' }}>
          {article.title}
        </h3>
        {article.description && (
          <p className="text-sm text-text-secondary leading-relaxed mb-4 line-clamp-3 flex-1">{article.description}</p>
        )}
        <div className="flex items-center justify-between mt-auto pt-3 border-t border-border-subtle">
          <div className="flex items-center gap-2 text-xs text-text-muted min-w-0">
            {article.source && <span className="truncate font-medium">{article.source}</span>}
            <span className="inline-flex items-center gap-1 flex-shrink-0"><Clock size={12} /> {relativeTime(article.published_at)}</span>
          </div>
          {article.url && (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-accent-soft hover:underline flex-shrink-0"
            >
              Read <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-2xl overflow-hidden animate-pulse" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
      <div className="h-44" style={{ background: 'var(--bg-raised)' }} />
      <div className="p-5 space-y-3">
        <div className="h-4 rounded w-3/4" style={{ background: 'var(--bg-raised)' }} />
        <div className="h-3 rounded w-full" style={{ background: 'var(--bg-raised)' }} />
        <div className="h-3 rounded w-2/3" style={{ background: 'var(--bg-raised)' }} />
      </div>
    </div>
  );
}

interface NewsProps {
  onBack: () => void;
}

export default function News({ onBack }: NewsProps) {
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [category, setCategory] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (cat: string) => {
    setLoading(true);
    setError(null);
    try {
      setArticles(await newsSource.list({ category: cat }));
    } catch {
      setError('Unable to load news right now. Please try again shortly.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(category);
  }, [category, load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setNotice(null);
    setError(null);
    try {
      const result = await newsSource.refresh();
      await load(category);
      setNotice(`Updated — ${result.inserted} new article${result.inserted === 1 ? '' : 's'} added.`);
    } catch {
      setError('Refresh failed. Please try again shortly.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <PublicPageChrome
      onBack={onBack}
      eyebrow="Market News"
      icon={Newspaper}
      title="Financial news, curated for investors"
      subtitle="Stay ahead with the latest from the markets, IPOs, commodities, mutual funds and unlisted shares."
      documentTitle="Market News — Niyom Wealth"
      actions={
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="lift press inline-flex items-center gap-2 bg-accent-soft hover:bg-accent-soft-deep text-black font-semibold px-5 py-2.5 rounded-xl shadow-md disabled:opacity-60"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh feed'}
        </button>
      }
    >
      {/* Category filter */}
      <div className="flex flex-wrap gap-2 mb-6" role="tablist" aria-label="News category">
        {newsSource.categories.map((cat) => {
          const selected = cat === category;
          return (
            <button
              key={cat}
              role="tab"
              aria-selected={selected}
              onClick={() => setCategory(cat)}
              className="press capitalize text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
              style={
                selected
                  ? { background: 'rgb(var(--accent-soft-rgb))', color: 'var(--text-on-accent)' }
                  : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }
              }
            >
              {cat}
            </button>
          );
        })}
      </div>

      {notice && (
        <div className="mb-6 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(var(--success-soft-rgb),0.12)', color: 'rgb(var(--success-soft-rgb))', border: '1px solid rgba(var(--success-soft-rgb),0.3)' }}>
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(var(--danger-soft-rgb),0.12)', color: 'rgb(var(--danger-soft-rgb))', border: '1px solid rgba(var(--danger-soft-rgb),0.3)' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : articles.length === 0 ? (
        <div className="text-center py-20">
          <Newspaper className="w-12 h-12 mx-auto text-text-faint mb-4" />
          <p className="text-text-secondary font-medium">No articles in this category yet.</p>
          <p className="text-text-muted text-sm mt-1">Try refreshing the feed or picking another category.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {articles.map((a) => <ArticleCard key={a.id} article={a} />)}
        </div>
      )}
    </PublicPageChrome>
  );
}
