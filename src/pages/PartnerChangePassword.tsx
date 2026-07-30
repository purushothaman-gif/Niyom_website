import React, { useState } from 'react';
import { partnerSupabase as supabase } from '../lib/supabase';
import { Handshake, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { ThemeToggle } from '../theme/ThemeToggle';
import { passwordChecks, passwordError } from '../lib/passwordPolicy';

interface Props {
  onComplete: () => void;
}

/**
 * Forced first-login password change for partners. Mirrors ClientChangePassword,
 * with one structural difference: the client version UPDATEs nw_clients directly
 * (which needs a column-unrestricted UPDATE policy, patched only by a trigger).
 * Partners have NO update policy on nw_dsa at all, so the flag is cleared
 * through nw_partner_mark_password_changed() — a SECURITY DEFINER RPC that is
 * the single sanctioned partner write, and which also records the audit row.
 */
export default function PartnerChangePassword({ onComplete }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const policyErr = passwordError(password);
    if (policyErr) { setError(policyErr); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setError('');
    setLoading(true);

    const { error: pwErr } = await supabase.auth.updateUser({ password });
    if (pwErr) { setError(pwErr.message); setLoading(false); return; }

    const { error: rpcErr } = await supabase.rpc('nw_partner_mark_password_changed');

    setLoading(false);
    if (rpcErr) { setError(rpcErr.message); return; }
    onComplete();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: 'var(--bg-base)' }}>
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle variant="icon" />
      </div>
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            <Handshake className="w-8 h-8 text-on-accent" />
          </div>
          <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-4" style={{ background: 'rgba(var(--accent-rgb),0.1)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
            <ShieldCheck className="w-7 h-7" style={{ color: 'var(--accent)' }} />
          </div>
          <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>Security Setup</p>
          <h2 className="text-3xl font-bold text-text-primary">Set New Password</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            You signed in with a temporary password issued by your relationship
            manager. Please set your own password to continue.
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
                  autoComplete="new-password"
                  className="w-full py-3 rounded-xl text-sm text-text-primary outline-none transition-all"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                  onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                />
                {f.key === 'pw' && (
                  <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} aria-label={showPw ? 'Hide password' : 'Show password'}>
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
            {loading ? 'Setting Password…' : 'Set Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
