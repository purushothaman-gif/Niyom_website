import { lazy } from 'react';
import type { ReactElement } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { Landing } from '../pages/Landing';

/**
 * Single source of truth for the public (indexed) pages: the router builds a
 * <Route> per entry, each renders a <Seo> from `meta`, and the sitemap mirrors
 * the same set of `path`s. Page components are code-split with React.lazy
 * (Landing stays eager — it's the home/LCP). Navigation callbacks the existing
 * pages expect are supplied here via `render(navigate)`, so the page components
 * themselves need no edits.
 */

// Named-export pages need the `.then(m => ({ default: … }))` shim for React.lazy;
// default-export pages (News, MFResearch, Calculator, Learning) import directly.
const Services = lazy(() => import('../pages/Services').then((m) => ({ default: m.Services })));
const Learning = lazy(() => import('../pages/Learning'));
const News = lazy(() => import('../pages/News'));
const MFResearch = lazy(() => import('../pages/MFResearch'));
const Calculator = lazy(() => import('../pages/Calculator'));
const UnlistedShares = lazy(() => import('../pages/UnlistedShares').then((m) => ({ default: m.UnlistedShares })));
const MutualFundsLead = lazy(() => import('../pages/MutualFundsLead').then((m) => ({ default: m.MutualFundsLead })));
const PrimaryBondsLead = lazy(() => import('../pages/PrimaryBondsLead').then((m) => ({ default: m.PrimaryBondsLead })));
const FixedDepositsLead = lazy(() => import('../pages/FixedDepositsLead').then((m) => ({ default: m.FixedDepositsLead })));
const InsuranceLead = lazy(() => import('../pages/InsuranceLead').then((m) => ({ default: m.InsuranceLead })));
const PrivacyPolicy = lazy(() => import('../pages/PrivacyPolicy').then((m) => ({ default: m.PrivacyPolicy })));
const TermsOfUse = lazy(() => import('../pages/TermsOfUse').then((m) => ({ default: m.TermsOfUse })));
const RiskDisclaimer = lazy(() => import('../pages/RiskDisclaimer').then((m) => ({ default: m.RiskDisclaimer })));
const Disclaimer = lazy(() => import('../pages/Disclaimer').then((m) => ({ default: m.Disclaimer })));

/** The public CTAs open the client portal login in a new tab (unchanged behaviour). */
const openClientLogin = () => window.open('/client-login', '_blank');

/**
 * Landing's `onNavigate(page)` uses internal page keys — map them to clean
 * paths. Note 'primary-bonds' (the Invest-Now dropdown key) routes to /bonds.
 */
const PAGE_TO_PATH: Record<string, string> = {
  'mutual-funds': '/mutual-funds',
  'primary-bonds': '/bonds',
  'fixed-deposits': '/fixed-deposits',
  insurance: '/insurance',
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
        onGetStarted={openClientLogin}
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
    render: (navigate) => <Services onBack={() => navigate('/')} onGetStarted={openClientLogin} />,
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
    path: '/mutual-funds',
    meta: {
      title: `Mutual Funds — ${BRAND}`,
      description:
        'Invest in mutual funds through Niyom Wealth. Start your SIP or lumpsum investment with expert distribution support.',
      label: 'Mutual Funds',
    },
    sitemap: { changefreq: 'monthly', priority: '0.8' },
    render: (navigate) => <MutualFundsLead onBack={() => navigate('/')} />,
  },
  {
    path: '/bonds',
    meta: {
      title: `Bonds — ${BRAND}`,
      description:
        'Primary bond offerings distributed by Niyom Wealth. Explore fixed-income opportunities with competitive yields.',
      label: 'Bonds',
    },
    sitemap: { changefreq: 'monthly', priority: '0.8' },
    render: (navigate) => <PrimaryBondsLead onBack={() => navigate('/')} />,
  },
  {
    path: '/fixed-deposits',
    meta: {
      title: `Fixed Deposits — ${BRAND}`,
      description:
        'Corporate and bank fixed deposits distributed by Niyom Wealth with attractive interest rates and flexible tenures.',
      label: 'Fixed Deposits',
    },
    sitemap: { changefreq: 'monthly', priority: '0.8' },
    render: (navigate) => <FixedDepositsLead onBack={() => navigate('/')} />,
  },
  {
    path: '/insurance',
    meta: {
      title: `Insurance — ${BRAND}`,
      description:
        'Life, health and general insurance solutions distributed by Niyom Wealth to protect what matters most.',
      label: 'Insurance',
    },
    sitemap: { changefreq: 'monthly', priority: '0.8' },
    render: (navigate) => <InsuranceLead onBack={() => navigate('/')} />,
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
        onNavigateToSignUp={openClientLogin}
        onNavigateToKYC={openClientLogin}
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
        onNavigateToSignUp={openClientLogin}
        onNavigateToKYC={openClientLogin}
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
