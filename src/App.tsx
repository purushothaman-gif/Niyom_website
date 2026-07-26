import { Suspense, lazy, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './theme/ThemeContext';
import { ScrollToTop } from './components/ScrollToTop';
import { Seo } from './components/Seo';
import { NotFound } from './components/NotFound';
import { LogoLoader } from './components/LogoLoader';
import { PUBLIC_ROUTES, type PublicRoute } from './routes/publicRoutes';

// Authenticated / utility surfaces are code-split so the public marketing bundle
// stays lean. They keep their own internal navigation (CRM = state, Portal & MF
// Admin = ?v= query param) unchanged — react-router only owns the top-level path.
const CRM = lazy(() => import('./crm/CRM'));
const MfAdminApp = lazy(() => import('./mfadmin/MfAdminApp'));
const ClientLogin = lazy(() => import('./pages/ClientLogin'));
const ClientChangePassword = lazy(() => import('./pages/ClientChangePassword'));
const ClientPortal = lazy(() => import('./pages/ClientPortal'));
const PublicOnboarding = lazy(() => import('./pages/PublicOnboarding'));
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

  const handleClientLogout = () => {
    try {
      sessionStorage.removeItem('nw_portal_client');
      sessionStorage.removeItem('nw_portal_pw_ok');
    } catch {}
    // End the client Supabase auth session too, so logout is complete (not just UI state).
    import('./lib/supabase').then(({ clientSupabase }) => clientSupabase.auth.signOut());
    setClientPortalId(null);
    setClientPasswordChanged(false);
    // Send the signed-out client to the public home page, not back to the login form.
    navigate('/');
  };

  if (loading) return <LoadingScreen />;

  if (clientPortalId) {
    if (!clientPasswordChanged) {
      return (
        <ClientChangePassword clientId={clientPortalId} onComplete={handleClientPasswordChanged} />
      );
    }
    return <ClientPortal clientId={clientPortalId} onLogout={handleClientLogout} />;
  }

  return (
    <ClientLogin
      onLogin={handleClientLogin}
      onInvestNow={() => navigate('/onboarding')}
      startOtp={searchParams.get('method') === 'otp'}
    />
  );
}

function OnboardingRoute() {
  const navigate = useNavigate();
  // Send returning applicants straight to the email-OTP sign-in (they have no
  // password yet), not the default password view.
  return <PublicOnboarding onBack={() => navigate('/client-login?method=otp')} />;
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

function AppContent() {
  return (
    <>
      <ScrollToTop />
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
