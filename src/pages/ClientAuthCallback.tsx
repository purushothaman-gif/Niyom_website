import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { clientSupabase } from '../lib/supabase';
import { LogoLoader } from '../components/LogoLoader';

/**
 * Where Google sends the client back.
 *
 * Two steps, in this order and nowhere else:
 *   1. Exchange the one-time `code` for a session on the CLIENT auth instance
 *      (detectSessionInUrl is off precisely so this is explicit — see
 *      lib/supabase.ts for why an implicit-flow token in the URL would be a
 *      hazard with three Supabase instances sharing one origin).
 *   2. Ask the server which nw_clients row this person owns. A Google session
 *      is not an account here; that answer only comes from the service role.
 *
 * A failure at either step signs the session out again rather than leaving a
 * half-authenticated user sitting on the origin.
 */
export default function ClientAuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  // React 18 mounts effects twice in dev; the code is single-use, so guard it.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const url = new URL(window.location.href);
      const oauthError = url.searchParams.get('error_description') || url.searchParams.get('error');
      if (oauthError) {
        setError('Google sign-in was cancelled.');
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        setError('That sign-in link is incomplete. Please try again.');
        return;
      }

      const { error: exchangeErr } = await clientSupabase.auth.exchangeCodeForSession(code);
      if (exchangeErr) {
        setError('We could not complete the sign-in. Please try again.');
        return;
      }

      const { data: sessionData } = await clientSupabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setError('We could not complete the sign-in. Please try again.');
        return;
      }

      let payload: {
        client_id?: string;
        password_changed?: boolean;
        error?: string;
        code?: string;
      } = {};
      try {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-google-resolve`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            },
          },
        );
        payload = await res.json().catch(() => ({}));
      } catch {
        payload = { error: 'We could not reach Niyom to finish signing you in.' };
      }

      if (!payload.client_id) {
        // No client record behind this Google account — do not leave the
        // session alive; it grants nothing, and a stale one confuses the next
        // login attempt.
        await clientSupabase.auth.signOut();
        setError(payload.error || 'No Niyom account is linked to that Google address.');
        return;
      }

      try {
        sessionStorage.setItem('nw_portal_client', payload.client_id);
        sessionStorage.setItem('nw_portal_pw_ok', payload.password_changed === false ? '0' : '1');
      } catch {
        /* private-mode browsers: the portal still loads, just not across reloads */
      }
      navigate('/client-login', { replace: true });
    })();
  }, [navigate]);

  if (error) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6"
        style={{ background: 'var(--bg-base)' }}
      >
        <div className="w-full max-w-sm text-center">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-c-red" />
          <h1 className="font-display text-lg font-bold text-text-primary">Sign-in didn’t complete</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            {error}
          </p>
          <button
            type="button"
            onClick={() => navigate('/client-login', { replace: true })}
            className="mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-on-accent"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
          >
            Back to sign in <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: 'var(--bg-base)' }}
    >
      <LogoLoader size={52} label="Signing you in…" />
    </div>
  );
}
