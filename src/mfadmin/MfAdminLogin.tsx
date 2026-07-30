/**
 * MfAdminLogin — dedicated sign-in for the NIYOM MF Admin Console.
 * -----------------------------------------------------------------------------
 * The MF Admin portal has its OWN front door (maintained separately from the
 * CRM), while authenticating against the same employee backend: Supabase auth +
 * the `nw_employees` active gate, including the TOTP second factor for
 * privileged roles (helpers shared from crm/mfa — backend policy stays single-
 * source; only the login SURFACE is separate).
 *
 * Views: login → (privileged + enrolled) mfa_challenge → onLogin(employee).
 * A first-time privileged account that still needs TOTP ENROLMENT is sent to
 * the CRM sign-in once — enrolment UX lives there; we don't duplicate it.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { NWEmployee } from '../crm/types';
import {
  employeeIsPrivileged,
  evaluateMfaGate,
  isMfaUnavailable,
  listVerifiedTotpFactors,
  mfaErrorMessage,
  verifyTotpCode,
  trustThisDevice,
  TRUSTED_DEVICE_DAYS,
} from '../crm/mfa';
import { ThemeToggle } from '../theme/ThemeToggle';

interface Props {
  onLogin: (emp: NWEmployee) => void;
}

type View = 'login' | 'mfa_challenge';

/* Client-side rate limiting — own storage key so CRM lockouts stay independent. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 300;
const RL_KEY = 'mfadmin_login_rl';

function getRl(): { attempts: number; lockedUntil: number } {
  try {
    const raw = sessionStorage.getItem(RL_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* fresh state */
  }
  return { attempts: 0, lockedUntil: 0 };
}
function setRl(s: { attempts: number; lockedUntil: number }) {
  sessionStorage.setItem(RL_KEY, JSON.stringify(s));
}
function recordFailure(): { locked: boolean; remaining: number } {
  const st = getRl();
  const now = Date.now();
  if (st.lockedUntil > 0 && now >= st.lockedUntil) {
    setRl({ attempts: 1, lockedUntil: 0 });
    return { locked: false, remaining: MAX_ATTEMPTS - 1 };
  }
  const attempts = st.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    setRl({ attempts, lockedUntil: now + LOCKOUT_SECONDS * 1000 });
    return { locked: true, remaining: 0 };
  }
  setRl({ attempts, lockedUntil: 0 });
  return { locked: false, remaining: MAX_ATTEMPTS - attempts };
}

export default function MfAdminLogin({ onLogin }: Props) {
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rememberDevice, setRememberDevice] = useState(true);
  const pendingEmployee = useRef<NWEmployee | null>(null);
  const factorId = useRef<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (view === 'mfa_challenge') codeInput.current?.focus();
  }, [view]);

  const loadEmployee = async (userId: string): Promise<NWEmployee | null> => {
    const { data } = await supabase
      .from('nw_employees')
      .select('*')
      .eq('auth_user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    return (data as NWEmployee) || null;
  };

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const rl = getRl();
    if (rl.lockedUntil > Date.now()) {
      const mins = Math.ceil((rl.lockedUntil - Date.now()) / 60000);
      setError(`Too many tries. Please try again in ${mins} minute${mins > 1 ? 's' : ''}.`);
      return;
    }

    setBusy(true);
    try {
      const { data, error: authErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authErr || !data.user) {
        const { locked, remaining } = recordFailure();
        setError(
          locked
            ? 'Too many tries. Please wait 5 minutes before trying again.'
            : `That email or password didn't match. ${remaining} ${remaining === 1 ? 'try' : 'tries'} left.`,
        );
        return;
      }

      const emp = await loadEmployee(data.user.id);
      if (!emp) {
        await supabase.auth.signOut();
        setError('This sign-in is for current Niyom staff only.');
        return;
      }

      // Authorization: MF Admin is restricted to admin / super_admin. A plain
      // employee is refused here — before the MFA gate — the same way !emp is.
      if (!employeeIsPrivileged(emp)) {
        await supabase.auth.signOut();
        setError('Only administrators can open Mutual Fund Admin. Ask an admin if you need access.');
        return;
      }

      // Second factor for privileged roles.
      let gate: Awaited<ReturnType<typeof evaluateMfaGate>>;
      try {
        gate = await evaluateMfaGate(emp);
      } catch (err) {
        gate = isMfaUnavailable(err) ? 'ok' : 'challenge';
      }

      if (gate === 'ok') {
        sessionStorage.removeItem(RL_KEY);
        onLogin(emp);
        return;
      }

      if (gate === 'enroll') {
        await supabase.auth.signOut();
        setError(
          'You need to set up your authenticator app first. Sign in to the CRM once to finish setup, then come back here.',
        );
        return;
      }

      // gate === 'challenge' — enrolled: ask for the current code.
      const factors = await listVerifiedTotpFactors();
      if (!factors.length) {
        await supabase.auth.signOut();
        setError('No authenticator app is set up for this account yet. Set one up from the CRM sign-in, then come back here.');
        return;
      }
      pendingEmployee.current = emp;
      factorId.current = factors[0].id;
      setView('mfa_challenge');
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId.current || !pendingEmployee.current) return;
    setError('');
    setBusy(true);
    try {
      await verifyTotpCode(factorId.current, code.trim());
      if (rememberDevice) { try { await trustThisDevice(); } catch {} }
      sessionStorage.removeItem(RL_KEY);
      onLogin(pendingEmployee.current);
    } catch (err) {
      setError(mfaErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full rounded-token-md border border-border bg-bg-base py-3 pl-11 pr-11 text-sm text-text-primary outline-none transition-colors focus:border-accent';

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-base px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle variant="icon" />
      </div>

      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 text-center">
          <img src="/niyomlogo.png" alt="Niyom Wealth" className="mx-auto h-12 w-auto object-contain" />
          <h1 className="mt-4 font-display text-2xl font-bold text-text-primary">Mutual Fund Admin</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Niyom Wealth · Staff sign in
          </p>
        </div>

        <div className="rounded-token-xl border border-border bg-bg-elevated p-6 shadow-token-card sm:p-8">
          {view === 'login' ? (
            <form onSubmit={submitLogin} className="space-y-4">
              <div className="mb-2 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-bold text-text-primary">Sign in</h2>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {error}
                </div>
              )}

              <div className="relative">
                <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your work email"
                  required
                  autoComplete="email"
                  className={inputCls}
                />
              </div>

              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  required
                  autoComplete="current-password"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                {busy ? 'Signing in…' : 'Sign In'}
                {!busy && <ArrowRight className="h-4 w-4" />}
              </button>

              <p className="pt-1 text-center text-[11px] text-text-faint">
                <KeyRound className="mr-1 inline h-3 w-3 align-[-2px]" />
                Forgot your password? Reset it on the CRM sign-in page — it&rsquo;s the same
                Niyom account.
              </p>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-4">
              <div className="mb-2 flex items-center gap-2">
                <Smartphone className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-bold text-text-primary">Enter your security code</h2>
              </div>
              <p className="text-xs text-text-secondary">
                Open your authenticator app and type the 6-digit code it shows.
              </p>

              {error && (
                <div className="flex items-start gap-2 rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {error}
                </div>
              )}

              <input
                ref={codeInput}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
                className="w-full rounded-token-md border border-border bg-bg-base py-3 text-center font-mono text-xl tracking-[0.5em] text-text-primary outline-none focus:border-accent"
              />

              <label className="flex cursor-pointer select-none items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  className="h-4 w-4 flex-shrink-0 rounded"
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span className="text-xs text-text-secondary">
                  Remember this device for {TRUSTED_DEVICE_DAYS} days, so you won't need a code next time. Only on your own device — never a shared one.
                </span>
              </label>

              <button
                type="submit"
                disabled={busy || code.length !== 6}
                className="w-full rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                {busy ? 'Checking…' : 'Continue'}
              </button>

              <button
                type="button"
                onClick={async () => {
                  await supabase.auth.signOut();
                  pendingEmployee.current = null;
                  factorId.current = null;
                  setCode('');
                  setError('');
                  setView('login');
                }}
                className="w-full text-center text-xs font-semibold text-text-muted hover:text-accent"
              >
                Back
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-text-faint">
          Niyom staff only · Everything you do here is recorded
        </p>
      </div>
    </div>
  );
}
