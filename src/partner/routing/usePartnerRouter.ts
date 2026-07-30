/**
 * usePartnerRouter
 * -----------------------------------------------------------------------------
 * Internal view state for the partner portal. Deliberately dependency-free, for
 * the same reason as usePortalRouter: the partner app is a single mounted leaf
 * under one react-router path, so a local state machine is the cleanest seam and
 * touches nothing outside src/partner.
 *
 * Syncs the active view to `?v=` so refreshes and deep links survive without
 * hijacking the app's pathname-based routing.
 *
 * Unlike usePortalRouter, the valid-view list is derived from VIEW_TITLES rather
 * than duplicated, so adding a view to the nav cannot silently 404 here.
 */
import { useCallback, useEffect, useState } from 'react';
import { PARTNER_VIEWS, type PartnerView } from '../layout/navigation';

const PARAM = 'v';
const DEFAULT_VIEW: PartnerView = 'dashboard';

const readView = (): PartnerView => {
  const v = new URLSearchParams(window.location.search).get(PARAM);
  return v && (PARTNER_VIEWS as string[]).includes(v) ? (v as PartnerView) : DEFAULT_VIEW;
};

export function usePartnerRouter() {
  const [view, setView] = useState<PartnerView>(readView);

  const navigate = useCallback((next: PartnerView) => {
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
