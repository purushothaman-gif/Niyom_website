import React, { useEffect, useRef, useState } from 'react';
import {
  User, Phone, Mail, ShieldCheck, ArrowLeft, ArrowRight, CheckCircle2,
  AlertCircle, Clock, Sparkles, RotateCcw, Home, CreditCard, type LucideIcon,
} from 'lucide-react';
import { clientSupabase as supabase } from '../lib/supabase';
import { BrandFilm } from '../components/BrandFilm';

interface Props {
  onBack: () => void;
  /** Marketing Tool referral attribution, all optional (see readAttribution). */
  refCode?: string | null;
  contentNo?: string | null;
  platform?: string | null;
}

/** sessionStorage key holding referral attribution across the pan→form→otp steps. */
const REF_ATTR_KEY = 'nw_ref_attr';

interface RefAttribution { ref: string; cnt?: string; pl?: string }

/**
 * Referral attribution for this signup, if any.
 *
 * The ref only appears in the URL on first landing, but the visitor then moves
 * through three views and may reload, so it is stashed in sessionStorage and
 * read back here. Everything about this is best-effort: no ref, an unreadable
 * store, or a code the server does not recognise all fall back to the standard
 * unattributed flow.
 */
function readAttribution(): RefAttribution | null {
  try {
    const raw = sessionStorage.getItem(REF_ATTR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.ref ? parsed as RefAttribution : null;
  } catch {
    return null;
  }
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Call a public (verify_jwt=false) onboarding edge function with the anon key. */
async function callFn<T = any>(name: string, payload: unknown): Promise<{ ok: boolean; data: T }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ANON}`,
      Apikey: ANON,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

// ── Small presentational helpers (match the app's token design language) ──
function Field({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
        <Icon className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} /> {label}
      </label>
      {children}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none transition-all"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}` }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

export default function PublicOnboarding({ onBack, refCode, contentNo, platform }: Props) {
  const [view, setView] = useState<'pan' | 'form' | 'otp'>('pan');
  const [pan, setPan] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [emailMasked, setEmailMasked] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // Persist referral attribution on arrival and record the click. Never blocks
  // or fails the page: this is marketing telemetry sitting in front of a signup
  // funnel.
  //
  // Fires with or without a ref. The bare /onboarding URL is what NIYOM posts
  // from its own social accounts, so a visit carrying no code is a click on the
  // company channel rather than nothing at all; the edge function resolves it
  // to the company link. Only a real code is persisted for the signup step —
  // with none, public-onboard-start applies the same company fallback itself.
  useEffect(() => {
    const attr: RefAttribution | Record<string, never> = refCode
      ? {
          ref: refCode,
          ...(contentNo ? { cnt: contentNo } : {}),
          ...(platform ? { pl: platform } : {}),
        }
      : {};

    if (refCode) {
      try { sessionStorage.setItem(REF_ATTR_KEY, JSON.stringify(attr)); } catch { /* private mode */ }
    }
    callFn('mkt-track-click', attr).catch(() => { /* tracking is never load-bearing */ });
  }, [refCode, contentNo, platform]);

  const startResendCooldown = () => {
    setResendIn(30);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendIn(s => {
        if (s <= 1 && timerRef.current) { clearInterval(timerRef.current); return 0; }
        return s - 1;
      });
    }, 1000);
  };

  const validPan = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
  const validForm =
    fullName.trim().length >= 2 &&
    /^[6-9]\d{9}$/.test(phone) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // ── Step 1: verify PAN → fetch name-as-per-PAN, then advance to details ──
  const handleVerifyPan = async () => {
    setError('');
    if (!validPan) return setError('Enter a valid PAN (e.g. ABCDE1234F).');
    setBusy(true);
    const { ok, data } = await callFn('public-onboard-pan-verify', { pan });
    setBusy(false);
    if (data?.already_registered) {
      return setError('PAN already registered. Please sign in using "Already started your application?" below.');
    }
    if (!ok || !data?.valid || !data?.name_as_per_pan) {
      return setError(data?.error || 'PAN could not be verified. Please check and try again.');
    }
    setFullName(data.name_as_per_pan);
    setView('form');
  };

  // ── Step 2: create the free account + trigger OTP ──────────────────────
  const handleCreate = async () => {
    setError('');
    if (!validForm) return setError('Please enter a valid 10-digit mobile and email.');
    setBusy(true);
    const attr = readAttribution();
    const { ok, data } = await callFn('public-onboard-start', {
      full_name: fullName.trim(), pan, phone, email: email.trim().toLowerCase(),
      // Optional referral attribution. The server resolves the code and falls
      // back to the default owner if it is unknown or absent.
      ...(attr ? { ref: attr.ref, cnt: attr.cnt, pl: attr.pl } : {}),
    });
    setBusy(false);
    if (!ok && !data?.already_exists) return setError(data?.error || 'Could not create your account. Please try again.');
    setEmailMasked(data?.email_masked || email.trim().toLowerCase());
    setView('otp');
    startResendCooldown();
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    setError('');
    setBusy(true);
    const { ok, data } = await callFn('public-onboard-send-otp', { phone });
    setBusy(false);
    if (!ok) return setError(data?.error || 'Could not resend the code.');
    startResendCooldown();
  };

  // ── Step 2: verify OTP → establish session → land on dashboard ─────────
  const handleVerify = async () => {
    setError('');
    if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit code sent to your email.');
    setBusy(true);
    const { ok, data } = await callFn('public-onboard-verify-otp', { phone, otp });
    if (!ok || !data?.token_hash) { setBusy(false); return setError(data?.error || 'Verification failed.'); }

    // Exchange the magic-link token for a live Supabase session (no password).
    const { error: sessErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'email' });
    if (sessErr) { setBusy(false); return setError('Could not sign you in. Please try again.'); }

    try {
      sessionStorage.setItem('nw_portal_client', data.client_id);
      sessionStorage.setItem('nw_portal_pw_ok', '1');
    } catch {}
    setBusy(false);
    onBack(); // navigates to /client-login, which now mounts the portal with a live session
  };

  return (
    // Pinned dark: the left panel is an inherently dark cinematic film, so the
    // whole page commits to one cohesive dark experience (premium split-signup)
    // rather than a dark panel beside a light form reading as two screens.
    <div data-theme="dark" className="min-h-screen lg:grid lg:grid-cols-2" style={{ background: 'var(--bg-base)' }}>
      {/* Left — cinematic brand film. Hidden on mobile (form-first); pins the
          dark token set so the gold-on-black cards read regardless of theme.
          A gold hairline + soft shadow make the seam an intentional divider. */}
      <div
        data-theme="dark"
        className="hidden lg:block relative lg:sticky lg:top-0 lg:h-screen overflow-hidden"
        style={{
          background: '#071524',
          borderRight: '1px solid rgba(216,189,134,0.14)',
          boxShadow: '1px 0 48px rgba(0,0,0,0.45)',
        }}
      >
        <BrandFilm variant="onboarding" mode="sequence" fill />
      </div>

      {/* Right — nav + signup form. A faint warm glow from the top gives the
          form side depth so it reads as the same canvas as the film panel. */}
      <div
        className="min-h-screen"
        style={{ background: 'radial-gradient(110% 70% at 50% -5%, rgba(200,164,93,0.06), transparent 60%)' }}
      >
      {/* Top nav */}
      <div className="sticky top-0 z-10 px-6 py-4 flex items-center gap-4"
        style={{ background: 'var(--header-bg)', borderBottom: '1px solid var(--border-subtle)', backdropFilter: 'blur(8px)' }}>
        <a href="/" className="flex items-center gap-2 text-sm transition-colors" style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
          <Home className="w-4 h-4" /> Home
        </a>
        <div className="flex-1" />
        <img src="/niyomlogo.png" alt="Niyom Wealth" className="h-8 w-auto object-contain" />
      </div>

      <div className="max-w-md mx-auto px-4 py-10 space-y-6 animate-fadeInUp">
        {/* Header */}
        <div className="text-center space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
            style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
            <Sparkles className="w-3.5 h-3.5" /> Open Your Free Account
          </div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
            {view === 'pan' ? 'Start in 30 seconds' : view === 'form' ? 'A few quick details' : 'Verify your email'}
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {view === 'pan'
              ? 'Enter your PAN — we’ll fetch your name instantly. No documents needed to begin.'
              : view === 'form'
              ? 'Just your mobile and email to finish creating your account.'
              : <>We sent a 6-digit code to <span style={{ color: 'var(--text-primary)' }}>{emailMasked || 'your email'}</span>.</>}
          </p>
        </div>

        {/* Progress: 2 dots */}
        <div className="flex items-center justify-center gap-2">
          {['PAN', 'Details', 'Verify'].map((s, i) => {
            const stepIndex = view === 'pan' ? 0 : view === 'form' ? 1 : 2;
            const active = stepIndex === i;
            const done = stepIndex > i;
            return (
              <div key={s} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{
                      background: done ? 'rgba(16,185,129,0.15)' : active ? 'rgba(var(--accent-rgb),0.2)' : 'var(--bg-raised)',
                      border: `1px solid ${done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--border)'}`,
                      color: done ? 'var(--success)' : active ? 'var(--accent)' : 'var(--text-faint)',
                    }}>
                    {done ? '✓' : i + 1}
                  </div>
                  <span className="text-xs font-medium" style={{ color: active ? 'var(--accent)' : done ? 'var(--success)' : 'var(--text-faint)' }}>{s}</span>
                </div>
                {i < 2 && <div className="w-8 h-px" style={{ background: 'var(--border)' }} />}
              </div>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="p-3.5 rounded-xl flex items-center gap-2.5" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--danger)' }} />
            <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
          </div>
        )}

        {/* Card */}
        <div className="rounded-2xl p-6 space-y-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
          {view === 'pan' ? (
            <>
              <Field icon={CreditCard} label="PAN Number">
                <Input value={pan} inputMode="text" autoFocus maxLength={10}
                  onChange={e => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                  placeholder="ABCDE1234F" style={{ letterSpacing: '0.15em' }} />
              </Field>
              <button onClick={handleVerifyPan} disabled={busy || !validPan}
                className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 press disabled:opacity-50 transition-opacity"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', color: 'var(--text-on-accent)' }}>
                {busy ? 'Verifying…' : <>Verify PAN <ArrowRight className="w-4 h-4" /></>}
              </button>
              <p className="text-xs text-center" style={{ color: 'var(--text-faint)' }}>
                We verify your PAN instantly and fetch your name — no typing needed.
              </p>
            </>
          ) : view === 'form' ? (
            <>
              <Field icon={User} label="Full Name">
                <div className="w-full px-3.5 py-2.5 rounded-xl text-sm flex items-center justify-between gap-2"
                  style={{ background: 'var(--bg-raised)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                  <span className="font-medium">{fullName}</span>
                  <span className="text-xs flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--success)' }}>
                    <CheckCircle2 className="w-3.5 h-3.5" /> as per PAN
                  </span>
                </div>
              </Field>
              <Field icon={Phone} label="Mobile Number">
                <Input type="tel" inputMode="numeric" value={phone} maxLength={10} autoFocus
                  onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="9876543210" />
              </Field>
              <Field icon={Mail} label="Email Address">
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
              </Field>
              <button onClick={handleCreate} disabled={busy || !validForm}
                className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 press disabled:opacity-50 transition-opacity"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', color: 'var(--text-on-accent)' }}>
                {busy ? 'Creating your account…' : <>Create Free Account <ArrowRight className="w-4 h-4" /></>}
              </button>
              <button onClick={() => { setView('pan'); setError(''); }} className="w-full flex items-center justify-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                <ArrowLeft className="w-3.5 h-3.5" /> Change PAN
              </button>
            </>
          ) : (
            <>
              <Field icon={ShieldCheck} label="Enter 6-Digit OTP">
                <input value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric" maxLength={6} autoFocus placeholder="••••••"
                  className="w-full px-4 py-3 rounded-xl text-center text-2xl font-bold tracking-[0.5em] outline-none"
                  style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </Field>
              <button onClick={handleVerify} disabled={busy || otp.length !== 6}
                className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 press disabled:opacity-50 transition-opacity"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', color: 'var(--text-on-accent)' }}>
                {busy ? 'Verifying…' : <>Verify & Continue <ArrowRight className="w-4 h-4" /></>}
              </button>
              <div className="flex items-center justify-between text-xs">
                <button onClick={() => { setView('form'); setOtp(''); setError(''); }} className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                  <ArrowLeft className="w-3.5 h-3.5" /> Change details
                </button>
                <button onClick={handleResend} disabled={resendIn > 0} className="flex items-center gap-1 disabled:opacity-50" style={{ color: 'var(--accent)' }}>
                  <RotateCcw className="w-3.5 h-3.5" /> {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Already-started return path — routes to /client-login where the email-OTP sign-in lives. */}
        {view === 'pan' && (
          <button onClick={onBack}
            className="group w-full flex items-center gap-3 p-4 rounded-xl text-left transition-all"
            style={{ background: 'rgba(var(--accent-rgb),0.06)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.1)'; e.currentTarget.style.borderColor = 'var(--accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.06)'; e.currentTarget.style.borderColor = 'rgba(var(--accent-rgb),0.25)'; }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(var(--accent-rgb),0.12)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
              <ShieldCheck className="w-4.5 h-4.5" style={{ color: 'var(--accent)' }} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Already started your application?</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Sign in with a one-time code emailed to you — no password needed.</p>
            </div>
            <ArrowRight className="w-4 h-4 flex-shrink-0 transition-transform duration-200 group-hover:translate-x-1" style={{ color: 'var(--accent)' }} />
          </button>
        )}

        {/* Trust footer */}
        <div className="space-y-2.5">
          {[
            { icon: CheckCircle2, text: 'Your account is created instantly — start exploring right away.' },
            { icon: Clock, text: 'Finish KYC at your pace; investing activates after verification.' },
            { icon: ShieldCheck, text: 'Bank-grade security. Processed per SEBI & KYC norms.' },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-start gap-2.5">
              <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{text}</p>
            </div>
          ))}
        </div>
      </div>
      </div>
    </div>
  );
}
