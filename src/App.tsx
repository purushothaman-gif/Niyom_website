import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './theme/ThemeContext';
import { Landing } from './pages/Landing';
import { Services } from './pages/Services';
import { Learning } from './pages/Learning';
import News from './pages/News';
import MFResearch from './pages/MFResearch';
import Calculator from './pages/Calculator';
import { UnlistedShares } from './pages/UnlistedShares';
import { PrivacyPolicy } from './pages/PrivacyPolicy';
import { TermsOfUse } from './pages/TermsOfUse';
import { RiskDisclaimer } from './pages/RiskDisclaimer';
import { Disclaimer } from './pages/Disclaimer';
import { MutualFundsLead } from './pages/MutualFundsLead';
import { PrimaryBondsLead } from './pages/PrimaryBondsLead';
import { FixedDepositsLead } from './pages/FixedDepositsLead';
import { InsuranceLead } from './pages/InsuranceLead';
import CRMLogin from './pages/CRMLogin';
import EmployeeDashboard from './pages/EmployeeDashboard';
import AdminDashboard from './pages/AdminDashboard';
import AddDeal from './pages/AddDeal';
import CRM from './crm/CRM';
import MfAdminApp from './mfadmin/MfAdminApp';
import ClientLogin from './pages/ClientLogin';
import ClientChangePassword from './pages/ClientChangePassword';
import ClientPortal from './pages/ClientPortal';
import PublicOnboarding from './pages/PublicOnboarding';
import PublicDealView from './pages/PublicDealView';
import PublicDebitNoteView from './pages/PublicDebitNoteView';

function AppContent() {
  const { loading } = useAuth();
  const [currentPage, setCurrentPage] = useState<'landing' | 'services' | 'learning' | 'news' | 'mfresearch' | 'calculator' | 'unlisted' | 'bonds' | 'privacy' | 'terms' | 'risk' | 'disclaimer' | 'mutual-funds' | 'primary-bonds' | 'fixed-deposits' | 'insurance' | 'crm-login' | 'crm-employee' | 'crm-admin' | 'crm-add-deal' | 'crm-new' | 'client-portal' | 'client-login' | 'mf-admin'>('landing');
  // Client portal state — persisted to sessionStorage so a page refresh keeps
  // the client inside the portal instead of dropping back to landing/dashboard.
  const [clientPortalId, setClientPortalId] = useState<string | null>(() => {
    try { return sessionStorage.getItem('nw_portal_client') || null; } catch { return null; }
  });
  const [clientPasswordChanged, setClientPasswordChanged] = useState<boolean>(() => {
    try { return sessionStorage.getItem('nw_portal_pw_ok') === '1'; } catch { return false; }
  });
  // Public secure deal-confirmation link token (/deal/<token>)
  const [dealToken, setDealToken] = useState<string | null>(null);
  // Public secure debit-note link token (/debit-note/<token>)
  const [debitNoteToken, setDebitNoteToken] = useState<string | null>(null);

  useEffect(() => {
    const checkRoute = () => {
      const pathname = window.location.pathname;
      let hasPortalSession = false;
      try { hasPortalSession = !!sessionStorage.getItem('nw_portal_client'); } catch {}

      if (pathname.startsWith('/debit-note/')) {
        const t = pathname.slice('/debit-note/'.length).replace(/\/$/, '');
        if (t) {
          setDebitNoteToken(t);
          setCurrentPage('public-debit-note' as any);
        }
      } else if (pathname.startsWith('/deal/')) {
        const t = pathname.slice('/deal/'.length).replace(/\/$/, '');
        if (t) {
          setDealToken(t);
          setCurrentPage('public-deal' as any);
        }
      } else if (pathname === '/onboarding' || pathname === '/onboarding/') {
        setCurrentPage('client-onboarding' as any);
      } else if (pathname === '/client-login' || pathname === '/client-login/') {
        setCurrentPage('client-login');
      } else if (pathname === '/crm' || pathname === '/crm/' || pathname.startsWith('/crm/')) {
        setCurrentPage('crm-new');
      } else if (pathname === '/mf-admin' || pathname === '/mf-admin/' || pathname.startsWith('/mf-admin/')) {
        setCurrentPage('mf-admin');
      } else if (pathname === '/privacy') {
        setCurrentPage('privacy');
      } else if (pathname === '/terms') {
        setCurrentPage('terms');
      } else if (pathname === '/risk') {
        setCurrentPage('risk');
      } else if (pathname === '/disclaimer') {
        setCurrentPage('disclaimer');
      } else if (pathname === '/mutual-funds') {
        setCurrentPage('mutual-funds');
      } else if (pathname === '/primary-bonds') {
        setCurrentPage('primary-bonds');
      } else if (pathname === '/fixed-deposits') {
        setCurrentPage('fixed-deposits');
      } else if (pathname === '/insurance') {
        setCurrentPage('insurance');
      } else if (hasPortalSession) {
        // A refreshed client-portal session that landed on a non-specific route
        // (e.g. '/' because the portal was entered via an in-app link that never
        // changed the URL). Restore the portal and normalise the URL.
        setCurrentPage('client-login');
        if (pathname !== '/client-login') window.history.replaceState({}, '', '/client-login');
      }
    };

    checkRoute();
    window.addEventListener('popstate', checkRoute);

    return () => window.removeEventListener('popstate', checkRoute);
  }, []);

  // Mount-only: a client-portal pointer restored from sessionStorage is only
  // valid while a live Supabase auth session backs it. If the session has
  // expired, drop the stale pointer so the login form shows instead of a portal
  // that can't load any data. Runs once, so it never races a fresh in-app login.
  useEffect(() => {
    if (!clientPortalId) return;
    let cancelled = false;
    import('./lib/supabase').then(({ supabase }) =>
      supabase.auth.getSession().then(({ data }) => {
        if (cancelled || data.session) return;
        try {
          sessionStorage.removeItem('nw_portal_client');
          sessionStorage.removeItem('nw_portal_pw_ok');
        } catch {}
        setClientPortalId(null);
        setClientPasswordChanged(false);
      }),
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The public "Get Started / Sign Up / Invest" CTAs funnel into the Wealth
  // Portal login (the legacy Supabase self-signup + dashboard has been retired).
  const goToClientLogin = () => {
    window.open('/client-login', '_blank');
  };

  const handleViewServices = () => {
    setCurrentPage('services');
  };

  const handleViewLearning = () => {
    setCurrentPage('learning');
  };

  const handleViewNews = () => {
    setCurrentPage('news');
  };

  const handleViewMFResearch = () => {
    setCurrentPage('mfresearch');
  };

  const handleViewCalculator = () => {
    setCurrentPage('calculator');
  };

  const handleViewUnlisted = () => {
    setCurrentPage('unlisted');
  };

  const handleViewBonds = () => {
    setCurrentPage('bonds');
  };

  const handleBackToLanding = () => {
    setCurrentPage('landing');
  };

  const handleNavigate = (page: string) => {
    // Entering the client portal via an in-app link: reflect it on the URL so a
    // later refresh resolves back to the portal instead of the landing page.
    if (page === 'client-login' && window.location.pathname !== '/client-login') {
      window.history.pushState({}, '', '/client-login');
    }
    setCurrentPage(page as any);
  };

  // Client-portal session persistence — survives refresh, cleared on logout.
  const handleClientLogin = (id: string, pwChanged: boolean) => {
    try {
      sessionStorage.setItem('nw_portal_client', id);
      sessionStorage.setItem('nw_portal_pw_ok', pwChanged ? '1' : '0');
    } catch {}
    if (window.location.pathname !== '/client-login') {
      window.history.pushState({}, '', '/client-login');
    }
    setClientPortalId(id);
    setClientPasswordChanged(pwChanged);
  };

  const handleClientPasswordChanged = () => {
    try { sessionStorage.setItem('nw_portal_pw_ok', '1'); } catch {}
    setClientPasswordChanged(true);
  };

  const handleClientLogout = () => {
    try {
      sessionStorage.removeItem('nw_portal_client');
      sessionStorage.removeItem('nw_portal_pw_ok');
    } catch {}
    // End the Supabase auth session too, so logout is complete (not just UI state).
    import('./lib/supabase').then(({ supabase }) => supabase.auth.signOut());
    setClientPortalId(null);
    setClientPasswordChanged(false);
    window.history.pushState({}, '', '/client-login');
    setCurrentPage('client-login');
  };

  // Public secure deal-confirmation page — fully unauthenticated, takes priority
  if ((currentPage as any) === 'public-deal' && dealToken) {
    return <PublicDealView token={dealToken} />;
  }

  // Public secure debit-note signing page — fully unauthenticated, takes priority
  if ((currentPage as any) === 'public-debit-note' && debitNoteToken) {
    return <PublicDebitNoteView token={debitNoteToken} />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-slate-600">Loading...</div>
      </div>
    );
  }

  // Public onboarding page
  if ((currentPage as any) === 'client-onboarding') {
    return (
      <PublicOnboarding
        onBack={() => {
          window.history.pushState({}, '', '/client-login');
          setCurrentPage('client-login');
        }}
      />
    );
  }

  // Client login portal
  if (currentPage === 'client-login') {
    if (clientPortalId) {
      if (!clientPasswordChanged) {
        return (
          <ClientChangePassword
            clientId={clientPortalId}
            onComplete={handleClientPasswordChanged}
          />
        );
      }
      return <ClientPortal clientId={clientPortalId} onLogout={handleClientLogout} />;
    }
    return (
      <ClientLogin
        onLogin={handleClientLogin}
        onInvestNow={() => {
          window.history.pushState({}, '', '/onboarding');
          setCurrentPage('client-onboarding' as any);
        }}
      />
    );
  }

  // New premium CRM (takes priority)
  if (currentPage === 'crm-new') {
    return <CRM />;
  }

  // NIYOM MF Admin Portal (employee-facing, self-gated)
  if (currentPage === 'mf-admin') {
    return <MfAdminApp />;
  }

  if (currentPage === 'client-portal') {
    if (clientPortalId) {
      if (!clientPasswordChanged) {
        return (
          <ClientChangePassword
            clientId={clientPortalId}
            onComplete={handleClientPasswordChanged}
          />
        );
      }
      return <ClientPortal clientId={clientPortalId} onLogout={handleClientLogout} />;
    }
    return (
      <ClientLogin
        onLogin={handleClientLogin}
        onInvestNow={() => {
          window.history.pushState({}, '', '/onboarding');
          setCurrentPage('client-onboarding' as any);
        }}
      />
    );
  }

  // CRM routes must be checked before the generic `user` check
  if (currentPage === 'crm-login') {
    return <CRMLogin />;
  }

  if (currentPage === 'crm-employee') {
    return <EmployeeDashboard />;
  }

  if (currentPage === 'crm-admin') {
    return <AdminDashboard />;
  }

  if (currentPage === 'crm-add-deal') {
    return <AddDeal />;
  }

  if (currentPage === 'services') {
    return <Services onBack={handleBackToLanding} onGetStarted={goToClientLogin} />;
  }

  if (currentPage === 'learning') {
    return <Learning onBack={handleBackToLanding} />;
  }

  if (currentPage === 'news') {
    return <News onBack={handleBackToLanding} />;
  }

  if (currentPage === 'mfresearch') {
    return <MFResearch onBack={handleBackToLanding} />;
  }

  if (currentPage === 'calculator') {
    return <Calculator onBack={handleBackToLanding} />;
  }

  if (currentPage === 'unlisted') {
    return <UnlistedShares onBack={handleBackToLanding} onNavigateToSignUp={goToClientLogin} onNavigateToKYC={goToClientLogin} initialTab="shares" />;
  }

  if (currentPage === 'bonds') {
    return <UnlistedShares onBack={handleBackToLanding} onNavigateToSignUp={goToClientLogin} onNavigateToKYC={goToClientLogin} initialTab="bonds" />;
  }

  if (currentPage === 'privacy') {
    return <PrivacyPolicy onClose={handleBackToLanding} />;
  }

  if (currentPage === 'terms') {
    return <TermsOfUse onClose={handleBackToLanding} />;
  }

  if (currentPage === 'risk') {
    return <RiskDisclaimer onClose={handleBackToLanding} />;
  }

  if (currentPage === 'disclaimer') {
    return <Disclaimer onClose={handleBackToLanding} />;
  }

  if (currentPage === 'mutual-funds') {
    return <MutualFundsLead onBack={handleBackToLanding} />;
  }

  if (currentPage === 'primary-bonds') {
    return <PrimaryBondsLead onBack={handleBackToLanding} />;
  }

  if (currentPage === 'fixed-deposits') {
    return <FixedDepositsLead onBack={handleBackToLanding} />;
  }

  if (currentPage === 'insurance') {
    return <InsuranceLead onBack={handleBackToLanding} />;
  }

  return <Landing onGetStarted={goToClientLogin} onViewServices={handleViewServices} onViewLearning={handleViewLearning} onViewNews={handleViewNews} onViewMFResearch={handleViewMFResearch} onViewCalculator={handleViewCalculator} onViewUnlisted={handleViewUnlisted} onViewBonds={handleViewBonds} onNavigate={handleNavigate} />;
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
