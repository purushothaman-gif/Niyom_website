import React, { useState } from 'react';
import { X, Lock, Eye, EyeOff } from 'lucide-react';
import { partnerSupabase as supabase } from '../../../lib/supabase';
import { passwordChecks, passwordError } from '../../../lib/passwordPolicy';

interface Props {
  onClose: () => void;
}

/** Voluntary password change from the topbar. Mirrors the client portal's. */
export function ChangePasswordModal({ onClose }: Props) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const policyErr = passwordError(password);
    if (policyErr) { setError(policyErr); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setError('');
    setLoading(true);

    const { error: pwErr } = await supabase.auth.updateUser({ password });
    if (pwErr) { setError(pwErr.message); setLoading(false); return; }

    // Keeps the forced-change flag cleared and writes the audit row. Partners
    // have no UPDATE policy on nw_dsa, so this RPC is the only write path.
    await supabase.rpc('nw_partner_mark_password_changed');

    setLoading(false);
    setDone(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-token-xl border border-border bg-bg-elevated p-6 shadow-token-card">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-base font-bold text-text-primary">Change Password</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-token-md text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="space-y-5">
            <p className="text-sm text-text-secondary">
              Your password has been updated. Use it the next time you sign in.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-token-md py-2.5 text-sm font-bold text-on-accent"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-sm text-danger-soft">
                {error}
              </div>
            )}

            {[
              { label: 'New Password', val: password, set: setPassword, key: 'pw' },
              { label: 'Confirm Password', val: confirm, set: setConfirm, key: 'cf' },
            ].map((f) => (
              <div key={f.key}>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  {f.label}
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
                  <input
                    type={showPw ? 'text' : 'password'}
                    required
                    value={f.val}
                    onChange={(e) => f.set(e.target.value)}
                    autoComplete="new-password"
                    className="w-full rounded-token-md border border-border bg-bg-surface py-2.5 pl-10 pr-10 text-sm text-text-primary outline-none focus:border-accent"
                  />
                  {f.key === 'pw' && (
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary"
                      aria-label={showPw ? 'Hide password' : 'Show password'}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              </div>
            ))}

            <div className="space-y-1.5">
              {[
                ...passwordChecks(password),
                { text: 'Passwords must match', met: password === confirm && confirm.length > 0 },
              ].map((r) => (
                <p
                  key={r.text}
                  className="flex items-center gap-1.5 text-[11px]"
                  style={{ color: r.met ? 'var(--success)' : 'var(--text-secondary)' }}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: r.met ? 'var(--success)' : 'var(--text-secondary)' }}
                  />
                  {r.text}
                </p>
              ))}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-token-md py-2.5 text-sm font-bold text-on-accent disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              {loading ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
