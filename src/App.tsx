import { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { clientSupabase } from './lib/supabase';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './theme/ThemeContext';
import { ScrollToTop } from './components/ScrollToTop';
import { Seo } from './components/Seo';
import { NotFound } from './components/NotFound';
import { LogoLoader } from './components/LogoLoader';
import { PUBLIC_ROUTES, type PublicRoute } from './routes/publicRoutes';
import { isDemoSession, endDemoSession } from './partner/demo/demoData';

// Authenticated / utility surfaces are code-split so the public marketing bundle
// stays lean. They keep their own internal navigation (CRM = state, Portal & MF
// Admin = ?v= query param) unchanged — react-router only owns the top-level path.
const CRM = lazy(() => import('./crm/CRM'));
const MfAdminApp = lazy(() => import('./mfadmin/MfAdminApp'));
const ClientLogin = lazy(() => import('./pages/ClientLogin'));
const ClientChangePassword = lazy(() => import('./pages/ClientChangePassword'));
const ClientPortal = lazy(() => import('./pages/ClientPortal'));
const PartnerLogin = lazy(() => import('./pages/PartnerLogin'));
const PartnerChangePassword = lazy(() => import('./pages/PartnerChangePassword'));
const PartnerPortal = lazy(() => import('./pages/PartnerPortal'));
const PublicOnboarding = lazy(() => import('./pages/PublicOnboarding'));
const ClientResetPassword = lazy(() => import('./pages/ClientResetPassword'));
const PublicDealView = lazy(() => import('./pages/PublicDealView'));
const PublicDebitNoteView = lazy(() => import('./pages/PublicDebitNoteView'));

function LoadingScreen() {
  // Theme-aware (not white) so lazy sub-app loads don't flash a jarring white
  // screen on a dark theme. Uses the brand loader (mark + rotating gold arc).
  return <LogoLoader fullscreen label="Loading…" />;
}

/** Renders a public page from the route config plus its per-page <Seo>. */
function PublicPage({ route }: { route: PublicRoute }) {
  const navigate = useNavigate();
  const breadcrumb =
    route.path === '/'
      ? undefined
      : [
          { name: 'Home', path: '/' },
          { name: route.meta.label, path: route.path },
        ];
  return (
    <>
      <Seo
        title={route.meta.title}
        description={route.meta.description}
        path={route.path}
        breadcrumb={breadcrumb}
      />
      {/* Keyed by path so the entrance animation replays on every navigation. */}
      <div key={route.path} className="page-enter">
        {route.render(navigate)}
      </div>
    </>
  );
}

/**
 * Client Wealth Portal login/session. Owns the sessionStorage-backed portal
 * pointer (survives refresh, cleared on logout) — ported verbatim from the old
 * state-machine so behaviour is unchanged; only the URL plumbing moved to the
 * router. Lives at /client-login.
 */
function ClientLoginRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { loading } = useAuth();
  const [clientPortalId, setClientPortalId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('nw_portal_client') || null;
    } catch {
      return null;
    }
  });
  const [clientPasswordChanged, setClientPasswordChanged] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('nw_portal_pw_ok') === '1';
    } catch {
      return false;
    }
  });

  // Mount-only: a restored portal pointer is only valid while a live Supabase
  // session backs it. If the session has expired, drop the stale pointer so the
  // login form shows instead of a portal that can't load data.
  useEffect(() => {
    if (!clientPortalId) return;
    let cancelled = false;
    import('./lib/supabase').then(({ clientSupabase }) =>
      clientSupabase.auth.getSession().then(({ data }) => {
        if (cancelled || data.session) return;
        try {
          sessionStorage.removeItem('nw_portal_client');
          sessionStorage.removeItem('nw_portal_pw_ok');
        } catch {}
        setClientPortalId(null);
        setClientPasswordChanged(false);
      }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClientLogin = (id: string, pwChanged: boolean) => {
    try {
      sessionStorage.setItem('nw_portal_client', id);
      sessionStorage.setItem('nw_portal_pw_ok', pwChanged ? '1' : '0');
    } catch {}
    setClientPortalId(id);
    setClientPasswordChanged(pwChanged);
  };

  const handleClientPasswordChanged = () => {
    try {
      sessionStorage.setItem('nw_portal_pw_ok', '1');
    } catch {}
    setClientPasswordChanged(true);
  };

  const endClientSession = () => {
    try {
      sessionStorage.removeItem('nw_portal_client');
      sessionStorage.removeItem('nw_portal_pw_ok');
    } catch {}
    // End the client Supabase auth session too, so logout is complete (not just UI state).
    import('./lib/supabase').then(({ clientSupabase }) => clientSupabase.auth.signOut());
    setClientPortalId(null);
    setClientPasswordChanged(false);
  };

  const handleClientLogout = () => {
    endClientSession();
    // Send the signed-out client to the public home page, not back to the login form.
    navigate('/');
  };

  /*
   * Signed out by inactivity, not by choice — so this lands on the sign-in
   * screen (which opens on the PIN keypad when this device has one) rather than
   * the marketing home page.
   */
  const handleClientIdleLogout = () => {
    endClientSession();
    navigate('/client-login', { replace: true });
  };

  if (loading) return <LoadingScreen />;

  if (clientPortalId) {
    if (!clientPasswordChanged) {
      return (
        <ClientChangePassword clientId={clientPortalId} onComplete={handleClientPasswordChanged} />
      );
    }
    return (
      <ClientPortal
        clientId={clientPortalId}
        onLogout={handleClientLogout}
        onIdleLogout={handleClientIdleLogout}
      />
    );
  }

  return (
    <ClientLogin
      onLogin={handleClientLogin}
      onInvestNow={() => navigate('/onboarding')}
      startOtp={searchParams.get('method') === 'otp'}
    />
  );
}

/**
 * Partner (DSA) Portal login/session. Structural clone of ClientLoginRoute, on
 * its own sessionStorage keys and its own Supabase instance so a staff, client
 * and partner session can coexist in one browser. Lives at /partner-login.
 */
function PartnerLoginRoute() {
  const navigate = useNavigate();
  const [partnerDsaId, setPartnerDsaId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('nw_partner_dsa') || null;
    } catch {
      return null;
    }
  });
  const [partnerPasswordChanged, setPartnerPasswordChanged] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('nw_partner_pw_ok') === '1';
    } catch {
      return false;
    }
  });

  // Mount-only: a restored pointer is only valid while a live partner Supabase
  // session backs it. If it has expired, drop the pointer so the login form
  // shows instead of a portal whose every RPC would raise.
  useEffect(() => {
    if (!partnerDsaId) return;
    // The demo portal has no Supabase session by design, so this check would
    // evict it on every refresh. Demo sessions end via Sign Out (or closing the
    // tab, since the flag lives in sessionStorage).
    if (isDemoSession()) return;
    let cancelled = false;
    import('./lib/supabase').then(({ partnerSupabase }) =>
      partnerSupabase.auth.getSession().then(({ data }) => {
        if (cancelled || data.session) return;
        try {
          sessionStorage.removeItem('nw_partner_dsa');
          sessionStorage.removeItem('nw_partner_pw_ok');
        } catch {}
        setPartnerDsaId(null);
        setPartnerPasswordChanged(false);
      }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePartnerLogin = (id: string, pwChanged: boolean) => {
    try {
      sessionStorage.setItem('nw_partner_dsa', id);
      sessionStorage.setItem('nw_partner_pw_ok', pwChanged ? '1' : '0');
    } catch {}
    setPartnerDsaId(id);
    setPartnerPasswordChanged(pwChanged);
  };

  const handlePartnerPasswordChanged = () => {
    try {
      sessionStorage.setItem('nw_partner_pw_ok', '1');
    } catch {}
    setPartnerPasswordChanged(true);
  };

  // Also the kill-switch target: PartnerApp calls this when an RPC reports that
  // access was revoked mid-session (RM disabled the login / deactivated the DSA).
  const handlePartnerLogout = () => {
    try {
      sessionStorage.removeItem('nw_partner_dsa');
      sessionStorage.removeItem('nw_partner_pw_ok');
    } catch {}
    endDemoSession();
    import('./lib/supabase').then(({ partnerSupabase }) => partnerSupabase.auth.signOut());
    setPartnerDsaId(null);
    setPartnerPasswordChanged(false);
    navigate('/');
  };

  if (partnerDsaId) {
    if (!partnerPasswordChanged) {
      return <PartnerChangePassword onComplete={handlePartnerPasswordChanged} />;
    }
    return <PartnerPortal onLogout={handlePartnerLogout} />;
  }

  return <PartnerLogin onLogin={handlePartnerLogin} />;
}

function OnboardingRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Marketing Tool referral attribution: ?ref=<employee code> identifies the
  // employee whose post brought this visitor in, with ?cnt / ?pl naming the
  // content and platform. All three are optional — without them the flow
  // behaves exactly as it always has.
  return (
    <PublicOnboarding
      onBack={() => navigate('/client-login?method=otp')}
      refCode={searchParams.get('ref')}
      contentNo={searchParams.get('cnt')}
      platform={searchParams.get('pl')}
    />
  );
}

/** Public, unauthenticated secure link: /deal/<token>. */
function DealRoute() {
  const { token } = useParams();
  return token ? <PublicDealView token={token} /> : <Navigate to="/" replace />;
}

/** Public, unauthenticated secure link: /debit-note/<token>. */
function DebitNoteRoute() {
  const { token } = useParams();
  return token ? <PublicDebitNoteView token={token} /> : <Navigate to="/" replace />;
}

/**
 * Whenever a client password-recovery session is detected — either captured at
 * boot (main.tsx sets the flag before Supabase strips the URL hash) or fired
 * live as PASSWORD_RECOVERY — route to the reset screen. This makes the reset
 * link work even when Supabase falls back to the Site URL (home page) instead of
 * the exact reset path (e.g. when that path isn't in the allowed-redirect list).
 */
function ClientRecoveryRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    const go = () => {
      if (window.location.pathname !== '/client-reset-password') {
        navigate('/client-reset-password', { replace: true });
      }
    };
    let flagged = false;
    try { flagged = sessionStorage.getItem('nw_pw_recovery') === '1'; } catch {}
    if (flagged) go();

    const { data } = clientSupabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        try { sessionStorage.setItem('nw_pw_recovery', '1'); } catch {}
        go();
      }
    });
    return () => data.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function AppContent() {
  return (
    <>
      <ScrollToTop />
      <ClientRecoveryRedirect />
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          {/* Public, indexed pages (each carries its own <Seo>). */}
          {PUBLIC_ROUTES.map((route) => (
            <Route key={route.path} path={route.path} element={<PublicPage route={route} />} />
          ))}

          {/* Convenience aliases. */}
          <Route path="/login" element={<Navigate to="/client-login" replace />} />
          <Route path="/contact" element={<Navigate to="/#contact" replace />} />

          {/* Authenticated / utility surfaces (noindex). */}
          <Route path="/client-login" element={<ClientLoginRoute />} />
          <Route path="/client-reset-password" element={<ClientResetPassword />} />
          <Route path="/partner-login" element={<PartnerLoginRoute />} />
          <Route path="/onboarding" element={<OnboardingRoute />} />
          <Route path="/crm/*" element={<CRM />} />
          <Route path="/mf-admin" element={<MfAdminApp />} />
          <Route path="/deal/:token" element={<DealRoute />} />
          <Route path="/debit-note/:token" element={<DebitNoteRoute />} />

          {/* Unknown paths → 404 (rendered at HTTP 200 via the SPA host rewrite). */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
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
