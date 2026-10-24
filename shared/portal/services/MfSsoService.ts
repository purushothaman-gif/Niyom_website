/**
 * MfSsoService
 * -----------------------------------------------------------------------------
 * Mutual funds run on the MF platform. Clicking Mutual Funds asks the `mf-sso-login`
 * edge function for a one-time MF platform sign-in link for the signed-in client
 * (investor SSO). The PAN never leaves the server; the function reads it
 * from the client row.
 *
 * The link is a short-lived credential: open it straight away and never cache,
 * store or log it — every click asks for a fresh one.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import { functionUrl, getEnv } from '../../platform/env';
import { isDemoClientSession } from '../demo/demoClient';

export type MfLaunchResult =
  | { status: 'ok'; redirectUrl: string }
  | { status: 'not_mapped' | 'kyc_incomplete' | 'not_available' | 'demo' | 'error' };

export const MfSsoService = {
  async getLoginLink(clientId: string): Promise<MfLaunchResult> {
    if (isDemoClientSession()) return { status: 'demo' };
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const anon = getEnv().supabaseAnonKey;
      const res = await fetch(functionUrl('mf-sso-login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? anon}`,
          Apikey: anon,
        },
        body: JSON.stringify({ client_id: clientId }),
      });
      const body = await res.json().catch(() => ({}));
      if (body?.status === 'ok' && typeof body.redirect_url === 'string') {
        return { status: 'ok', redirectUrl: body.redirect_url };
      }
      if (['not_mapped', 'kyc_incomplete', 'not_available'].includes(body?.status)) {
        return { status: body.status };
      }
      return { status: 'error' };
    } catch {
      return { status: 'error' };
    }
  },
};
