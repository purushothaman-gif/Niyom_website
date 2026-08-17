import React, { useEffect, useRef, useState } from 'react';
import {
  User, Phone, Mail, ShieldCheck, ArrowLeft, ArrowRight, CheckCircle2,
  AlertCircle, Clock, RotateCcw, Home, CreditCard, Handshake, type LucideIcon,
} from 'lucide-react';
import { partnerSupabase as supabase } from '../lib/supabase';
import { BrandFilm } from '../components/BrandFilm';

interface Props {
  /** Navigates to /partner-login (which mounts the portal once a session exists). */
  onBack: () => void;
  /** Partner referral code from the link — maps the new DSA under that employee. */
  refCode?: string | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function callFn<T = any>(name: string, payload: unknown): Promise<{ ok: boolean; data: T }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, Apikey: ANON },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

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

/**
 * Partner (DSA) self-onboarding page. The partner analogue of PublicOnboarding:
 * details → mobile OTP → session, mapped under the employee whose link brought
 * them here. Form-first (not PAN-first) because a partner may already be a
 * client, and the client PAN pre-check would wrongly block them — the PAN is
 * validated + deduped against nw_dsa server-side instead. Once verified, the
 * partner lands in the portal and is required to set a password.
 */
export default function PartnerOnboarding({ onBack, refCode }: Props) {
  const [view, setView] = useState<'form' | 'otp'>('form');
  const [fullName, setFullName] = useState('');
  const [pan, setPan] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [emailMasked, setEmailMasked] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const startResendCooldown = () => {
    setResendIn(30);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendIn(s => { if (s <= 1 && timerRef.current) { clearInterval(timerRef.current); return 0; } return s - 1; });
    }, 1000);
  };

  const validPan = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
  const validForm =
    fullName.trim().length >= 2 &&
    validPan &&
    /^[6-9]\d{9}$/.test(phone) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const submitStart = async () => {
    return callFn('public-partner-onboard-start', {
      full_name: fullName.trim(), pan, phone, email: email.trim().toLowerCase(),
      ...(refCode ? { ref: refCode } : {}),
    });
  };

  const handleCreate = async () => {
    setError('');
    if (!validForm) return setError('Please enter a valid name, PAN, 10-digit mobile and email.');
    setBusy(true);
    const { ok, data } = await submitStart();
    setBusy(false);
    if (!ok && !data?.already_exists) return setError(data?.error || 'Could not create your partner account. Please try again.');
    setEmailMasked(data?.email_masked || email.trim().toLowerCase());
    setView('otp');
    startResendCooldown();
  };

  const handleResend = async () => {
    if (resendIn > 0) return;
    setError(''); setBusy(true);
    const { ok, data } = await submitStart();
    setBusy(false);
    if (!ok && !data?.already_exists) return setError(data?.error || 'Could not resend the code.');
    startResendCooldown();
  };

  const handleVerify = async () => {
    setError('');
    if (!/^\d{6}$/.test(otp)) return setError('Enter the 6-digit code sent to your email.');
    setBusy(true);
    const { ok, data } = await callFn('public-partner-onboard-verify', { phone, otp });
    if (!ok || !data?.token_hash) { setBusy(false); return setError(data?.error || 'Verification failed.'); }

    const { error: sessErr } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: 'email' });
    if (sessErr) { setBusy(false); return setError('Could not sign you in. Please try again.'); }

    try {
      sessionStorage.setItem('nw_partner_dsa', data.dsa_id);
      // Force the set-password screen on first entry (dsa_password_changed=false).
      sessionStorage.setItem('nw_partner_pw_ok', data.password_changed ? '1' : '0');
    } catch {}
    setBusy(false);
    onBack(); // → /partner-login, which mounts the portal with the live session
  };

  return (
    <div data-theme="dark" className="min-h-screen lg:grid lg:grid-cols-2" style={{ background: 'var(--bg-base)' }}>
      <div
        data-theme="dark"
        className="hidden lg:block relative lg:sticky lg:top-0 lg:h-screen overflow-hidden"
        style={{ background: '#071524', borderRight: '1px solid rgba(216,189,134,0.14)', boxShadow: '1px 0 48px rgba(0,0,0,0.45)' }}
      >
        <BrandFilm variant="onboarding" mode="sequence" fill />
      </div>

      <div className="min-h-screen" style={{ background: 'radial-gradient(110% 70% at 50% -5%, rgba(200,164,93,0.06), transparent 60%)' }}>
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
          <div className="text-center space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
              style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
              <Handshake className="w-3.5 h-3.5" /> Become a Niyom Partner
            </div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
              {view === 'form' ? 'Partner registration' : 'Verify your email'}
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {view === 'form'
                ? 'A few quick details to create your partner account.'
                : <>We sent a 6-digit code to <span style={{ color: 'var(--text-primary)' }}>{emailMasked || 'your email'}</span>.</>}
            </p>
          </div>

          <div className="flex items-center justify-center gap-2">
            {['Details', 'Verify'].map((s, i) => {
              const stepIndex = view === 'form' ? 0 : 1;
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
                  {i < 1 && <div className="w-8 h-px" style={{ background: 'var(--border)' }} />}
                </div>
              );
            })}
          </div>

          {error && (
            <div className="p-3.5 rounded-xl flex items-center gap-2.5" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--danger)' }} />
              <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
            </div>
          )}

          <div className="rounded-2xl p-6 space-y-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)' }}>
            {view === 'form' ? (
              <>
                <Field icon={User} label="Full Name">
                  <Input value={fullName} autoFocus onChange={e => setFullName(e.target.value)} placeholder="As per PAN" />
                </Field>
                <Field icon={CreditCard} label="PAN Number">
                  <Input value={pan} inputMode="text" maxLength={10}
                    onChange={e => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                    placeholder="ABCDE1234F" style={{ letterSpacing: '0.15em' }} />
                </Field>
                <Field icon={Phone} label="Mobile Number">
                  <Input type="tel" inputMode="numeric" value={phone} maxLength={10}
                    onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="9876543210" />
                </Field>
                <Field icon={Mail} label="Email Address">
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
                </Field>
                <button onClick={handleCreate} disabled={busy || !validForm}
                  className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 press disabled:opacity-50 transition-opacity"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', color: 'var(--text-on-accent)' }}>
                  {busy ? 'Creating your account…' : <>Create Partner Account <ArrowRight className="w-4 h-4" /></>}
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

          {view === 'form' && (
            <button onClick={onBack}
              className="group w-full flex items-center gap-3 p-4 rounded-xl text-left transition-all"
              style={{ background: 'rgba(var(--accent-rgb),0.06)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(var(--accent-rgb),0.12)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
                <ShieldCheck className="w-4.5 h-4.5" style={{ color: 'var(--accent)' }} />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Already a partner?</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Sign in to the Partner Portal with your PAN.</p>
              </div>
              <ArrowRight className="w-4 h-4 flex-shrink-0 transition-transform duration-200 group-hover:translate-x-1" style={{ color: 'var(--accent)' }} />
            </button>
          )}

          <div className="space-y-2.5">
            {[
              { icon: CheckCircle2, text: 'Your partner account is created instantly — set a password and you’re in.' },
              { icon: Clock, text: 'Add your bank & ARN details in the portal to start earning payouts.' },
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
