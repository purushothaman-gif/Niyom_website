/**
 * Client profile editing: contact details, nominees and bank accounts.
 *
 * Every change is a two-step modal — fill the form, then confirm with a code
 * emailed to the registered address — and is applied by the
 * client-profile-update edge function, which also logs it and alerts the RM.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { CheckCircle2, Loader2, Mail, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import type { NWClient } from '../../../crm/types';
import { NOMINEE_RELATIONSHIPS } from '../../../../supabase/functions/_shared/profile/investorProfile';
import { ProfileEditService, type Nominee, type ProfileChange } from '../../../../shared/portal/services/ProfileEditService';

const inputCls =
  'w-full rounded-token-md border border-border bg-bg-base px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-accent';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-text-secondary">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-text-faint">{hint}</span>}
    </label>
  );
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="m-sheet fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <div
        className="m-sheet-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-token-xl border border-border bg-modal shadow-token-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h3 className="font-display text-base font-bold text-text-primary">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-text-secondary hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function ErrorBox({ text }: { text: string | null }) {
  if (!text) return null;
  return <div className="rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">{text}</div>;
}

/**
 * Step 2 of every change: send a code to the registered email, enter it, apply.
 */
function OtpStep({
  summary,
  change,
  busyLabel = 'Saving…',
  onBack,
  onDone,
}: {
  summary: ReactNode;
  change: ProfileChange;
  busyLabel?: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState<'send' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const send = async () => {
    setBusy('send');
    setError(null);
    const r = await ProfileEditService.requestOtp();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setSentTo(r.email_masked ?? 'your registered email');
  };

  useEffect(() => {
    void send();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    setBusy('apply');
    setError(null);
    const r = await ProfileEditService.apply(otp.trim(), change);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setDone(true);
    setTimeout(onDone, 1200);
  };

  if (done) {
    return (
      <div className="flex flex-col items-center py-6 text-center">
        <CheckCircle2 className="h-12 w-12 text-success" />
        <p className="mt-3 font-display text-base font-bold text-text-primary">Saved</p>
        <p className="mt-1 text-sm text-text-secondary">Your relationship manager has been notified.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-token-md border border-border bg-bg-surface p-3 text-xs text-text-secondary">{summary}</div>
      <div className="flex items-start gap-2 text-sm text-text-secondary">
        <Mail className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        {busy === 'send' ? (
          <span>Sending a code…</span>
        ) : sentTo ? (
          <span>
            We sent a 6-digit code to <b className="text-text-primary">{sentTo}</b>.{' '}
            <button type="button" onClick={() => void send()} className="font-semibold text-accent underline underline-offset-2">
              Resend
            </button>
          </span>
        ) : (
          <span>We&rsquo;ll email a code to your registered address.</span>
        )}
      </div>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={otp}
        onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
        placeholder="6-digit code"
        className={`${inputCls} text-center font-mono text-lg tracking-[0.5em]`}
      />
      <ErrorBox text={error} />
      <div className="flex justify-between gap-2">
        <button type="button" onClick={onBack} className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted">
          Back
        </button>
        <button
          type="button"
          disabled={otp.length !== 6 || !!busy}
          onClick={() => void apply()}
          className="inline-flex items-center gap-2 rounded-token-md bg-accent px-5 py-2.5 text-sm font-bold text-on-accent disabled:opacity-50"
        >
          {busy === 'apply' && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy === 'apply' ? busyLabel : 'Confirm & save'}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ contact */

export function EditContactModal({ client, onClose, onSaved }: { client: NWClient; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    phone: client.phone ?? '',
    email: client.email ?? '',
    address: client.address ?? '',
    city: client.city ?? '',
    state: client.state ?? '',
    pincode: (client as { pincode?: string | null }).pincode ?? '',
  });
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [error, setError] = useState<string | null>(null);

  const original: Record<string, string> = {
    phone: client.phone ?? '',
    email: client.email ?? '',
    address: client.address ?? '',
    city: client.city ?? '',
    state: client.state ?? '',
    pincode: (client as { pincode?: string | null }).pincode ?? '',
  };
  const changed = Object.fromEntries(Object.entries(form).filter(([k, v]) => v.trim() !== original[k].trim()));
  const labels: Record<string, string> = { phone: 'Mobile', email: 'Email', address: 'Address', city: 'City', state: 'State', pincode: 'PIN code' };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Shell title="Edit contact details" onClose={onClose}>
      {step === 'form' ? (
        <div className="space-y-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Mobile number">
              <input className={inputCls} value={form.phone} onChange={set('phone')} inputMode="tel" maxLength={14} />
            </Field>
            <Field label="Email" hint="Used for statements and alerts. Your sign-in stays the same.">
              <input className={inputCls} value={form.email} onChange={set('email')} type="email" />
            </Field>
          </div>
          <Field label="Address">
            <textarea className={inputCls} rows={2} value={form.address} onChange={set('address')} />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field label="City">
              <input className={inputCls} value={form.city} onChange={set('city')} />
            </Field>
            <Field label="State">
              <input className={inputCls} value={form.state} onChange={set('state')} />
            </Field>
            <Field label="PIN code">
              <input className={inputCls} value={form.pincode} onChange={set('pincode')} inputMode="numeric" maxLength={6} />
            </Field>
          </div>
          <ErrorBox text={error} />
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => (Object.keys(changed).length ? setStep('otp') : setError('Change at least one detail first.'))}
              className="rounded-token-md bg-accent px-5 py-2.5 text-sm font-bold text-on-accent"
            >
              Continue
            </button>
          </div>
        </div>
      ) : (
        <OtpStep
          change={{ kind: 'contact', ...changed }}
          summary={
            <ul className="space-y-1">
              {Object.entries(changed).map(([k, v]) => (
                <li key={k}>
                  <b className="text-text-primary">{labels[k]}:</b> {original[k] || '—'} → <b className="text-text-primary">{v}</b>
                </li>
              ))}
            </ul>
          }
          onBack={() => setStep('form')}
          onDone={onSaved}
        />
      )}
    </Shell>
  );
}

/* ------------------------------------------------------------ nominees */

// The exchange's own relationship list, shared with onboarding, so a nominee
// added here can be sent to BSE as is. Older rows may hold a value that is no
// longer offered ("Spouse"); it stays selectable for that row until changed.
const RELATIONSHIPS: readonly string[] = NOMINEE_RELATIONSHIPS;

const blankNominee = (share: number): Nominee => ({
  full_name: '',
  relationship: '',
  dob: null,
  share_percent: share,
  guardian_name: null,
  mobile: null,
  email: null,
  address: null,
});

function isMinor(dob: string | null): boolean {
  if (!dob) return false;
  const d = new Date(dob);
  const t = new Date();
  let age = t.getFullYear() - d.getFullYear();
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) age--;
  return age < 18;
}

export function EditNomineesModal({ current, onClose, onSaved }: { current: Nominee[]; onClose: () => void; onSaved: () => void }) {
  const [list, setList] = useState<Nominee[]>(current.length ? current.map((n) => ({ ...n })) : [blankNominee(100)]);
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [error, setError] = useState<string | null>(null);
  const total = list.reduce((s, n) => s + (Number(n.share_percent) || 0), 0);
  const upd = (i: number, patch: Partial<Nominee>) => setList((l) => l.map((n, j) => (j === i ? { ...n, ...patch } : n)));

  const next = () => {
    if (list.some((n) => n.full_name.trim().length < 2)) return setError('Enter every nominee’s full name.');
    if (list.some((n) => isMinor(n.dob) && !(n.guardian_name ?? '').trim())) return setError('A minor nominee needs a guardian’s name.');
    if (list.length && Math.abs(total - 100) > 0.001) return setError(`Shares must add up to 100% (now ${total}%).`);
    setError(null);
    setStep('otp');
  };

  return (
    <Shell title="Nominees" onClose={onClose}>
      {step === 'form' ? (
        <div className="space-y-4">
          {list.map((n, i) => (
            <div key={i} className="rounded-token-lg border border-border bg-bg-surface p-3.5">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">Nominee {i + 1}</span>
                <button type="button" onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="text-text-faint hover:text-danger" aria-label="Remove nominee">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full name">
                  <input className={inputCls} value={n.full_name} onChange={(e) => upd(i, { full_name: e.target.value })} />
                </Field>
                <Field label="Relationship">
                  <select className={inputCls} value={n.relationship} onChange={(e) => upd(i, { relationship: e.target.value })}>
                    {!n.relationship && <option value="">Select…</option>}
                    {!!n.relationship && !RELATIONSHIPS.includes(n.relationship) && <option>{n.relationship}</option>}
                    {RELATIONSHIPS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Date of birth">
                  <input className={inputCls} type="date" value={n.dob ?? ''} onChange={(e) => upd(i, { dob: e.target.value || null })} />
                </Field>
                <Field label="Share %">
                  <input className={inputCls} type="number" min={1} max={100} step="0.01" value={n.share_percent} onChange={(e) => upd(i, { share_percent: Number(e.target.value) })} />
                </Field>
                {isMinor(n.dob) && (
                  <div className="sm:col-span-2">
                    <Field label="Guardian's name (nominee is a minor)">
                      <input className={inputCls} value={n.guardian_name ?? ''} onChange={(e) => upd(i, { guardian_name: e.target.value })} />
                    </Field>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button
              type="button"
              disabled={list.length >= 10}
              onClick={() => setList((l) => [...l, blankNominee(Math.max(0, 100 - total))])}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent disabled:opacity-40"
            >
              <Plus className="h-4 w-4" /> Add nominee
            </button>
            <span className={`text-xs font-semibold ${Math.abs(total - 100) < 0.001 || !list.length ? 'text-success' : 'text-warning'}`}>
              Total {total}%
            </span>
          </div>
          {!list.length && <p className="text-xs text-text-secondary">Saving with no nominees removes all nominees from your profile.</p>}
          <ErrorBox text={error} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted">
              Cancel
            </button>
            <button type="button" onClick={next} className="rounded-token-md bg-accent px-5 py-2.5 text-sm font-bold text-on-accent">
              Continue
            </button>
          </div>
        </div>
      ) : (
        <OtpStep
          change={{ kind: 'nominees', nominees: list }}
          summary={
            list.length ? (
              <ul className="space-y-1">
                {list.map((n, i) => (
                  <li key={i}>
                    <b className="text-text-primary">{n.full_name}</b> · {n.relationship} · {n.share_percent}%
                  </li>
                ))}
              </ul>
            ) : (
              'Remove all nominees'
            )
          }
          onBack={() => setStep('form')}
          onDone={onSaved}
        />
      )}
    </Shell>
  );
}

/* ---------------------------------------------------------------- bank */

export function AddBankModal({ holderName, onClose, onSaved }: { holderName: string; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ account_number: '', confirm: '', ifsc: '', holder_name: holderName, make_primary: false });
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [error, setError] = useState<string | null>(null);

  const next = () => {
    const acc = form.account_number.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9]{6,40}$/.test(acc)) return setError('Enter a valid account number.');
    if (acc !== form.confirm.replace(/\s+/g, '')) return setError('The two account numbers don’t match.');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.ifsc.trim().toUpperCase())) return setError('Enter a valid 11-character IFSC (e.g. HDFC0001234).');
    if (form.holder_name.trim().length < 2) return setError('Enter the account holder’s name as printed on your cheque book.');
    setError(null);
    setStep('otp');
  };

  return (
    <Shell title="Add a bank account" onClose={onClose}>
      {step === 'form' ? (
        <div className="space-y-3.5">
          <Field label="Account number">
            <input className={inputCls} value={form.account_number} onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))} inputMode="numeric" autoComplete="off" />
          </Field>
          <Field label="Re-enter account number">
            <input className={inputCls} value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} inputMode="numeric" autoComplete="off" onPaste={(e) => e.preventDefault()} />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="IFSC">
              <input className={`${inputCls} uppercase`} value={form.ifsc} onChange={(e) => setForm((f) => ({ ...f, ifsc: e.target.value.toUpperCase() }))} maxLength={11} />
            </Field>
            <Field label="Account holder name">
              <input className={inputCls} value={form.holder_name} onChange={(e) => setForm((f) => ({ ...f, holder_name: e.target.value }))} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={form.make_primary} onChange={(e) => setForm((f) => ({ ...f, make_primary: e.target.checked }))} />
            Make this my primary account
          </label>
          <p className="flex items-start gap-2 rounded-token-md bg-bg-surface p-3 text-[11px] leading-relaxed text-text-secondary">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-accent" />
            Your relationship manager reviews and approves new bank accounts — usually within one working day. Until then the account shows as “Awaiting approval” and isn’t used for payouts.
          </p>
          <ErrorBox text={error} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted">
              Cancel
            </button>
            <button type="button" onClick={next} className="rounded-token-md bg-accent px-5 py-2.5 text-sm font-bold text-on-accent">
              Continue
            </button>
          </div>
        </div>
      ) : (
        <OtpStep
          change={{
            kind: 'bank_add',
            account_number: form.account_number.replace(/\s+/g, ''),
            ifsc: form.ifsc.trim().toUpperCase(),
            holder_name: form.holder_name.trim(),
            make_primary: form.make_primary,
          }}
          summary={
            <>
              Add account ending <b className="text-text-primary">{form.account_number.slice(-4)}</b> · IFSC{' '}
              <b className="text-text-primary">{form.ifsc.toUpperCase()}</b>
              {form.make_primary ? ' · as primary' : ''} — sent to your RM for approval
            </>
          }
          onBack={() => setStep('form')}
          onDone={onSaved}
        />
      )}
    </Shell>
  );
}

export function BankActionModal({
  action,
  label,
  onClose,
  onSaved,
}: {
  action: { kind: 'bank_delete' | 'bank_primary'; id: string };
  label: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Shell title={action.kind === 'bank_delete' ? 'Remove bank account' : 'Change primary account'} onClose={onClose}>
      <OtpStep
        change={action}
        summary={action.kind === 'bank_delete' ? <>Remove <b className="text-text-primary">{label}</b> from your profile.</> : <>Make <b className="text-text-primary">{label}</b> your primary account.</>}
        onBack={onClose}
        onDone={onSaved}
      />
    </Shell>
  );
}
