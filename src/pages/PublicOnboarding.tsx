import React, { useEffect, useRef, useState } from 'react';
import {
  User, Phone, Mail, ShieldCheck, ArrowLeft, ArrowRight, CheckCircle2,
  AlertCircle, Clock, Sparkles, RotateCcw, Home, CreditCard, type LucideIcon,
} from 'lucide-react';
import { clientSupabase as supabase } from '../lib/supabase';
import { bseProxyBaseUrl } from '../../shared/platform/env';
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

/**
 * DigiLocker at signup.
 *
 * The visitor has no account yet, so the proxy identifies them only by a random
 * token it hands back when the session starts. The token lives in
 * sessionStorage across the full-page trip to DigiLocker and back (signup
 * opens in its own tab, so the store survives). The verified PAN and name never
 * come through the browser: public-onboard-start redeems the token server-side.
 * A same-tab redirect is used rather than a popup because popups are unreliable
 * on phones, where most signups happen.
 */
const DL_TOKEN_KEY = 'nw_signup_dl';

function readDlToken(): string | null {
  try { return sessionStorage.getItem(DL_TOKEN_KEY); } catch { return null; }
}
function clearDlToken() {
  try { sessionStorage.removeItem(DL_TOKEN_KEY); } catch { /* private mode */ }
}
/** True when this page load is the return leg from DigiLocker. */
function returningFromDigilocker(): boolean {
  try { return new URLSearchParams(window.location.search).has('dl'); } catch { return false; }
}

interface DlStatus { status: string; name?: string | null; panMasked?: string | null; alreadyRegistered?: boolean }

/** Call one of the proxy's public DigiLocker routes. Never throws. */
async function callDigilocker<T>(path: string, body?: unknown): Promise<{ ok: boolean; data: T | null }> {
  const base = bseProxyBaseUrl();
  if (!base) return { ok: false, data: null };
  const ctrl = new AbortController();
  // Starting a session waits on the vendor; the other two are quick lookups.
  const timer = setTimeout(() => ctrl.abort(), path === 'public-start' ? 30_000 : 6_000);
  try {
    const res = await fetch(`${base}/cas/digilocker/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: null };
  } finally {
    clearTimeout(timer);
  }
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
  // DigiLocker is the preferred way to verify the PAN. `null` = still finding
  // out; `false` (off, capped, or the server unreachable) leaves the manual PAN
  // entry, so signup is never blocked by it.
  const [dlEnabled, setDlEnabled] = useState<boolean | null>(null);
  // Set once DigiLocker has verified this visitor; redeemed by public-onboard-start.
  const [dlToken, setDlToken] = useState('');
  const [panMasked, setPanMasked] = useState('');

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  // On load: pick up a DigiLocker verification this tab started (the return leg
  // of the redirect), then learn whether DigiLocker is on offer at all.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const stored = readDlToken();
      if (stored) {
        const returning = returningFromDigilocker();
        let settled = false;
        // The callback stores the result before it redirects here, so this is
        // normally final on the first read; the retries cover a slow write.
        for (let attempt = 0; attempt < 5 && alive && !settled; attempt++) {
          const { data } = await callDigilocker<DlStatus>('public-status', { token: stored });
          if (!alive) return;
          if (data?.status === 'verified' && data.name) {
            settled = true;
            if (data.alreadyRegistered) {
              clearDlToken();
              setError('This PAN is already registered. Please sign in using "Already started your application?" below.');
            } else {
              setDlToken(stored);
              setFullName(data.name);
              setPanMasked(data.panMasked || '');
              setView('form');
            }
          } else if (data?.status === 'pending' && returning) {
            await new Promise((r) => setTimeout(r, 2000));
          } else {
            settled = true;
            clearDlToken();
            if (returning) {
              // Don't leave them stuck: the PAN field is right here — point to it.
              setError('DigiLocker didn’t finish — no problem. Just enter your PAN below to continue.');
            }
          }
        }
        if (alive && !settled) {
          clearDlToken();
          setError('We couldn’t confirm your DigiLocker verification — no problem. Enter your PAN below to continue.');
        }
      }
      const { ok, data } = await callDigilocker<{ enabled?: boolean }>('public-mode');
      if (alive) setDlEnabled(ok && data?.enabled === true);
    })();
    return () => { alive = false; };
  }, []);

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
    // Coming back from DigiLocker reloads this page; that is not a second click.
    if (returningFromDigilocker()) return;
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

  // ── Step 1 (preferred): verify through DigiLocker ──────────────────────
  // Leaves the page for DigiLocker and comes back to /onboarding?dl=1, where
  // the load effect above reads the outcome with the stored token.
  const handleDigilocker = async () => {
    setError('');
    setBusy(true);
    const { ok, data } = await callDigilocker<{ authorizationUrl?: string; token?: string; error?: string }>('public-start', {});
    const url = data?.authorizationUrl || '';
    if (!ok || !data?.token || !url.startsWith('https://')) {
      setBusy(false);
      return setError(data?.error || 'DigiLocker isn’t available right now — just enter your PAN below to continue.');
    }
    try {
      sessionStorage.setItem(DL_TOKEN_KEY, data.token);
    } catch {
      // Without the token there is no way to pick the result up on return.
      setBusy(false);
      return setError('Your browser is blocking storage for this site — enter your PAN below to continue instead.');
    }
    window.location.assign(url);
  };

  /** Back to the first screen, dropping whichever verification was in hand. */
  const resetVerification = () => {
    clearDlToken();
    setDlToken('');
    setPanMasked('');
    setFullName('');
    setView('pan');
    setError('');
  };

  // ── Step 2: create the free account + trigger OTP ──────────────────────
  const handleCreate = async () => {
    setError('');
    if (!validForm) return setError('Please enter a valid 10-digit mobile and email.');
    setBusy(true);
    const attr = readAttribution();
    const { ok, data } = await callFn('public-onboard-start', {
      // DigiLocker: the server reads the PAN and name from the verified session.
      ...(dlToken ? { dl_token: dlToken } : { full_name: fullName.trim(), pan }),
      phone, email: email.trim().toLowerCase(),
      // Optional referral attribution. The server resolves the code and falls
      // back to the default owner if it is unknown or absent.
      ...(attr ? { ref: attr.ref, cnt: attr.cnt, pl: attr.pl } : {}),
    });
    setBusy(false);
    if (data?.dl_expired) {
      resetVerification();
      return setError(data?.error || 'Your DigiLocker verification has expired. Please verify again.');
    }
    if (!ok && !data?.already_exists) return setError(data?.error || 'Could not create your account. Please try again.');
    // The account exists now and the token is spent.
    if (ok && !data?.already_exists) clearDlToken();
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
              ? (dlEnabled
                ? 'Verify instantly with DigiLocker, or just enter your PAN — we fetch your name either way. No documents needed to begin.'
                : 'Enter your PAN — we’ll fetch your name instantly. No documents needed to begin.')
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
          {view === 'pan' && dlEnabled === null ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--text-muted)' }}>One moment…</p>
          ) : view === 'pan' ? (
            <>
              {/*
               * Both paths are on screen at once, so a fresh lead is never forced
               * into a redirect and never gets stuck: DigiLocker is the recommended
               * hero, but the PAN field sits right below it. If DigiLocker fails the
               * error above says "enter your PAN below" — and it already is there.
               */}
              {dlEnabled && (
                <>
                  <button onClick={handleDigilocker} disabled={busy}
                    className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 press disabled:opacity-50 transition-opacity"
                    style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', color: 'var(--text-on-accent)' }}>
                    {busy ? 'Opening DigiLocker…' : <><Sparkles className="w-4 h-4" /> Verify instantly with DigiLocker</>}
                  </button>
                  <p className="text-xs text-center leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                    Recommended — your name &amp; PAN come straight from the source, nothing typed, nothing shared without your consent.
                  </p>
                  <div className="flex items-center gap-3 py-0.5">
                    <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                    <span className="text-xs font-medium" style={{ color: 'var(--text-faint)' }}>or enter your PAN</span>
                    <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                  </div>
                </>
              )}
              <Field icon={CreditCard} label="PAN Number">
                <Input value={pan} inputMode="text" autoFocus={!dlEnabled} maxLength={10}
                  onChange={e => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                  placeholder="ABCDE1234F" style={{ letterSpacing: '0.15em' }} />
              </Field>
              <button onClick={handleVerifyPan} disabled={busy || !validPan}
                className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 press disabled:opacity-50 transition-opacity"
                style={dlEnabled
                  ? { background: 'var(--bg-raised)', color: 'var(--text-primary)', border: '1px solid var(--border)' }
                  : { background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', color: 'var(--text-on-accent)' }}>
                {busy ? 'Verifying…' : <>Continue with PAN <ArrowRight className="w-4 h-4" /></>}
              </button>
              <p className="text-xs text-center" style={{ color: 'var(--text-faint)' }}>
                We verify your PAN instantly and fetch your name — no documents needed to begin.
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
                {dlToken && (
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-faint)' }}>
                    {panMasked ? `PAN ${panMasked} · ` : ''}verified with DigiLocker
                  </p>
                )}
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
              <button onClick={resetVerification} className="w-full flex items-center justify-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                <ArrowLeft className="w-3.5 h-3.5" /> {dlToken ? 'Start over' : 'Change PAN'}
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
