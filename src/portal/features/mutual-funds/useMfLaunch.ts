import { useCallback, useRef, useState } from 'react';
import { MfSsoService } from '../../../../shared/portal/services/MfSsoService';
import { isDemoClientSession } from '../../../../shared/portal/demo/demoClient';

export type MfLaunchState =
  | 'idle'
  | 'opening'
  | 'opened'
  | 'blocked'
  | 'not_mapped'
  | 'kyc_incomplete'
  | 'not_available'
  | 'demo'
  | 'error';

const OPENING_HTML =
  '<!doctype html><title>Opening Mutual Funds…</title>' +
  '<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;' +
  'justify-content:center;height:100vh;margin:0;color:#444">' +
  'Opening your mutual fund account…</body>';

/**
 * Opens the client's MF platform portal in a new tab via investor SSO.
 *
 * `launch()` must run inside the click handler: the tab is opened
 * synchronously (before the network call) so popup blockers treat it as
 * user-initiated, then pointed at the one-time link once it arrives. The link
 * is never kept — every launch asks for a fresh one.
 */
export function useMfLaunch(clientId: string) {
  const [state, setState] = useState<MfLaunchState>('idle');
  const inFlight = useRef(false);

  const launch = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState('opening');

    // The sample portal never reaches the MF platform; don't flash an empty tab.
    const tab = isDemoClientSession() ? null : window.open('', '_blank');
    if (tab) {
      try {
        tab.document.write(OPENING_HTML);
        tab.document.close();
      } catch {
        /* cross-origin about:blank quirks — the redirect below still works */
      }
    }

    void MfSsoService.getLoginLink(clientId)
      .then((res) => {
        if (res.status === 'ok') {
          if (tab && !tab.closed) {
            tab.opener = null;
            tab.location.replace(res.redirectUrl);
            setState('opened');
          } else {
            // Blocked or closed early: the link is spent if we hold it, so
            // let the client click again for a fresh one.
            setState('blocked');
          }
          return;
        }
        tab?.close();
        setState(res.status);
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [clientId]);

  return { state, launch };
}
