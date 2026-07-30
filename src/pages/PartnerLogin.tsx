import React, { useState, useRef, useEffect } from 'react';
import { partnerSupabase as supabase } from '../lib/supabase';
import { Lock, Eye, EyeOff, ArrowRight, AlertTriangle, CreditCard, Home, LifeBuoy } from 'lucide-react';
import { ThemeToggle } from '../theme/ThemeToggle';
import { HeroBackground } from '../components/HeroBackground';

interface Props {
  onLogin: (dsaId: string, passwordChanged: boolean) => void;
}

/**
 * Partner (DSA) sign-in. Structurally a trimmed copy of ClientLogin: same
 * PAN + password shape and the same client-side lockout, on its own
 * sessionStorage key so a partner and a client locking themselves out are
 * independent.
 *
 * Deliberately has NO self-serve password reset in Phase 1. resetPasswordForEmail
 * returns the user with a recovery token in the URL hash, and whichever Supabase
 * client instance initialises first claims it — with the default client created
 * app-wide by AuthContext, that recovery session would land under the CRM
 * storage key rather than the partner one. Partners ask their RM to re-issue a
 * temporary password instead.
 *
 * The real brute-force defence is server-side (per-IP throttling inside the
 * partner-pan-login edge function); this lockout is only a UX affordance.
 */

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 300;
const RL_KEY = 'partner_login_rl';

function getRateLimitState() {
  try {
    const raw = sessionStorage.getItem(RL_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { attempts: 0, lockedUntil: 0 };
}

function setRateLimitState(s: { attempts: number; lockedUntil: number }) {
  try { sessionStorage.setItem(RL_KEY, JSON.stringify(s)); } catch {}
}

function recordFailedAttempt(): { locked: boolean; remaining: number } {
  const state = getRateLimitState();
  const now = Date.now();
  if (state.lockedUntil > 0 && now >= state.lockedUntil) {
    setRateLimitState({ attempts: 1, lockedUntil: 0 });
    return { locked: false, remaining: MAX_ATTEMPTS - 1 };
  }
  const newAttempts = state.attempts + 1;
  if (newAttempts >= MAX_ATTEMPTS) {
    setRateLimitState({ attempts: newAttempts, lockedUntil: now + LOCKOUT_SECONDS * 1000 });
    return { locked: true, remaining: 0 };
  }
  setRateLimitState({ attempts: newAttempts, lockedUntil: 0 });
  return { locked: false, remaining: MAX_ATTEMPTS - newAttempts };
}

function clearRateLimit() {
  try { sessionStorage.removeItem(RL_KEY); } catch {}
}

export default function PartnerLogin({ onLogin }: Props) {
  const [pan, setPan] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lockoutMsg, setLockoutMsg] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const lockoutTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkLockout = (): boolean => {
    const state = getRateLimitState();
    const now = Date.now();
    if (state.lockedUntil > 0 && now < state.lockedUntil) {
      setLockoutMsg(`Too many failed attempts. Try again in ${Math.ceil((state.lockedUntil - now) / 1000)}s.`);
      return true;
    }
    setLockoutMsg('');
    return false;
  };

  useEffect(() => {
    checkLockout();
    lockoutTimer.current = setInterval(() => {
      const state = getRateLimitState();
      if (state.lockedUntil > 0 && Date.now() >= state.lockedUntil) {
        clearRateLimit();
        setLockoutMsg('');
        if (lockoutTimer.current) clearInterval(lockoutTimer.current);
      } else {
        checkLockout();
      }
    }, 1000);
    return () => { if (lockoutTimer.current) clearInterval(lockoutTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const failWith = (fallback: string) => {
    const { locked, remaining } = recordFailedAttempt();
    if (locked) {
      setError(`Access temporarily locked after ${MAX_ATTEMPTS} failed attempts. Try again in ${Math.ceil(LOCKOUT_SECONDS / 60)} minutes.`);
    } else {
      setError(`${fallback}${remaining <= 2 ? ` (${remaining} attempt${remaining !== 1 ? 's' : ''} remaining)` : ''}`);
    }
    setLoading(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (checkLockout()) return;

    const panClean = pan.trim().toUpperCase();
    if (!panClean || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panClean)) {
      setError('Please enter a valid PAN number (e.g. ABCDE1234F).');
      return;
    }
    if (!password) { setError('Password is required.'); return; }

    setLoading(true);

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    // Resolve PAN → registered email via the edge function (service role, so no
    // RLS exposure and no way to enumerate PANs from the browser).
    let partner: { dsa_id: string; dsa_email: string; password_changed: boolean } | null = null;
    let throttled = false;
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/partner-pan-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Apikey: anonKey },
        body: JSON.stringify({ pan: panClean }),
      });
      if (res.status === 429) throttled = true;
      else if (res.ok) partner = await res.json();
    } catch {}

    if (throttled) {
      setError('Too many attempts from this network. Please try again in a few minutes.');
      setLoading(false);
      return;
    }

    if (!partner || !partner.dsa_email) {
      failWith('Invalid PAN or password.');
      return;
    }

    const { data: signInData, error: authErr } = await supabase.auth.signInWithPassword({
      email: partner.dsa_email,
      password,
    });

    if (authErr || !signInData?.user) {
      failWith('Invalid PAN or password.');
      return;
    }

    clearRateLimit();
    setLoading(false);
    onLogin(partner.dsa_id, partner.password_changed);
  };

  return (
    <div className="min-h-screen flex relative" style={{ background: 'var(--bg-base)' }}>
      <div className="absolute top-4 right-4 z-20"><ThemeToggle variant="icon" /></div>

      {/* Left panel — animated brand rail (matches the client portal login) */}
      <div data-theme="dark" className="hidden lg:flex w-[420px] flex-shrink-0 p-10 relative overflow-hidden" style={{ borderRight: '1px solid var(--border-subtle)' }}>
        <HeroBackground />
        <div className="relative z-10 flex flex-col justify-between w-full">
          <div className="flex items-center gap-3">
            <img src="/niyomlogo.png" alt="Niyom Wealth" className="h-10 w-auto object-contain" />
            <div>
              <p className="font-bold text-sm" style={{ color: 'var(--accent-soft)' }}>Niyom Wealth</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Partner Portal</p>
            </div>
          </div>

          <div className="space-y-8">
            <div>
              <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--accent)' }}>Your Business, At A Glance</p>
              <h2 className="text-3xl font-bold leading-tight text-text-primary">Track your clients and payouts</h2>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                See the clients you have sourced, download your payout statements, and share your referral link — all in one place.
              </p>
            </div>
            {[
              { label: 'Secure Access', desc: 'Your PAN number is your unique login ID' },
              { label: 'Payout Statements', desc: 'Every debit note, its TDS and net payable' },
              { label: 'Your Clients', desc: 'Portfolios of the clients you introduced' },
            ].map(f => (
              <div key={f.label} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: 'rgba(var(--accent-rgb),0.1)', border: '1px solid rgba(var(--accent-rgb),0.15)' }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent)' }} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">{f.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="p-4 rounded-xl" style={{ background: 'rgba(var(--accent-rgb),0.05)', border: '1px solid rgba(var(--accent-rgb),0.1)' }}>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--accent)' }}>Login ID:</span> Your PAN number (e.g. ABCDE1234F). Your credentials were set up by your relationship manager.
              </p>
            </div>
            <a href="/" className="flex items-center gap-2 text-xs transition-colors" style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}>
              <Home className="w-3.5 h-3.5" />
              Back to Niyom Wealth home
            </a>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md space-y-8">
          <div>
            <div className="flex items-center gap-3 mb-6 lg:hidden">
              <img src="/niyomlogo.png" alt="Niyom Wealth" className="h-8 w-auto object-contain" />
              <p className="font-bold text-sm" style={{ color: 'var(--accent-soft)' }}>Niyom Wealth</p>
            </div>
            <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>Partner Portal</p>
            <h1 className="text-3xl font-bold text-text-primary">Partner Sign In</h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>Sign in using your PAN number and password.</p>
          </div>

          {lockoutMsg && (
            <div className="p-4 rounded-xl flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertTriangle className="w-4 h-4 text-c-red flex-shrink-0" />
              <p className="text-sm text-c-red">{lockoutMsg}</p>
            </div>
          )}
          {error && !lockoutMsg && (
            <div className="p-4 rounded-xl flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertTriangle className="w-4 h-4 text-c-red flex-shrink-0" />
              <p className="text-sm text-c-red">{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>PAN Number</label>
              <div className="relative">
                <CreditCard className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                <input
                  type="text"
                  value={pan}
                  onChange={e => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  autoComplete="username"
                  className="w-full py-3 rounded-xl text-sm text-text-primary outline-none transition-all font-mono tracking-widest"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', paddingLeft: '2.75rem' }}
                  onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                  disabled={!!lockoutMsg}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Your password"
                  autoComplete="current-password"
                  className="w-full py-3 rounded-xl text-sm text-text-primary outline-none transition-all"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                  onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                  disabled={!!lockoutMsg}
                />
                <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <button type="button" onClick={() => setShowHelp(s => !s)}
                className="text-xs font-medium transition-colors" style={{ color: 'var(--accent)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-soft)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--accent)')}>
                Forgot Password?
              </button>
            </div>

            {showHelp && (
              <div className="flex items-start gap-3 rounded-xl p-4" style={{ background: 'rgba(var(--accent-rgb),0.06)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
                <LifeBuoy className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Please contact your Niyom Wealth relationship manager to have a new
                  temporary password issued. You will be asked to set your own password
                  the first time you sign in with it.
                </p>
              </div>
            )}

            <button type="submit" disabled={loading || !!lockoutMsg}
              className="w-full py-3.5 rounded-xl font-bold text-sm text-on-accent disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
              {loading ? 'Signing in…' : <><span>Sign In</span><ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>

          <p className="text-xs text-center" style={{ color: 'var(--text-secondary)' }}>
            Looking for your investment portfolio?{' '}
            <a href="/client-login" style={{ color: 'var(--accent)' }}>Client sign in</a>
          </p>
        </div>
      </div>
    </div>
  );
}
