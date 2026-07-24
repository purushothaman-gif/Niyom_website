import { useEffect, useState } from 'react';
import { Newspaper, RefreshCw, TrendingUp, Clock, ExternalLink, ArrowLeft, Menu, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Logo } from '../components/Logo';

interface NewsArticle {
  id: string;
  title: string;
  description: string;
  content: string;
  url: string;
  image_url: string;
  source: string;
  category: string;
  published_at: string;
  created_at: string;
}

interface NewsProps {
  onBack: () => void;
}

export default function News({ onBack }: NewsProps) {
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [successMessage, setSuccessMessage] = useState<string>('');

  const categories = ['all', 'stock market', 'IPO', 'commodities', 'mutual funds', 'unlisted shares'];

  useEffect(() => {
    fetchNews();

    const interval = setInterval(() => {
      refreshNews();
    }, 6 * 60 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  const fetchNews = async () => {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await supabase
        .from('news')
        .select('*')
        .gte('published_at', thirtyDaysAgo.toISOString())
        .order('published_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      setNews(data || []);
    } catch (error) {
      console.error('Error fetching news:', error);
    } finally {
      setLoading(false);
    }
  };

  const refreshNews = async () => {
    setRefreshing(true);
    setSuccessMessage('');
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const response = await fetch(`${supabaseUrl}/functions/v1/fetch-financial-news`, {
        method: 'POST',
      });

      if (response.ok) {
        const result = await response.json();
        await fetchNews();
        setLastUpdated(new Date());
        const sourceInfo = result.sources ? ` from ${result.sources}` : '';
        setSuccessMessage(`Successfully fetched ${result.fetched} articles${sourceInfo}, ${result.inserted} new articles added`);
        setTimeout(() => setSuccessMessage(''), 6000);
      } else {
        console.error('Failed to refresh news:', response.statusText);
        setSuccessMessage('Failed to refresh news. Please try again.');
        setTimeout(() => setSuccessMessage(''), 5000);
      }
    } catch (error) {
      console.error('Error refreshing news:', error);
      setSuccessMessage('Error refreshing news. Please check your connection.');
      setTimeout(() => setSuccessMessage(''), 5000);
    } finally {
      setRefreshing(false);
    }
  };

  const filteredNews = selectedCategory === 'all'
    ? news
    : news.filter(article => article.category === selectedCategory);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const getCategoryColor = (category: string) => {
    const colors: { [key: string]: string } = {
      'stock market': 'bg-blue-100 text-blue-800',
      'IPO': 'bg-green-100 text-green-800',
      'commodities': 'bg-yellow-100 text-yellow-800',
      'mutual funds': 'bg-indigo-100 text-indigo-800',
      'unlisted shares': 'bg-orange-100 text-orange-800',
    };
    return colors[category] || 'bg-bg-raised text-text-primary';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base">
      <nav className="bg-black shadow-lg border-b border-accent-soft/20 sticky top-0 z-50 relative">
        <div className="max-w-7xl mx-auto px-6 py-5 flex justify-between items-center">
          <button
            onClick={onBack}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <Logo size="md" />
            <div className="text-left">
              <h1 className="text-2xl font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>Financial News & Information</h1>
              <p className="text-accent-soft text-xs tracking-wider">NIYOM WEALTH</p>
            </div>
          </button>

          <button
            onClick={onBack}
            className="hidden md:flex items-center gap-2 bg-accent-soft hover:bg-accent-soft-deep text-black px-5 py-2.5 rounded-lg transition-all duration-300 font-semibold shadow-md"
          >
            <ArrowLeft size={18} />
            Back to Home
          </button>

          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden text-white hover:text-accent-soft transition-colors"
          >
            {isMobileMenuOpen ? <X size={28} /> : <Menu size={28} />}
          </button>
        </div>

        {isMobileMenuOpen && (
          <div className="md:hidden absolute top-full left-0 right-0 bg-black border-t border-accent-soft/20 shadow-lg z-50">
            <div className="flex flex-col p-4 space-y-3">
              <button
                onClick={() => {
                  onBack();
                  setIsMobileMenuOpen(false);
                }}
                className="flex items-center gap-2 bg-accent-soft hover:bg-accent-soft-deep text-black px-4 py-3 rounded-lg transition-all duration-300 font-semibold"
              >
                <ArrowLeft size={18} />
                Back to Home
              </button>
            </div>
          </div>
        )}
      </nav>

      <div className="max-w-7xl mx-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-text-primary flex items-center gap-3">
              <Newspaper className="w-10 h-10 text-blue-600" />
              Financial News & Information
            </h1>
            <p className="text-text-secondary mt-2">
              Latest market news for your information and awareness
              {lastUpdated && (
                <span className="ml-2 text-sm">
                  • Last updated: {lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </p>
            <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3 max-w-3xl">
              <p className="text-sm text-yellow-900">
                <strong>Disclaimer:</strong> News articles are for informational purposes only and do not constitute investment advice or recommendations. We are not SEBI Registered Investment Advisers.
              </p>
            </div>
          </div>
          <button
            onClick={refreshNews}
            disabled={refreshing}
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
          >
            <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh News'}
          </button>
        </div>

        {successMessage && (
          <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3 animate-fadeIn">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <p className="text-sm text-green-800 font-medium">{successMessage}</p>
          </div>
        )}

        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-4 py-2 rounded-full whitespace-nowrap transition-colors ${
                selectedCategory === category
                  ? 'bg-blue-600 text-white'
                  : 'bg-bg-elevated text-text-secondary hover:bg-bg-raised'
              }`}
            >
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
          ))}
        </div>

        {filteredNews.length === 0 ? (
          <div className="bg-bg-elevated rounded-2xl shadow-sm p-12 text-center">
            <Newspaper className="w-16 h-16 text-text-muted mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-text-primary mb-2">No news available</h3>
            <p className="text-text-secondary mb-4">Click "Refresh News" to fetch the latest articles</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredNews.map((article) => (
              <div
                key={article.id}
                className="bg-bg-elevated rounded-2xl shadow-sm overflow-hidden hover:shadow-lg transition-shadow"
              >
                <div className="p-6">
                  <div className="mb-4">
                    <h2 className={`text-xl font-bold mb-3 px-4 py-2 rounded-lg inline-block ${getCategoryColor(article.category)}`}>
                      {article.category.toUpperCase()}
                    </h2>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <span className="flex items-center gap-1 text-xs text-text-muted">
                      <Clock className="w-3 h-3" />
                      {formatDate(article.published_at)}
                    </span>
                    <span className="text-xs text-text-muted flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      {article.source}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-text-primary mb-3 line-clamp-2">
                    {article.title}
                  </h3>

                  <p className="text-text-secondary text-sm mb-4 line-clamp-3">
                    {article.description}
                  </p>

                  <div className="flex items-center justify-end">
                    <a
                      href={article.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm font-medium transition-all hover:gap-2"
                      title="Open article in new tab"
                    >
                      Read More
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}