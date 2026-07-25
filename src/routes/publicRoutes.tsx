import type { ReactElement } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { Landing } from '../pages/Landing';

/**
 * Single source of truth for the public (indexed) pages: the router builds a
 * <Route> per entry, each renders a <Seo> from `meta`, and the sitemap mirrors
 * the same set of `path`s. Navigation callbacks the existing pages expect are
 * supplied here via `render(navigate)`, so the page components need no edits.
 *
 * These public marketing pages are imported EAGERLY (not React.lazy): they are
 * small, and code-splitting them made a full-screen loading fallback flash
 * between every public navigation (e.g. home → MF Research). The heavy
 * authenticated sub-apps (CRM / Client Portal / MF Admin) stay lazy — see App.tsx.
 */
import { Services } from '../pages/Services';
import Learning from '../pages/Learning';
import News from '../pages/News';
import MFResearch from '../pages/MFResearch';
import Calculator from '../pages/Calculator';
import { UnlistedShares } from '../pages/UnlistedShares';
import { PrivacyPolicy } from '../pages/PrivacyPolicy';
import { TermsOfUse } from '../pages/TermsOfUse';
import { RiskDisclaimer } from '../pages/RiskDisclaimer';
import { Disclaimer } from '../pages/Disclaimer';

/** The public CTAs open the client portal login in a new tab (unchanged behaviour). */
const openSignUp = () => window.open('/onboarding', '_blank');

/**
 * Landing's `onNavigate(page)` uses internal page keys — map them to clean
 * paths. Now only the footer legal links use it.
 */
const PAGE_TO_PATH: Record<string, string> = {
  privacy: '/privacy',
  terms: '/terms',
  risk: '/risk',
  disclaimer: '/disclaimer',
};

export interface RouteMeta {
  title: string;
  description: string;
  /** Breadcrumb label for this page (Home is prepended automatically). */
  label: string;
}

export interface PublicRoute {
  path: string;
  meta: RouteMeta;
  /** Sitemap hints; null excludes the route from sitemap.xml. */
  sitemap: { changefreq: string; priority: string } | null;
  render: (navigate: NavigateFunction) => ReactElement;
}

const BRAND = 'Niyom Wealth Distribution LLP';

export const PUBLIC_ROUTES: PublicRoute[] = [
  {
    path: '/',
    meta: {
      title: `${BRAND} — Wealth Management & Investment Distribution`,
      description:
        'Niyom Wealth Distribution LLP — professional distribution of mutual funds, bonds, fixed deposits, insurance and unlisted shares, with research and planning tools.',
      label: 'Home',
    },
    sitemap: { changefreq: 'weekly', priority: '1.0' },
    render: (navigate) => (
      <Landing
        onGetStarted={openSignUp}
        onViewServices={() => navigate('/services')}
        onViewLearning={() => navigate('/learning')}
        onViewNews={() => navigate('/news')}
        onViewMFResearch={() => navigate('/mf-research')}
        onViewCalculator={() => navigate('/calculators')}
        onViewUnlisted={() => navigate('/unlisted-shares')}
        onViewBonds={() => navigate('/unlisted-bonds')}
        onNavigate={(page) => navigate(PAGE_TO_PATH[page] ?? '/')}
      />
    ),
  },
  {
    path: '/services',
    meta: {
      title: `Our Services — ${BRAND}`,
      description:
        'Explore Niyom Wealth services: investment product distribution, financial information, insurance, documentation assistance and alternative products.',
      label: 'Services',
    },
    sitemap: { changefreq: 'monthly', priority: '0.8' },
    render: (navigate) => <Services onBack={() => navigate('/')} onGetStarted={openSignUp} />,
  },
  {
    path: '/learning',
    meta: {
      title: `Learning — ${BRAND}`,
      description:
        'Investor education from Niyom Wealth: guides and explainers on mutual funds, bonds, fixed deposits, insurance and personal finance.',
      label: 'Learning',
    },
    sitemap: { changefreq: 'weekly', priority: '0.7' },
    render: (navigate) => <Learning onBack={() => navigate('/')} />,
  },
  {
    path: '/news',
    meta: {
      title: `Market News — ${BRAND}`,
      description:
        'Latest financial market news and updates curated by Niyom Wealth across equities, debt, commodities and the mutual fund industry.',
      label: 'News',
    },
    sitemap: { changefreq: 'daily', priority: '0.7' },
    render: (navigate) => <News onBack={() => navigate('/')} />,
  },
  {
    path: '/mf-research',
    meta: {
      title: `Mutual Fund Research — ${BRAND}`,
      description:
        'Research mutual funds with Niyom Wealth: fund details, NAV charts, universe search and side-by-side scheme comparison.',
      label: 'MF Research',
    },
    sitemap: { changefreq: 'daily', priority: '0.7' },
    render: (navigate) => <MFResearch onBack={() => navigate('/')} />,
  },
  {
    path: '/calculators',
    meta: {
      title: `Investment Calculators — ${BRAND}`,
      description:
        'Free financial calculators from Niyom Wealth — SIP, lumpsum, goal planning and more to help you plan your investments.',
      label: 'Calculators',
    },
    sitemap: { changefreq: 'monthly', priority: '0.7' },
    render: (navigate) => <Calculator onBack={() => navigate('/')} />,
  },
  {
    path: '/unlisted-shares',
    meta: {
      title: `Unlisted Shares — ${BRAND}`,
      description:
        'Access unlisted and pre-IPO shares through Niyom Wealth. Explore opportunities in privately held companies.',
      label: 'Unlisted Shares',
    },
    sitemap: { changefreq: 'weekly', priority: '0.8' },
    render: (navigate) => (
      <UnlistedShares
        onBack={() => navigate('/')}
        onNavigateToSignUp={openSignUp}
        onNavigateToKYC={openSignUp}
        initialTab="shares"
      />
    ),
  },
  {
    path: '/unlisted-bonds',
    meta: {
      title: `Secondary Bonds — ${BRAND}`,
      description:
        'Secondary-market bonds available through Niyom Wealth. Diversify with fixed-income securities from established issuers.',
      label: 'Secondary Bonds',
    },
    sitemap: { changefreq: 'weekly', priority: '0.8' },
    render: (navigate) => (
      <UnlistedShares
        onBack={() => navigate('/')}
        onNavigateToSignUp={openSignUp}
        onNavigateToKYC={openSignUp}
        initialTab="bonds"
      />
    ),
  },
  {
    path: '/privacy',
    meta: {
      title: `Privacy Policy — ${BRAND}`,
      description: 'How Niyom Wealth Distribution LLP collects, uses and protects your personal information.',
      label: 'Privacy Policy',
    },
    sitemap: { changefreq: 'yearly', priority: '0.3' },
    render: (navigate) => <PrivacyPolicy onClose={() => navigate('/')} />,
  },
  {
    path: '/terms',
    meta: {
      title: `Terms of Use — ${BRAND}`,
      description: 'Terms and conditions governing the use of Niyom Wealth Distribution LLP services and website.',
      label: 'Terms of Use',
    },
    sitemap: { changefreq: 'yearly', priority: '0.3' },
    render: (navigate) => <TermsOfUse onClose={() => navigate('/')} />,
  },
  {
    path: '/risk',
    meta: {
      title: `Risk Disclosure — ${BRAND}`,
      description: 'Risk disclosure for investments distributed by Niyom Wealth Distribution LLP. Market risks apply.',
      label: 'Risk Disclosure',
    },
    sitemap: { changefreq: 'yearly', priority: '0.3' },
    render: (navigate) => <RiskDisclaimer onClose={() => navigate('/')} />,
  },
  {
    path: '/disclaimer',
    meta: {
      title: `Disclaimer — ${BRAND}`,
      description: 'Legal disclaimer for Niyom Wealth Distribution LLP. We are not SEBI Registered Investment Advisers.',
      label: 'Disclaimer',
    },
    sitemap: { changefreq: 'yearly', priority: '0.3' },
    render: (navigate) => <Disclaimer onClose={() => navigate('/')} />,
  },
];

/** Paths included in sitemap.xml (kept in sync with the static public/sitemap.xml). */
export const PUBLIC_SITEMAP_PATHS = PUBLIC_ROUTES.filter((r) => r.sitemap).map((r) => r.path);
