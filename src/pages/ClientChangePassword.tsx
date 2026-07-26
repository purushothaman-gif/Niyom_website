import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { TrendingUp, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { ThemeToggle } from '../theme/ThemeToggle';

interface Props {
  clientId: string;
  onComplete: () => void;
}

export default function ClientChangePassword({ clientId, onComplete }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setError('');
    setLoading(true);

    const { error: pwErr } = await supabase.auth.updateUser({ password });
    if (pwErr) { setError(pwErr.message); setLoading(false); return; }

    const { error: dbErr } = await supabase
      .from('nw_clients')
      .update({ client_password_changed: true })
      .eq('id', clientId);

    setLoading(false);
    if (dbErr) { setError(dbErr.message); return; }
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
            <TrendingUp className="w-8 h-8 text-on-accent" />
          </div>
          <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-4" style={{ background: 'rgba(var(--accent-rgb),0.1)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
            <ShieldCheck className="w-7 h-7" style={{ color: 'var(--accent)' }} />
          </div>
          <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>Security Setup</p>
          <h2 className="text-3xl font-bold text-text-primary">Set New Password</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            For your security, please set a new personal password to continue.
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
                  placeholder="Min 8 characters"
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
              { text: 'At least 8 characters', met: password.length >= 8 },
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
            {loading ? 'Setting Password...' : 'Set Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
