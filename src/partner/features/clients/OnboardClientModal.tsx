// Partner onboards one of their own clients. PAN is verified first (Cashfree, via
// the public PAN gate) which fetches the legal name and blocks a PAN that is
// already a client; then the partner adds mobile + email and submits. The edge
// function files the client under the partner's RM with an auto-generated code and
// maps it to the partner (record only — the RM finishes KYC and enables the login).

import { useState } from 'react';
import { X, CheckCircle2, ShieldCheck, Loader2 } from 'lucide-react';
import { PartnerService } from '../../services/PartnerService';

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INTERESTS = ['Bonds', 'Unlisted Shares', 'Mutual Funds', 'Fixed Deposit', 'Insurance'];

export function OnboardClientModal({ onClose, onOnboarded }: { onClose: () => void; onOnboarded: () => void }) {
  const [pan, setPan] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [interest, setInterest] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneCode, setDoneCode] = useState<string | null>(null);

  const verifyPan = async () => {
    const p = pan.trim().toUpperCase();
    if (!PAN_RE.test(p)) { setError('Enter a valid PAN (e.g. ABCDE1234F).'); return; }
    setVerifying(true); setError(null);
    const r = await PartnerService.verifyPan(p);
    setVerifying(false);
    if (!r.ok) { setError(r.error || 'PAN could not be verified.'); return; }
    setPan(p);
    setFullName(r.name || '');
    setVerified(true);
  };

  const canSubmit = verified && fullName.trim() && PHONE_RE.test(phone.trim()) && EMAIL_RE.test(email.trim()) && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true); setError(null);
    const r = await PartnerService.onboardClient({
      full_name: fullName.trim(),
      pan: pan.trim().toUpperCase(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      ...(interest ? { investment_preferences: [interest] } : {}),
    });
    setSubmitting(false);
    if (!r.ok) { setError(r.error || 'Could not onboard the client.'); return; }
    setDoneCode(r.client_code || '');
  };

  const label = 'mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-faint';
  const input = 'w-full rounded-token-md border border-border bg-bg-surface px-3 py-2.5 text-sm text-text-primary outline-none disabled:opacity-60';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-token-xl border border-border bg-bg-elevated shadow-token-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="font-display text-base font-bold text-text-primary">Onboard a client</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary"><X className="h-5 w-5" /></button>
        </div>

        {doneCode ? (
          <div className="p-6 text-center">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 className="h-7 w-7 text-success" />
            </span>
            <h3 className="font-display text-lg font-bold text-text-primary">Client onboarded</h3>
            <p className="mx-auto mt-2 max-w-xs text-sm text-text-secondary">
              <span className="font-semibold text-text-primary">{fullName}</span> is now mapped under you
              {doneCode && <> as <span className="font-mono font-semibold text-text-primary">{doneCode}</span></>}. Your relationship manager will complete KYC and enable their login.
            </p>
            <button type="button" onClick={onOnboarded} className="mt-6 w-full rounded-token-md py-3 text-sm font-bold text-on-accent" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto p-5">
            {/* PAN + verify */}
            <label className="block">
              <span className={label}>PAN</span>
              <div className="flex gap-2">
                <input
                  value={pan}
                  onChange={(e) => { setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)); if (verified) { setVerified(false); setFullName(''); } }}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  disabled={verified}
                  className={`${input} font-mono tracking-widest`}
                />
                {!verified && (
                  <button type="button" onClick={verifyPan} disabled={verifying || pan.length !== 10}
                    className="shrink-0 rounded-token-md px-4 text-sm font-bold text-on-accent disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                    {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
                  </button>
                )}
              </div>
              {verified && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-success">
                  <ShieldCheck className="h-3.5 w-3.5" /> PAN verified
                </p>
              )}
            </label>

            {verified && (
              <>
                <label className="block">
                  <span className={label}>Client name (as per PAN)</span>
                  <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={input} placeholder="Full name" />
                </label>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className={label}>Mobile</span>
                    <input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} className={input} placeholder="10-digit mobile" inputMode="numeric" />
                  </label>
                  <label className="block">
                    <span className={label}>Email</span>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} className={input} placeholder="name@example.com" inputMode="email" />
                  </label>
                </div>
                <label className="block">
                  <span className={label}>Interested in <span className="normal-case text-text-faint">(optional)</span></span>
                  <select value={interest} onChange={(e) => setInterest(e.target.value)} className={input}>
                    <option value="">—</option>
                    {INTERESTS.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                </label>
              </>
            )}

            {error && <div className="rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">{error}</div>}

            <button type="button" disabled={!canSubmit} onClick={submit} className="w-full rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
              {submitting ? 'Onboarding…' : 'Onboard client'}
            </button>
            <p className="text-center text-[11px] text-text-faint">
              Creates the client under you and your relationship manager. KYC (bank, demat, documents) and the client login are completed by your RM.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
