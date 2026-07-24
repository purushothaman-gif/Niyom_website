import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

/**
 * 404 page. The SPA host rewrites every path to index.html (HTTP 200), so a
 * genuinely-broken link renders this instead of silently redirecting home —
 * broken internal links stay visible. Sets a temporary noindex while mounted so
 * search engines don't index unknown URLs.
 */
export function NotFound() {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Page not found — Niyom Wealth Distribution LLP';
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex';
    document.head.appendChild(robots);
    return () => {
      document.title = prevTitle;
      if (robots.parentNode) robots.parentNode.removeChild(robots);
    };
  }, []);

  return (
    <div className="min-h-screen bg-bg-base flex flex-col items-center justify-center px-6 text-center">
      <p className="text-accent-soft text-sm font-semibold uppercase tracking-widest mb-3">Error 404</p>
      <h1 className="text-4xl sm:text-5xl font-bold text-text-strong mb-4" style={{ fontFamily: 'var(--font-display)' }}>
        Page not found
      </h1>
      <p className="text-text-muted max-w-md mb-8">
        The page you're looking for doesn't exist or may have moved.
      </p>
      <Link
        to="/"
        className="lift press inline-flex items-center gap-2 bg-accent-soft hover:bg-accent-soft-deep text-black px-6 py-3 rounded-xl font-semibold shadow-md"
      >
        <Home size={18} /> Back to Home
      </Link>
    </div>
  );
}

export default NotFound;
