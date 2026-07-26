import React, { useState, useRef, useEffect } from 'react';
import { clientSupabase as supabase } from '../lib/supabase';
import { Lock, Eye, EyeOff, ArrowRight, ChevronLeft, AlertTriangle, CreditCard, Mail, Home, TrendingUp, Sparkles, Check, Phone, ShieldCheck, RotateCcw } from 'lucide-react';
import { ThemeToggle } from '../theme/ThemeToggle';
import { HeroBackground } from '../components/HeroBackground';

interface Props {
  onLogin: (clientId: string, passwordChanged: boolean) => void;
  onInvestNow?: () => void;
}

type View = 'login' | 'forgot' | 'reset_sent' | 'otp_login';

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 300;

function getRateLimitState() {
  try {
    const raw = sessionStorage.getItem('client_login_rl');
    if (raw) return JSON.parse(raw);
  } catch {}
  return { attempts: 0, lockedUntil: 0 };
}

function setRateLimitState(s: { attempts: number; lockedUntil: number }) {
  sessionStorage.setItem('client_login_rl', JSON.stringify(s));
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
    const lockedUntil = now + LOCKOUT_SECONDS * 1000;
    setRateLimitState({ attempts: newAttempts, lockedUntil });
    return { locked: true, remaining: 0 };
  }
  setRateLimitState({ attempts: newAttempts, lockedUntil: 0 });
  return { locked: false, remaining: MAX_ATTEMPTS - newAttempts };
}

function clearRateLimit() {
  sessionStorage.removeItem('client_login_rl');
}

export default function ClientLogin({ onLogin, onInvestNow }: Props) {
  const [view, setView] = useState<View>('login');
  const [pan, setPan] = useState('');
  const [password, setPassword] = useState('');
  const [resetPan, setResetPan] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lockoutMsg, setLockoutMsg] = useState('');
  const lockoutTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mobile-OTP return login (for clients still completing KYC — no password yet)
  const [otpStage, setOtpStage] = useState<'phone' | 'code'>('phone');
  const [otpPhone, setOtpPhone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpMasked, setOtpMasked] = useState('');
  const [otpResendIn, setOtpResendIn] = useState(0);
  const otpTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkLockout = (): boolean => {
    const state = getRateLimitState();
    const now = Date.now();
    if (state.lockedUntil > 0 && now < state.lockedUntil) {
      const secsLeft = Math.ceil((state.lockedUntil - now) / 1000);
      setLockoutMsg(`Too many failed attempts. Try again in ${secsLeft}s.`);
      return true;
    }
    setLockoutMsg('');
    return false;
  };

  useEffect(() => {
    checkLockout();
    lockoutTimer.current = setInterval(() => {
      const state = getRateLimitState();
      const now = Date.now();
      if (state.lockedUntil > 0 && now >= state.lockedUntil) {
        clearRateLimit();
        setLockoutMsg('');
        if (lockoutTimer.current) clearInterval(lockoutTimer.current);
      } else {
        checkLockout();
      }
    }, 1000);
    return () => { if (lockoutTimer.current) clearInterval(lockoutTimer.current); };
  }, []);

  useEffect(() => () => { if (otpTimer.current) clearInterval(otpTimer.current); }, []);

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

    // Look up client by PAN via edge function (service role, no RLS exposure)
    let client: { client_id: string; client_email: string; password_changed: boolean } | null = null;
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/client-pan-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Apikey': anonKey },
        body: JSON.stringify({ pan: panClean }),
      });
      if (res.ok) client = await res.json();
    } catch {}

    if (!client || !client.client_email) {
      const { locked, remaining } = recordFailedAttempt();
      if (locked) {
        setError(`Account temporarily locked after ${MAX_ATTEMPTS} failed attempts. Try again in ${Math.ceil(LOCKOUT_SECONDS / 60)} minutes.`);
      } else {
        setError(`Invalid PAN or password.${remaining <= 2 ? ` (${remaining} attempt${remaining !== 1 ? 's' : ''} remaining)` : ''}`);
      }
      setLoading(false);
      return;
    }

    const { data: signInData, error: authErr } = await supabase.auth.signInWithPassword({
      email: client.client_email,
      password,
    });

    if (authErr || !signInData?.user) {
      const { locked, remaining } = recordFailedAttempt();
      if (locked) {
        setError(`Account temporarily locked after ${MAX_ATTEMPTS} failed attempts. Try again in ${Math.ceil(LOCKOUT_SECONDS / 60)} minutes.`);
      } else {
        setError(`Invalid PAN or password.${remaining <= 2 ? ` (${remaining} attempt${remaining !== 1 ? 's' : ''} remaining)` : ''}`);
      }
      setLoading(false);
      return;
    }

    clearRateLimit();
    setLoading(false);
    onLogin(client.client_id, client.password_changed);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    try {
      await fetch(`${supabaseUrl}/functions/v1/secure-client-password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pan: resetPan.trim().toUpperCase() }),
      });
    } catch {}

    setLoading(false);
    setView('reset_sent');
  };

  // ── Mobile-OTP return login ────────────────────────────────────────────
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

  const startOtpCooldown = () => {
    setOtpResendIn(30);
    if (otpTimer.current) clearInterval(otpTimer.current);
    otpTimer.current = setInterval(() => {
      setOtpResendIn(s => { if (s <= 1 && otpTimer.current) { clearInterval(otpTimer.current); return 0; } return s - 1; });
    }, 1000);
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const phone = otpPhone.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(phone)) { setError('Enter a valid 10-digit mobile number.'); return; }
    setLoading(true);
    const { ok, data } = await callPublicFn('public-onboard-send-otp', { phone });
    setLoading(false);
    if (!ok) { setError(data?.error || 'Could not send the code.'); return; }
    setOtpMasked(data?.email_masked || 'your registered email');
    setOtpStage('code');
    startOtpCooldown();
  };

  const handleVerifyOtpLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const phone = otpPhone.replace(/\D/g, '').slice(-10);
    if (!/^\d{6}$/.test(otpCode)) { setError('Enter the 6-digit code sent to your email.'); return; }
    setLoading(true);
    const { ok, data } = await callPublicFn('public-onboard-verify-otp', { phone, otp: otpCode });
    if (!ok || !data?.token_hash) { setLoading(false); setError(data?.error || 'Verification failed.'); return; }
    const { error: sessErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'email' });
    setLoading(false);
    if (sessErr) { setError('Could not sign you in. Please try again.'); return; }
    onLogin(data.client_id, true);
  };

  return (
    <>
    <div className="min-h-screen flex relative" style={{ background: 'var(--bg-base)' }}>
      <div className="absolute top-4 right-4 z-20"><ThemeToggle variant="icon" /></div>
      {/* Left panel — animated brand rail (matches the public site heroes) */}
      <div data-theme="dark" className="hidden lg:flex w-[420px] flex-shrink-0 p-10 relative overflow-hidden" style={{ borderRight: '1px solid var(--border-subtle)' }}>
        <HeroBackground />
        <div className="relative z-10 flex flex-col justify-between w-full">
        <div className="flex items-center gap-3">
          <img src="/niyomlogo.png" alt="Niyom Wealth" className="h-10 w-auto object-contain" />
          <div>
            <p className="font-bold text-sm" style={{ color: 'var(--accent-soft)' }}>Niyom Wealth</p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Client Portal</p>
          </div>
        </div>

        <div className="space-y-8">
          <div>
            <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--accent)' }}>Your Wealth, At A Glance</p>
            <h2 className="text-3xl font-bold leading-tight text-text-primary">Manage your investments securely</h2>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Access your portfolio, track your holdings, and stay updated on your financial journey with Niyom Wealth.
            </p>
          </div>
          {[
            { label: 'Secure Access', desc: 'Your PAN number is your unique login ID' },
            { label: 'Portfolio Visibility', desc: 'View your holdings and investment performance' },
            { label: 'Confidential', desc: 'All data is encrypted and accessible only by you' },
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

          {view === 'login' && (
            <>
              <div>
                <div className="flex items-center gap-3 mb-6 lg:hidden">
                  <img src="/niyomlogo.png" alt="Niyom Wealth" className="h-8 w-auto object-contain" />
                  <p className="font-bold text-sm" style={{ color: 'var(--accent-soft)' }}>Niyom Wealth</p>
                </div>
                <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>Client Portal</p>
                <h1 className="text-3xl font-bold text-text-primary">Welcome Back</h1>
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
                      className="w-full py-3 rounded-xl text-sm text-text-primary outline-none transition-all"
                      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', paddingLeft: '2.75rem', paddingRight: '2.75rem' }}
                      onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                      onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                      disabled={!!lockoutMsg}
                    />
                    <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }}>
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button type="button" onClick={() => { setView('forgot'); setError(''); setResetPan(pan); }}
                    className="text-xs font-medium transition-colors" style={{ color: 'var(--accent)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-soft)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--accent)')}>
                    Forgot Password?
                  </button>
                </div>

                <button type="submit" disabled={loading || !!lockoutMsg}
                  className="w-full py-3.5 rounded-xl font-bold text-sm text-on-accent disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                  {loading ? 'Signing in...' : <><span>Sign In</span><ArrowRight className="w-4 h-4" /></>}
                </button>
              </form>

              {/* Invest Now — the acquisition card. Deliberately the ONLY solid
                  gold surface on the page so a new visitor's eye lands here. */}
              <div
                className="relative overflow-hidden rounded-2xl p-5 animate-gold-shine"
                style={{ background: 'linear-gradient(135deg, var(--accent-soft) 0%, var(--accent) 45%, var(--accent-strong) 100%)' }}
              >
                {/* soft light sweep, top-right */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full"
                  style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.35), transparent)' }}
                />

                <div className="relative space-y-3">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-black/70" />
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-black/70">New to Niyom Wealth?</p>
                  </div>

                  <p className="text-xl font-bold leading-snug text-black" style={{ fontFamily: 'var(--font-display)' }}>
                    Start your wealth journey today
                  </p>

                  <ul className="space-y-1.5">
                    {[
                      'Free account, 100% digital — ready in minutes',
                      'Mutual funds, bonds & FDs in one premium portal',
                      'A dedicated relationship manager, always',
                    ].map((line) => (
                      <li key={line} className="flex items-start gap-2 text-xs font-medium text-black/80">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-black" strokeWidth={3} />
                        {line}
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => onInvestNow?.()}
                    className="lift press group flex w-full items-center justify-center gap-2 rounded-xl bg-black py-3.5 text-sm font-bold text-white transition-all hover:bg-gray-900"
                  >
                    <TrendingUp className="w-4 h-4 text-accent-soft" />
                    Open Your Free Account
                    <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-1" />
                  </button>

                  <p className="text-center text-[10px] font-medium text-black/60">
                    Just name, mobile &amp; email &nbsp;·&nbsp; No account charges &nbsp;·&nbsp; Ready in 30 seconds
                  </p>
                </div>
              </div>

              {/* Return path for clients still completing KYC (no password yet). */}
              <div className="text-center">
                <button type="button" onClick={() => { setView('otp_login'); setError(''); setOtpStage('phone'); setOtpPhone(''); setOtpCode(''); }}
                  className="text-xs font-medium transition-colors" style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                  Already started? Continue with email OTP →
                </button>
              </div>

              <div className="text-center">
                <a href="/" className="inline-flex items-center gap-1.5 text-xs transition-colors" style={{ color: 'var(--border-stronger)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--border-stronger)')}>
                  <Home className="w-3.5 h-3.5" />
                  Back to main website
                </a>
              </div>
            </>
          )}

          {view === 'forgot' && (
            <>
              <div>
                <button onClick={() => { setView('login'); setError(''); }} className="flex items-center gap-1.5 text-xs mb-6 transition-colors" style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-faint)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                  <ChevronLeft className="w-3.5 h-3.5" /> Back to login
                </button>
                <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>Password Reset</p>
                <h1 className="text-2xl font-bold text-text-primary">Reset Your Password</h1>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>Enter your PAN number. A reset link will be sent to your registered email.</p>
              </div>

              {error && (
                <div className="p-4 rounded-xl text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: 'rgb(var(--danger-soft-rgb))' }}>{error}</div>
              )}

              <form onSubmit={handleForgotPassword} className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>PAN Number</label>
                  <div className="relative">
                    <CreditCard className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    <input
                      type="text"
                      value={resetPan}
                      onChange={e => setResetPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                      placeholder="ABCDE1234F"
                      maxLength={10}
                      className="w-full py-3 rounded-xl text-sm text-text-primary outline-none transition-all font-mono tracking-widest"
                      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', paddingLeft: '2.75rem' }}
                      onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                      onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                    />
                  </div>
                </div>
                <button type="submit" disabled={loading || resetPan.length !== 10}
                  className="w-full py-3.5 rounded-xl font-bold text-sm text-on-accent disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                  {loading ? 'Sending...' : <><Mail className="w-4 h-4" /><span>Send Reset Link</span></>}
                </button>
              </form>

              <div className="p-4 rounded-xl text-xs" style={{ background: 'rgba(var(--accent-rgb),0.05)', border: '1px solid rgba(var(--accent-rgb),0.1)', color: 'var(--text-muted)' }}>
                For security reasons, we never confirm whether a PAN is registered. If your PAN is in our system, you will receive a reset email.
              </div>
            </>
          )}

          {view === 'reset_sent' && (
            <div className="space-y-6 text-center">
              <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <Mail className="w-8 h-8" style={{ color: 'var(--success)' }} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--success)' }}>Check Your Email</p>
                <h1 className="text-2xl font-bold text-text-primary">Reset Link Sent</h1>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  If your PAN is registered, reset instructions have been sent to your registered email address.
                </p>
              </div>
              <button onClick={() => { setView('login'); setError(''); }}
                className="w-full py-3 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-raised)', color: 'var(--text-faint)', border: '1px solid var(--border)' }}>
                Back to Login
              </button>
            </div>
          )}

          {view === 'otp_login' && (
            <>
              <div>
                <button onClick={() => { setView('login'); setError(''); }} className="flex items-center gap-1.5 text-xs mb-6 transition-colors" style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-faint)')}
                  onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                  <ChevronLeft className="w-3.5 h-3.5" /> Back to Login
                </button>
                <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--accent)' }}>Continue Your Application</p>
                <h1 className="text-3xl font-bold text-text-primary">{otpStage === 'phone' ? 'Sign in with OTP' : 'Enter your OTP'}</h1>
                <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {otpStage === 'phone'
                    ? "Enter your registered mobile — we'll email you a code. No password needed."
                    : <>We sent a 6-digit code to <span className="text-text-primary">{otpMasked || 'your email'}</span>.</>}
                </p>
              </div>

              {error && (
                <div className="p-4 rounded-xl flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <AlertTriangle className="w-4 h-4 text-c-red flex-shrink-0" />
                  <p className="text-sm text-c-red">{error}</p>
                </div>
              )}

              {otpStage === 'phone' ? (
                <form onSubmit={handleSendOtp} className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Mobile Number</label>
                    <div className="relative">
                      <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                      <input type="tel" inputMode="numeric" value={otpPhone} maxLength={10}
                        onChange={e => setOtpPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder="9876543210" autoFocus
                        className="w-full py-3 rounded-xl text-sm text-text-primary outline-none transition-all tracking-widest"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', paddingLeft: '2.75rem' }}
                        onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                        onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
                    </div>
                  </div>
                  <button type="submit" disabled={loading || otpPhone.length !== 10}
                    className="w-full py-3.5 rounded-xl font-bold text-sm text-on-accent disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                    {loading ? 'Sending...' : <><span>Send OTP</span><ArrowRight className="w-4 h-4" /></>}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOtpLogin} className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                      <ShieldCheck className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} /> 6-Digit OTP
                    </label>
                    <input value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric" maxLength={6} autoFocus placeholder="••••••"
                      className="w-full px-4 py-3 rounded-xl text-center text-2xl font-bold tracking-[0.5em] outline-none text-text-primary"
                      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                      onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                      onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
                  </div>
                  <button type="submit" disabled={loading || otpCode.length !== 6}
                    className="w-full py-3.5 rounded-xl font-bold text-sm text-on-accent disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                    {loading ? 'Verifying...' : <><span>Verify &amp; Continue</span><ArrowRight className="w-4 h-4" /></>}
                  </button>
                  <div className="flex items-center justify-between text-xs">
                    <button type="button" onClick={() => { setOtpStage('phone'); setOtpCode(''); setError(''); }} className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                      <ChevronLeft className="w-3.5 h-3.5" /> Change number
                    </button>
                    <button type="button" onClick={() => { if (otpResendIn === 0) handleSendOtp({ preventDefault() {} } as React.FormEvent); }} disabled={otpResendIn > 0}
                      className="flex items-center gap-1 disabled:opacity-50" style={{ color: 'var(--accent)' }}>
                      <RotateCcw className="w-3.5 h-3.5" /> {otpResendIn > 0 ? `Resend in ${otpResendIn}s` : 'Resend code'}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

        </div>
      </div>
    </div>
    </>
  );
}
