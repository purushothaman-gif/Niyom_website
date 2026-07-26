import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, X } from 'lucide-react';
import { clientSupabase as supabase } from '../../../lib/supabase';
import { passwordChecks, passwordError, isPasswordStrong } from '../../../lib/passwordPolicy';

interface ChangePasswordModalProps {
  clientId: string;
  onClose: () => void;
}

/**
 * Ported verbatim (logic-preserving) from the original ClientPortal so no
 * behaviour is lost in the shell migration: re-auth with current password,
 * update, then flag client_password_changed.
 */
export function ChangePasswordModal({ clientId, onClose }: ChangePasswordModalProps) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const pwErr = passwordError(form.next);
    if (pwErr) return setError(pwErr);
    if (form.next !== form.confirm) return setError('Passwords do not match.');
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) {
      setError('Session expired. Please log in again.');
      return setLoading(false);
    }

    const { error: reAuthErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: form.current,
    });
    if (reAuthErr) {
      setError('Current password is incorrect.');
      return setLoading(false);
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password: form.next });
    if (updateErr) {
      setError(updateErr.message);
      return setLoading(false);
    }

    await supabase.from('nw_clients').update({ client_password_changed: true }).eq('id', clientId);

    setLoading(false);
    setSuccess('Password changed successfully.');
    setForm({ current: '', next: '', confirm: '' });
    setTimeout(onClose, 1600);
  };

  const rules = [
    ...passwordChecks(form.next),
    { text: 'Passwords match', met: form.next === form.confirm && form.confirm.length > 0 },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4">
      <div className="w-full max-w-md overflow-hidden rounded-token-xl border border-border bg-modal shadow-token-lg">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-bold text-text-primary">Change Password</h3>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-6">
          {error && (
            <div className="rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-token-md border border-success-soft/20 bg-success-soft/10 p-3 text-xs text-success-soft">
              {success}
            </div>
          )}

          {([
            { label: 'Current Password', key: 'current' as const },
            { label: 'New Password', key: 'next' as const },
            { label: 'Confirm New Password', key: 'confirm' as const },
          ]).map((f) => (
            <div key={f.key}>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                {f.label}
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form[f.key]}
                  onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}
                  placeholder="••••••••"
                  required
                  className="w-full rounded-token-md border border-border bg-bg-base px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-accent"
                />
                {f.key === 'confirm' && (
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary"
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                )}
              </div>
            </div>
          ))}

          <div className="space-y-1">
            {rules.map((r) => (
              <p
                key={r.text}
                className="flex items-center gap-1.5 text-xs"
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

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !isPasswordStrong(form.next) || form.next !== form.confirm}
              className="rounded-token-md px-5 py-2.5 text-sm font-bold text-on-accent disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
