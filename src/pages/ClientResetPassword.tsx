import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clientSupabase } from '../lib/supabase';
import { TrendingUp, Lock, Eye, EyeOff, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ThemeToggle } from '../theme/ThemeToggle';
import { passwordChecks, passwordError } from '../lib/passwordPolicy';

/**
 * Landing screen for a client's password-recovery email link.
 *
 * The link opens the app with a Supabase recovery session in the URL hash;
 * `clientSupabase` (the only instance that adopts URL sessions) parses it and
 * fires PASSWORD_RECOVERY. This screen waits for that session, then lets the
 * client set a new password via `updateUser`. On success it signs the recovery
 * session out and returns the client to the login page to sign in fresh.
 *
 * A missing/expired link (no recovery session arrives) shows a clear error with
 * a path back to request a new one — never a blank page or a bounce to the home
 * page, which is the bug this screen fixes.
 */
export default function ClientResetPassword() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<'checking' | 'form' | 'done' | 'invalid'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const clearFlag = () => {
    try { sessionStorage.removeItem('nw_pw_recovery'); } catch {}
  };

  useEffect(() => {
    let settled = false;
    const toForm = () => { if (!settled) { settled = true; setStage('form'); } };

    // The recovery session may already be established by the time this mounts
    // (client init runs at boot), so check for it directly…
    clientSupabase.auth.getSession().then(({ data }) => {
      if (data.session) toForm();
    });

    // …and also listen, in case PASSWORD_RECOVERY fires just after mount.
    const { data: sub } = clientSupabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) toForm();
    });

    // No recovery session within a reasonable window → the link is missing or
    // expired. Only trips while still 'checking'.
    const timer = setTimeout(() => {
      if (!settled) { settled = true; clearFlag(); setStage('invalid'); }
    }, 6000);

    return () => { sub.subscription.unsubscribe(); clearTimeout(timer); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const policyErr = passwordError(password);
    if (policyErr) { setError(policyErr); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setError('');
    setLoading(true);

    const { data: userData, error: pwErr } = await clientSupabase.auth.updateUser({ password });
    if (pwErr) {
      setLoading(false);
      setError(
        /same/i.test(pwErr.message)
          ? 'Please choose a password different from your previous one.'
          : (pwErr.message || 'Could not update your password. The link may have expired — request a new one.'),
      );
      return;
    }

    // Best-effort: mark the account's password as set so the client isn't sent
    // through the forced first-login change screen again. Never block the reset
    // on this — the password itself is already updated above.
    try {
      const uid = userData?.user?.id;
      if (uid) {
        await clientSupabase.from('nw_clients')
          .update({ client_password_changed: true })
          .eq('client_auth_user_id', uid);
      }
    } catch {}

    clearFlag();
    // Sign the recovery session out so the client logs in fresh with the new
    // password (and the recovery session can't linger in the portal slot).
    await clientSupabase.auth.signOut().catch(() => {});
    setLoading(false);
    setStage('done');
    setTimeout(() => navigate('/client-login', { replace: true }), 2200);
  };

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: 'var(--bg-base)' }}>
      <div className="absolute top-4 right-4 z-10"><ThemeToggle variant="icon" /></div>
      <div className="w-full max-w-md space-y-8">{children}</div>
    </div>
  );

  if (stage === 'checking') {
    return (
      <Shell>
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-4 animate-pulse"
            style={{ background: 'rgba(var(--accent-rgb),0.1)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
            <ShieldCheck className="w-7 h-7" style={{ color: 'var(--accent)' }} />
          </div>
          <h2 className="text-2xl font-bold text-text-primary">Verifying your reset link…</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>One moment while we confirm your request.</p>
        </div>
      </Shell>
    );
  }

  if (stage === 'invalid') {
    return (
      <Shell>
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-4"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertTriangle className="w-7 h-7" style={{ color: 'rgb(var(--danger-soft-rgb))' }} />
          </div>
          <h2 className="text-2xl font-bold text-text-primary">Reset link invalid or expired</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            This password reset link is no longer valid. Reset links expire after a short time and can be used only once.
          </p>
          <button onClick={() => navigate('/client-login', { replace: true })}
            className="mt-6 w-full py-3.5 rounded-xl font-bold text-sm text-on-accent"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            Back to Login
          </button>
        </div>
      </Shell>
    );
  }

  if (stage === 'done') {
    return (
      <Shell>
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-4"
            style={{ background: 'rgba(var(--success-rgb,34,197,94),0.1)', border: '1px solid rgba(var(--success-rgb,34,197,94),0.25)' }}>
            <CheckCircle2 className="w-7 h-7" style={{ color: 'var(--success)' }} />
          </div>
          <h2 className="text-2xl font-bold text-text-primary">Password updated</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Redirecting you to sign in with your new password…
          </p>
        </div>
      </Shell>
    );
  }

  // stage === 'form'
  return (
    <Shell>
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
          <TrendingUp className="w-8 h-8 text-on-accent" />
        </div>
        <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>Password Reset</p>
        <h2 className="text-3xl font-bold text-text-primary">Set New Password</h2>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          Choose a new password for your Niyom Wealth account.
        </p>
      </div>

      {error && (
        <div className="p-4 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'rgb(var(--danger-soft-rgb))' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        {[
          { label: 'New Password', val: password, set: setPassword, key: 'pw' },
          { label: 'Confirm Password', val: confirm, set: setConfirm, key: 'cf' },
        ].map(f => (
          <div key={f.key}>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{f.label}</label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
              <input
                type={showPw ? 'text' : 'password'}
                required
                value={f.val}
                onChange={e => f.set(e.target.value)}
                placeholder="Create a strong password"
                className="w-full py-3 rounded-xl text-sm text-text-primary outline-none transition-all"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')}
              />
              {f.key === 'pw' && (
                <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }}>
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>
        ))}
        <div className="space-y-2">
          {[
            ...passwordChecks(password),
            { text: 'Passwords must match', met: password === confirm && confirm.length > 0 },
          ].map(r => (
            <p key={r.text} className="text-xs flex items-center gap-1.5" style={{ color: r.met ? 'var(--success)' : 'var(--text-secondary)' }}>
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: r.met ? 'var(--success)' : 'var(--text-secondary)' }} />
              {r.text}
            </p>
          ))}
        </div>
        <button type="submit" disabled={loading}
          className="w-full py-3.5 rounded-xl font-bold text-sm text-on-accent disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
          {loading ? 'Updating Password…' : 'Update Password'}
        </button>
      </form>
    </Shell>
  );
}
