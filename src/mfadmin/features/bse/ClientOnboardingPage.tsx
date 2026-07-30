/**
 * Client Management — register a client directly at BSE StAR MF.
 *
 * Standalone by design: this creates a UCC from details entered here, with no
 * dependency on CRM records. BSE is the system of record for who can transact,
 * and a client existing elsewhere says nothing about their BSE registration.
 *
 * Registers a PHYSICAL, resident-individual UCC — the shape the proxy's
 * toAddUcc mapper builds and the only one verified end-to-end against BSE.
 * Demat, joint holders and NRI are not offered rather than half-supported.
 */
import { useState } from 'react';
import { ExternalLink, UserPlus, Users } from 'lucide-react';
import { Card } from '../../../portal/components/Card';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { StatusPill } from '../../../portal/components/StatusPill';
import {
  BseOpsService,
  isBseConfigured,
  type BseUccRow,
} from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import {
  ConfirmBox,
  ErrorNote,
  Field,
  NotConfigured,
  SuccessCard,
  inputCls,
  selectCls,
} from './formBits';

interface Form {
  clientCode: string;
  pan: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  gender: 'M' | 'F' | 'O';
  email: string;
  mobile: string;
  line1: string;
  city: string;
  state: string;
  pincode: string;
  accountNumber: string;
  ifsc: string;
  accountType: string;
}

const EMPTY: Form = {
  clientCode: '',
  pan: '',
  firstName: '',
  middleName: '',
  lastName: '',
  dob: '',
  gender: 'M',
  email: '',
  mobile: '',
  line1: '',
  city: '',
  state: '',
  pincode: '',
  accountNumber: '',
  ifsc: '',
  accountType: 'SB',
};

/** BSE encodes entity type in the PAN's 4th character — 'P' for an individual. */
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

function validate(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  if (!f.clientCode.trim()) e.clientCode = 'Required — must be unique for this member.';
  else if (!/^[A-Za-z0-9]{1,20}$/.test(f.clientCode.trim()))
    e.clientCode = 'Letters and numbers only, up to 20 characters.';

  const pan = f.pan.trim().toUpperCase();
  if (!pan) e.pan = 'Required.';
  else if (!PAN_RE.test(pan)) e.pan = 'Format must be ABCDE1234F.';
  else if (pan[3] !== 'P') e.pan = 'Fourth character must be “P” for an individual — BSE rejects others.';

  if (!f.firstName.trim()) e.firstName = 'Required.';
  if (!f.dob) e.dob = 'Required.';
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = 'A valid email is required.';
  if (!/^\d{10}$/.test(f.mobile.replace(/\D/g, ''))) e.mobile = '10-digit mobile number.';
  if (!f.line1.trim()) e.line1 = 'Required.';
  if (!f.city.trim()) e.city = 'Required.';
  if (!f.state.trim()) e.state = 'Required.';
  if (!/^\d{6}$/.test(f.pincode.trim())) e.pincode = '6-digit pincode.';
  if (!/^\d{9,20}$/.test(f.accountNumber.trim()))
    e.accountNumber = 'Account number: 9–20 digits, including leading zeros.';
  if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(f.ifsc.trim()))
    e.ifsc = 'IFSC format, e.g. HDFC0000123.';
  return e;
}

export function ClientOnboardingPage() {
  const uccs = useBseData<BseUccRow[]>(() => BseOpsService.uccs());
  const [form, setForm] = useState<Form>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ clientCode: string; status: string; url?: string } | null>(
    null,
  );

  const errors = validate(form);
  const valid = Object.keys(errors).length === 0;
  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const codeTaken = (uccs.data ?? []).some(
    (u) => u.clientCode.toLowerCase() === form.clientCode.trim().toLowerCase(),
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await BseOpsService.registerUcc({
        clientCode: form.clientCode.trim(),
        pan: form.pan.trim().toUpperCase(),
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim(),
        lastName: form.lastName.trim(),
        dob: form.dob,
        gender: form.gender,
        email: form.email.trim(),
        mobile: form.mobile.replace(/\D/g, '').slice(-10),
        address: {
          line1: form.line1.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          pincode: form.pincode.trim(),
        },
        bank: {
          accountNumber: form.accountNumber.trim(),
          ifsc: form.ifsc.trim().toUpperCase(),
          accountType: form.accountType,
        },
      });
      // Nothing progresses at BSE until the investor approves, so fetch the
      // link immediately rather than making staff hunt for it.
      let url: string | undefined;
      try {
        const links = await BseOpsService.uccTwoFaLink(res.clientCode);
        url = links.links?.[0]?.url;
      } catch {
        /* best effort — registration itself succeeded */
      }
      setDone({ clientCode: res.clientCode, status: res.status, url });
      setForm(EMPTY);
      setTouched(false);
      setConfirming(false);
      uccs.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (!isBseConfigured()) return <NotConfigured title="Client Management" />;

  const err = (k: keyof Form) => (touched ? errors[k] : undefined);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {done && (
        <SuccessCard title="Client registered at BSE">
          <p className="mt-1 text-sm text-text-secondary">
            UCC <span className="font-mono font-semibold">{done.clientCode}</span> created — status{' '}
            {done.status}.
          </p>
          {done.url ? (
            <p className="mt-2 text-xs text-text-secondary">
              Send the investor this approval link — verification only starts once they complete it:{' '}
              <a
                href={done.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
              >
                Open 2FA link <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          ) : (
            <p className="mt-2 text-xs text-text-secondary">
              Generate the investor’s 2FA link from the KYC screen to continue onboarding.
            </p>
          )}
        </SuccessCard>
      )}

      <Card>
        <div className="flex items-start justify-between gap-3">
          <SectionHeader title="Register a client at BSE" icon={UserPlus} />
          <StatusPill tone="muted">
            <Users className="mr-1 inline h-3 w-3 align-[-2px]" />
            {uccs.data?.length ?? 0} registered
          </StatusPill>
        </div>

        {error && <ErrorNote title="The client was not registered." message={error} />}

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client code (UCC)">
              <input
                value={form.clientCode}
                onChange={(e) => set('clientCode')(e.target.value)}
                placeholder="NW0000012"
                className={inputCls}
              />
              {err('clientCode') && <p className="mt-1 text-[11px] text-danger">{err('clientCode')}</p>}
              {!err('clientCode') && codeTaken && (
                <p className="mt-1 text-[11px] text-danger">Already registered at BSE.</p>
              )}
            </Field>
            <Field label="PAN">
              <input
                value={form.pan}
                onChange={(e) => set('pan')(e.target.value.toUpperCase())}
                placeholder="ABCPE1234F"
                className={`${inputCls} font-mono`}
              />
              {err('pan') && <p className="mt-1 text-[11px] text-danger">{err('pan')}</p>}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="First name">
              <input value={form.firstName} onChange={(e) => set('firstName')(e.target.value)} className={inputCls} />
              {err('firstName') && <p className="mt-1 text-[11px] text-danger">{err('firstName')}</p>}
            </Field>
            <Field label="Middle name">
              <input value={form.middleName} onChange={(e) => set('middleName')(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Last name">
              <input value={form.lastName} onChange={(e) => set('lastName')(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date of birth">
              <input type="date" value={form.dob} onChange={(e) => set('dob')(e.target.value)} className={inputCls} />
              {err('dob') && <p className="mt-1 text-[11px] text-danger">{err('dob')}</p>}
            </Field>
            <Field label="Gender">
              <select value={form.gender} onChange={(e) => set('gender')(e.target.value)} className={selectCls}>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="O">Other</option>
              </select>
            </Field>
            <Field label="Mobile">
              <input value={form.mobile} onChange={(e) => set('mobile')(e.target.value)} placeholder="9876543210" className={inputCls} />
              {err('mobile') && <p className="mt-1 text-[11px] text-danger">{err('mobile')}</p>}
            </Field>
          </div>

          <Field label="Email">
            <input value={form.email} onChange={(e) => set('email')(e.target.value)} className={inputCls} />
            {err('email') && <p className="mt-1 text-[11px] text-danger">{err('email')}</p>}
          </Field>

          <Field label="Address">
            <input value={form.line1} onChange={(e) => set('line1')(e.target.value)} placeholder="Flat / street" className={inputCls} />
            {err('line1') && <p className="mt-1 text-[11px] text-danger">{err('line1')}</p>}
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City">
              <input value={form.city} onChange={(e) => set('city')(e.target.value)} className={inputCls} />
              {err('city') && <p className="mt-1 text-[11px] text-danger">{err('city')}</p>}
            </Field>
            <Field label="State">
              <input value={form.state} onChange={(e) => set('state')(e.target.value)} className={inputCls} />
              {err('state') && <p className="mt-1 text-[11px] text-danger">{err('state')}</p>}
            </Field>
            <Field label="Pincode">
              <input value={form.pincode} onChange={(e) => set('pincode')(e.target.value)} className={inputCls} />
              {err('pincode') && <p className="mt-1 text-[11px] text-danger">{err('pincode')}</p>}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Bank account">
              <input value={form.accountNumber} onChange={(e) => set('accountNumber')(e.target.value)} className={inputCls} />
              {err('accountNumber') && <p className="mt-1 text-[11px] text-danger">{err('accountNumber')}</p>}
            </Field>
            <Field label="IFSC">
              <input value={form.ifsc} onChange={(e) => set('ifsc')(e.target.value.toUpperCase())} placeholder="HDFC0000123" className={`${inputCls} font-mono`} />
              {err('ifsc') && <p className="mt-1 text-[11px] text-danger">{err('ifsc')}</p>}
            </Field>
            <Field label="Account type">
              <select value={form.accountType} onChange={(e) => set('accountType')(e.target.value)} className={selectCls}>
                <option value="SB">Savings</option>
                <option value="CB">Current</option>
                <option value="NE">NRE</option>
                <option value="NO">NRO</option>
              </select>
            </Field>
          </div>

          {!confirming ? (
            <button
              type="button"
              onClick={() => {
                setTouched(true);
                setError(null);
                setDone(null);
                if (valid && !codeTaken) setConfirming(true);
              }}
              disabled={touched && (!valid || codeTaken)}
              className="w-full rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              Review Registration
            </button>
          ) : (
            <ConfirmBox
              rows={[
                { label: 'Client code', value: form.clientCode },
                { label: 'Name', value: [form.firstName, form.middleName, form.lastName].filter(Boolean).join(' ') },
                { label: 'PAN', value: form.pan },
                { label: 'Date of birth', value: form.dob },
                { label: 'Contact', value: `${form.email} · ${form.mobile}` },
                { label: 'Bank', value: `${form.ifsc} · ${form.accountNumber} (${form.accountType})` },
                { label: 'Address', value: `${form.city}, ${form.state} ${form.pincode}` },
              ]}
              note="Registers a physical, resident-individual UCC at BSE StAR MF. The investor must then approve a 2FA link before KYC and PAN verification begin."
              busy={busy}
              submitLabel="Register at BSE"
              onBack={() => setConfirming(false)}
              onConfirm={submit}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
