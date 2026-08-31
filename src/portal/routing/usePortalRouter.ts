/**
 * usePortalRouter
 * -----------------------------------------------------------------------------
 * Internal view state for the portal. Deliberately dependency-free (no
 * react-router) because the host app in App.tsx is a custom string-router and
 * the portal is a single mounted leaf — a local state machine is the cleanest
 * seam and touches nothing outside src/portal.
 *
 * Syncs the active view to `?v=` so refreshes and deep links survive without
 * hijacking the app's pathname-based routing.
 */
import { useCallback, useEffect, useState } from 'react';
import type { PortalView } from '../layout/navigation';

const PARAM = 'v';
const DEFAULT_VIEW: PortalView = 'dashboard';

const VALID: PortalView[] = [
  'dashboard',
  'onboarding',
  'portfolio',
  'allocation',
  'mutual-funds',
  'bonds',
  'unlisted-shares',
  'transactions',
  'sip',
  'reports',
  'capital-gains',
  'documents',
  'notifications',
  'support',
  'profile',
];

const readView = (): PortalView => {
  const v = new URLSearchParams(window.location.search).get(PARAM);
  return v && (VALID as string[]).includes(v) ? (v as PortalView) : DEFAULT_VIEW;
};

export function usePortalRouter() {
  const [view, setView] = useState<PortalView>(readView);

  const navigate = useCallback((next: PortalView) => {
    setView(next);
    const params = new URLSearchParams(window.location.search);
    params.set(PARAM, next);
    window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
  }, []);

  useEffect(() => {
    const onPop = () => setView(readView());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return { view, navigate };
}
