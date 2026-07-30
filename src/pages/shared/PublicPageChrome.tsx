import { useEffect, type ReactNode, type ElementType } from 'react';
import { ArrowLeft, Home } from 'lucide-react';
import { Logo } from '../../components/Logo';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { HeroBackground } from '../../components/HeroBackground';
import { LoginMenu } from '../../components/LoginMenu';

/**
 * Shared chrome for the public marketing pages (Learning, News, MF Research,
 * Calculator). Renders the branded frosted nav, a hero band, and a compact
 * regulatory footer, so the four pages share one consistent, accessible shell
 * instead of each maintaining its own header/mobile-menu copy.
 *
 * Accessibility / SEO:
 *   - Semantic <header>/<main>/<footer> landmarks and a single <h1> per page.
 *   - Sets document.title from `documentTitle` for per-page browser/tab titles.
 *   - The nav is pinned to the dark navy brand palette (data-theme="dark") so
 *     the gold accent stays legible regardless of the visitor's theme, while
 *     the page body below honours the active light/dark theme.
 */
interface PublicPageChromeProps {
  /** Small uppercase label above the title. */
  eyebrow?: string;
  /** Page H1. */
  title: ReactNode;
  /** One-line supporting description under the title. */
  subtitle?: string;
  /** Optional lucide icon rendered in the hero. */
  icon?: ElementType;
  /** Right-aligned hero controls (e.g. refresh button, last-updated stamp). */
  actions?: ReactNode;
  /** Return to the landing page. */
  onBack: () => void;
  /** Value for document.title; falls back to a sensible brand default. */
  documentTitle?: string;
  children: ReactNode;
}

export function PublicPageChrome({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  actions,
  onBack,
  documentTitle,
  children,
}: PublicPageChromeProps) {
  useEffect(() => {
    if (!documentTitle) return;
    const previous = document.title;
    document.title = documentTitle;
    return () => {
      document.title = previous;
    };
  }, [documentTitle]);

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      {/* Branded frosted nav — pinned dark so the gold accent reads correctly. */}
      <header
        data-theme="dark"
        className="text-white sticky top-0 z-50"
        style={{
          background: 'rgba(7, 21, 36, 0.72)',
          backdropFilter: 'saturate(160%) blur(14px)',
          WebkitBackdropFilter: 'saturate(160%) blur(14px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
        }}
      >
        <nav
          aria-label="Primary"
          className="max-w-7xl mx-auto flex items-center justify-between gap-4 px-5 sm:px-6 py-4"
        >
          <button
            onClick={onBack}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
            aria-label="Niyom Wealth home"
          >
            <Logo size="sm" />
            <span className="text-left hidden sm:block">
              <span className="block text-lg font-bold tracking-tight leading-none" style={{ fontFamily: 'var(--font-body)', letterSpacing: '0.1em' }}>
                NIYOM WEALTH
              </span>
              <span className="block text-accent-soft text-[10px] tracking-widest mt-0.5">DISTRIBUTION LLP</span>
            </span>
          </button>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle variant="icon" />
            <button
              onClick={onBack}
              className="hidden sm:inline-flex items-center gap-2 text-white/90 hover:text-accent-soft font-medium px-3 py-2 rounded-lg transition-colors"
            >
              <Home size={16} /> Home
            </button>
            {/* Portal chooser (clients + distribution partners), matching the
                landing header so the two never diverge. */}
            <LoginMenu triggerClassName="px-4 sm:px-6 py-2.5 text-sm sm:text-base shadow-md" />
          </div>
        </nav>
      </header>

      {/* Hero band — inherently dark navy with the animated financial-network
          backdrop (same `HeroBackground` as the CRM Overview banner), so the
          public pages carry the same "tech" identity into their hero. */}
      <section
        data-theme="dark"
        className="relative text-white overflow-hidden px-5 sm:px-6 pt-10 pb-12 sm:pt-14 sm:pb-16"
      >
        <HeroBackground />
        <div className="relative max-w-7xl mx-auto">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-white/70 hover:text-accent-soft text-sm font-medium mb-6 transition-colors"
          >
            <ArrowLeft size={16} /> Back to Home
          </button>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div className="max-w-2xl">
              {eyebrow && (
                <div className="flex items-center gap-2 mb-3">
                  {Icon && (
                    <span
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg"
                      style={{ background: 'rgba(200,164,93,0.14)', border: '1px solid rgba(200,164,93,0.35)' }}
                    >
                      <Icon className="w-4 h-4 text-accent-soft" />
                    </span>
                  )}
                  <span className="text-accent-soft text-xs font-semibold uppercase tracking-widest">{eyebrow}</span>
                </div>
              )}
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.08]" style={{ fontFamily: 'var(--font-display)' }}>
                {title}
              </h1>
              {subtitle && (
                <p className="mt-4 text-base sm:text-lg text-gray-300 leading-relaxed">{subtitle}</p>
              )}
            </div>
            {actions && <div className="flex-shrink-0">{actions}</div>}
          </div>
        </div>
      </section>

      <main className="flex-1 w-full max-w-7xl mx-auto px-5 sm:px-6 py-10 sm:py-14">{children}</main>

      <footer className="bg-bg-elevated border-t border-border-subtle px-5 sm:px-6 py-8">
        <div className="max-w-7xl mx-auto text-center">
          <p className="text-xs text-text-muted">
            SEBI Disclaimer: We are not SEBI Registered Investment Advisers.
          </p>
          <p className="text-xs mt-2 text-text-muted max-w-3xl mx-auto leading-relaxed">
            Investments in the securities market are subject to market risks. Read all scheme related
            documents carefully before investing. All information provided here is for educational and
            informational purposes only and does not constitute personalized investment advice.
          </p>
          <p className="text-xs mt-3 text-text-faint">
            &copy; {new Date().getFullYear()} Niyom Wealth Distribution LLP. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default PublicPageChrome;
