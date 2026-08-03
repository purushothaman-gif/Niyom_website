import React, { useState, useRef, useEffect } from 'react';
import { partnerSupabase as supabase } from '../lib/supabase';
import { Lock, Eye, EyeOff, ArrowRight, AlertTriangle, CreditCard, Home, ChevronLeft, Mail, CheckCircle2, KeyRound, Sparkles } from 'lucide-react';
import { ThemeToggle } from '../theme/ThemeToggle';
import { HeroBackground } from '../components/HeroBackground';
import { PinInput } from '../components/PinInput';
import { passwordChecks, passwordError } from '../lib/passwordPolicy';
import { getDeviceId, listSurfaceProfiles, removeSurfaceProfile, type SurfaceProfile } from '../lib/pinDevice';
import { DEMO_DSA_ID, DEMO_PAN, DEMO_PASSWORD, isDemoCredentials, startDemoSession } from '../partner/demo/demoData';

interface Props {
  onLogin: (dsaId: string, passwordChanged: boolean) => void;
}

type View = 'login' | 'forgot' | 'pin';

/**
 * Partner (DSA) sign-in. Structurally a trimmed copy of ClientLogin: same
 * PAN + password shape and the same client-side lockout, on its own
 * sessionStorage key so a partner and a client locking themselves out are
 * independent.
 *
 * Self-serve password reset uses a 6-digit email OTP code (send-partner-reset-otp
 * / reset-partner-password-with-otp) rather than a magic link — links get
 * pre-consumed by email scanners, and a recovery URL session would also risk
 * landing under the wrong Supabase storage key. Device-PIN quick sign-in
 * (partner-pin-*) mirrors the client portal.
 *
 * The real brute-force defence is server-side (per-IP throttling inside the
 * partner-pan-login edge function, and per-PIN lockout in partner-pin-login);
 * the client-side lockout is only a UX affordance.
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
  const lockoutTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Device-PIN quick sign-in. Open on the keypad when this browser already holds
  // a partner PIN profile.
  const [profiles, setProfiles] = useState<SurfaceProfile[]>(() => listSurfaceProfiles('partner'));
  const [activeProfile, setActiveProfile] = useState<SurfaceProfile | null>(() => {
    const list = listSurfaceProfiles('partner');
    return list.length === 1 ? list[0] : null;
  });
  const [view, setView] = useState<View>(() => (listSurfaceProfiles('partner').length > 0 ? 'pin' : 'login'));
  const [pinError, setPinError] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinReset, setPinReset] = useState(0);

  // Forgot-password (6-digit OTP) flow — PAN → code → new password.
  const [resetPan, setResetPan] = useState('');
  const [forgotStep, setForgotStep] = useState<'pan' | 'code' | 'password'>('pan');
  const [forgotOtp, setForgotOtp] = useState('');
  const [forgotPw, setForgotPw] = useState('');
  const [forgotConfirm, setForgotConfirm] = useState('');
  const [forgotResendIn, setForgotResendIn] = useState(0);
  const [resetSuccess, setResetSuccess] = useState(false);
  const forgotTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (forgotTimer.current) clearInterval(forgotTimer.current); }, []);

  const callPublicFn = async (name: string, payload: unknown) => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const res = await fetch(`${url}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anon}`, Apikey: anon },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  };

  const forgetProfile = (dsaId: string) => {
    removeSurfaceProfile('partner', dsaId);
    const left = listSurfaceProfiles('partner');
    setProfiles(left);
    setActiveProfile(left.length === 1 ? left[0] : null);
    setPinError('');
    if (left.length === 0) setView('login');
  };

  const handlePin = async (pin: string) => {
    if (!activeProfile) return;
    setPinError('');
    setPinBusy(true);
    const { ok, data } = await callPublicFn('partner-pin-login', {
      device_id: getDeviceId(),
      dsa_id: activeProfile.id,
      pin,
    });
    if (!ok || !data?.token_hash) {
      setPinBusy(false);
      setPinReset((n) => n + 1);
      setPinError(data?.error || 'That PIN didn’t work. Please try again.');
      if (data?.code === 'burned' || data?.code === 'expired') {
        setTimeout(() => forgetProfile(activeProfile.id), 1800);
      }
      return;
    }
    const { error: sessErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'email' });
    setPinBusy(false);
    if (sessErr) { setPinReset((n) => n + 1); setPinError('Could not sign you in. Please try again.'); return; }
    onLogin(data.dsa_id, data.password_changed !== false);
  };

  const startForgotCooldown = () => {
    setForgotResendIn(30);
    if (forgotTimer.current) clearInterval(forgotTimer.current);
    forgotTimer.current = setInterval(() => {
      setForgotResendIn(s => { if (s <= 1 && forgotTimer.current) { clearInterval(forgotTimer.current); return 0; } return s - 1; });
    }, 1000);
  };

  const openForgot = () => {
    setView('forgot'); setError(''); setResetSuccess(false);
    setForgotStep('pan'); setForgotOtp(''); setForgotPw(''); setForgotConfirm('');
    setResetPan(pan);
  };

  const handleSendResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const panClean = resetPan.trim().toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(panClean)) { setError('Please enter a valid PAN number (e.g. ABCDE1234F).'); return; }
    setLoading(true);
    const { ok, data } = await callPublicFn('send-partner-reset-otp', { pan: panClean });
    setLoading(false);
    if (!ok) { setError(data?.error || 'Could not send the code. Please try again.'); return; }
    setForgotStep('code'); setForgotOtp(''); startForgotCooldown();
  };

  const handleVerifyResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(forgotOtp)) { setError('Enter the 6-digit code from your email.'); return; }
    setLoading(true);
    const { ok, data } = await callPublicFn('reset-partner-password-with-otp', { action: 'verify', pan: resetPan.trim().toUpperCase(), otp: forgotOtp });
    setLoading(false);
    if (!ok || !data?.verified) { setError(data?.error || 'Verification failed.'); return; }
    setForgotStep('password'); setForgotPw(''); setForgotConfirm('');
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const policyErr = passwordError(forgotPw);
    if (policyErr) { setError(policyErr); return; }
    if (forgotPw !== forgotConfirm) { setError('Passwords do not match.'); return; }
    setError('');
    setLoading(true);
    const { ok, data } = await callPublicFn('reset-partner-password-with-otp', { action: 'reset', pan: resetPan.trim().toUpperCase(), otp: forgotOtp, password: forgotPw });
    setLoading(false);
    if (!ok) { setError(data?.error || 'Could not reset your password. Please try again.'); return; }
    if (forgotTimer.current) clearInterval(forgotTimer.current);
    setResetSuccess(true);
    setView('login'); setForgotStep('pan');
    setResetPan(''); setForgotOtp(''); setForgotPw(''); setForgotConfirm('');
  };

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

    // Demo mode. Recognised locally and never sent to partner-pan-login, so the
    // published demo credentials unlock nothing real — there is no account
    // behind them and nothing to brute-force. PartnerService then serves
    // fixtures for every read and refuses both writes.
    if (isDemoCredentials(panClean, password)) {
      startDemoSession();
      clearRateLimit();
      onLogin(DEMO_DSA_ID, true);
      return;
    }

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
            <h1 className="text-3xl font-bold text-text-primary">
              {view === 'pin' ? 'Welcome Back' : view === 'forgot' ? 'Password Reset' : 'Partner Sign In'}
            </h1>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              {view === 'pin'
                ? (activeProfile ? `Enter your PIN, ${activeProfile.name.split(' ')[0]}.` : 'Enter your 4-digit PIN for this device.')
                : view === 'forgot'
                  ? (forgotStep === 'pan' ? 'Enter your PAN. We’ll email a 6-digit code.' : forgotStep === 'code' ? 'Enter the 6-digit code from your email.' : 'Choose a new password.')
                  : 'Sign in using your PAN number and password.'}
            </p>
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
          {resetSuccess && !error && view === 'login' && (
            <div className="p-4 rounded-xl flex items-center gap-3" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--success)' }} />
              <p className="text-sm" style={{ color: 'var(--success)' }}>Password updated. Please sign in with your new password.</p>
            </div>
          )}

          {view === 'pin' && (
            <div className="space-y-6">
              {profiles.length > 1 && !activeProfile ? (
                <div className="space-y-3">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>More than one partner uses a PIN on this device. Choose yours:</p>
                  {profiles.map(p => (
                    <button key={p.id} onClick={() => { setActiveProfile(p); setPinError(''); setPinReset(n => n + 1); }}
                      className="w-full text-left p-4 rounded-xl transition-colors" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                      <p className="text-sm font-semibold text-text-primary">{p.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.maskedEmail}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  {pinError && (
                    <div className="p-4 rounded-xl flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <AlertTriangle className="w-4 h-4 text-c-red flex-shrink-0" />
                      <p className="text-sm text-c-red">{pinError}</p>
                    </div>
                  )}
                  <PinInput onComplete={handlePin} disabled={pinBusy} autoFocus resetKey={pinReset} />
                  {profiles.length > 1 && (
                    <button type="button" onClick={() => { setActiveProfile(null); setPinError(''); }}
                      className="w-full text-center text-xs" style={{ color: 'var(--text-muted)' }}>Use a different account</button>
                  )}
                </>
              )}
              <button type="button" onClick={() => { setView('login'); setPinError(''); }}
                className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2" style={{ background: 'var(--bg-raised)', color: 'var(--text-faint)', border: '1px solid var(--border)' }}>
                <Lock className="w-4 h-4" /> Sign in with password
              </button>
            </div>
          )}

          {view === 'login' && (
            <>
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
                  <button type="button" onClick={openForgot}
                    className="text-xs font-medium transition-colors" style={{ color: 'var(--accent)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-soft)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--accent)')}>
                    Forgot Password?
                  </button>
                </div>

                <button type="submit" disabled={loading || !!lockoutMsg}
                  className="w-full py-3.5 rounded-xl font-bold text-sm text-on-accent disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                  {loading ? 'Signing in…' : <><span>Sign In</span><ArrowRight className="w-4 h-4" /></>}
                </button>
              </form>

              {profiles.length > 0 && (
                <button type="button" onClick={() => { setView('pin'); setError(''); setPinReset(n => n + 1); }}
                  className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2" style={{ background: 'var(--bg-raised)', color: 'var(--text-faint)', border: '1px solid var(--border)' }}>
                  <KeyRound className="w-4 h-4" /> Use your PIN instead
                </button>
              )}

              {/* Sample portal. One click fills the published demo credentials
                  and signs in against built-in fixtures — no account exists
                  behind them, so nothing real is reachable this way. */}
              <div className="rounded-xl p-4" style={{ background: 'rgba(var(--accent-rgb),0.06)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
                <div className="flex items-start gap-3">
                  <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text-primary">Not a partner yet?</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Explore a sample portal with made-up clients and earnings — see exactly
                      what you would get.
                    </p>
                    <button
                      type="button"
                      onClick={() => { setPan(DEMO_PAN); setPassword(DEMO_PASSWORD); setError(''); }}
                      className="mt-2.5 text-xs font-semibold inline-flex items-center gap-1.5"
                      style={{ color: 'var(--accent)' }}
                    >
                      Fill demo credentials <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              <p className="text-xs text-center" style={{ color: 'var(--text-secondary)' }}>
                Looking for your investment portfolio?{' '}
                <a href="/client-login" style={{ color: 'var(--accent)' }}>Client sign in</a>
              </p>
            </>
          )}

          {view === 'forgot' && (
            <>
              <button
                onClick={() => {
                  setError('');
                  if (forgotStep === 'password') setForgotStep('code');
                  else if (forgotStep === 'code') setForgotStep('pan');
                  else setView('login');
                }}
                className="flex items-center gap-1.5 text-xs transition-colors" style={{ color: 'var(--text-muted)' }}>
                <ChevronLeft className="w-3.5 h-3.5" /> {forgotStep === 'pan' ? 'Back to sign in' : 'Back'}
              </button>

              {forgotStep === 'pan' && (
                <form onSubmit={handleSendResetCode} className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>PAN Number</label>
                    <div className="relative">
                      <CreditCard className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                      <input type="text" value={resetPan}
                        onChange={e => setResetPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                        placeholder="ABCDE1234F" maxLength={10}
                        className="w-full py-3 rounded-xl text-sm text-text-primary outline-none transition-all font-mono tracking-widest"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', paddingLeft: '2.75rem' }}
                        onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                        onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
                    </div>
                  </div>
                  <button type="submit" disabled={loading || resetPan.length !== 10}
                    className="w-full py-3.5 rounded-xl font-bold text-sm text-on-accent disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                    {loading ? 'Sending...' : <><Mail className="w-4 h-4" /><span>Send Code</span></>}
                  </button>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>For security, we never confirm whether a PAN is registered. If yours is, a code will be emailed to you.</p>
                </form>
              )}

              {forgotStep === 'code' && (
                <form onSubmit={handleVerifyResetCode} className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>6-Digit Code</label>
                    <input type="text" inputMode="numeric" autoFocus value={forgotOtp}
                      onChange={e => setForgotOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000" maxLength={6}
                      className="w-full py-3 rounded-xl text-center text-2xl text-text-primary outline-none transition-all font-mono tracking-[0.5em]"
                      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                      onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                      onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
                  </div>
                  <button type="submit" disabled={loading || forgotOtp.length !== 6}
                    className="w-full py-3.5 rounded-xl font-bold text-sm text-on-accent disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                    {loading ? 'Verifying...' : 'Verify Code'}
                  </button>
                  <div className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                    Didn't get it?{' '}
                    <button type="button" disabled={forgotResendIn > 0 || loading}
                      onClick={() => handleSendResetCode({ preventDefault() {} } as React.FormEvent)}
                      className="font-medium disabled:opacity-50" style={{ color: 'var(--accent)' }}>
                      {forgotResendIn > 0 ? `Resend in ${forgotResendIn}s` : 'Resend code'}
                    </button>
                  </div>
                </form>
              )}

              {forgotStep === 'password' && (
                <form onSubmit={handleResetPassword} className="space-y-5">
                  {[
                    { label: 'New Password', val: forgotPw, set: setForgotPw, key: 'pw' },
                    { label: 'Confirm Password', val: forgotConfirm, set: setForgotConfirm, key: 'cf' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>{f.label}</label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                        <input type={showPw ? 'text' : 'password'} value={f.val} onChange={e => f.set(e.target.value)}
                          placeholder="Create a strong password"
                          className="w-full py-3 rounded-xl text-sm text-text-primary outline-none transition-all"
                          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                          onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                          onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
                        {f.key === 'pw' && (
                          <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }}>
                            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="space-y-2">
                    {[...passwordChecks(forgotPw), { text: 'Passwords must match', met: forgotPw === forgotConfirm && forgotConfirm.length > 0 }].map(r => (
                      <p key={r.text} className="text-xs flex items-center gap-1.5" style={{ color: r.met ? 'var(--success)' : 'var(--text-secondary)' }}>
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: r.met ? 'var(--success)' : 'var(--text-secondary)' }} />
                        {r.text}
                      </p>
                    ))}
                  </div>
                  <button type="submit" disabled={loading}
                    className="w-full py-3.5 rounded-xl font-bold text-sm text-on-accent disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                    {loading ? 'Updating...' : 'Update Password'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
