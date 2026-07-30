import React, { useState } from 'react';
import { UserPlus, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card } from '../../../portal/components/Card';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { PartnerService } from '../../services/PartnerService';

interface Props {
  /** Refreshes the snapshot so the new lead appears in My Leads. */
  onSubmitted: () => void;
}

const PRODUCTS = [
  'Mutual Funds',
  'Bonds',
  'Unlisted Shares',
  'Fixed Deposits',
  'Insurance',
  'Not sure yet',
];

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-text-muted">
      {children}
      {required && <span className="ml-0.5 text-accent">*</span>}
    </label>
  );
}

const inputClass =
  'w-full rounded-token-md border border-border bg-bg-surface px-3.5 py-2.5 text-sm text-text-primary outline-none transition-colors focus:border-accent';

/** Partner refers a prospect. Lands in the CRM owned by the partner's own RM. */
export function SubmitLeadPage({ onSubmitted }: Props) {
  const [form, setForm] = useState({
    full_name: '',
    mobile: '',
    email: '',
    city: '',
    interested_product: '',
    remarks: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.full_name.trim().length < 2) {
      setError("Please enter the prospect's name.");
      return;
    }
    if (!/^\d{10}$/.test(form.mobile.trim())) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }

    setBusy(true);
    const res = await PartnerService.submitLead({
      full_name: form.full_name.trim(),
      mobile: form.mobile.trim(),
      email: form.email.trim(),
      city: form.city.trim(),
      interested_product: form.interested_product,
      remarks: form.remarks.trim(),
    });
    setBusy(false);

    if (!res.ok) {
      setError(res.error || 'Could not submit this lead.');
      return;
    }
    setDone(res.lead_code ?? '');
    setForm({ full_name: '', mobile: '', email: '', city: '', interested_product: '', remarks: '' });
    onSubmitted();
  };

  if (done !== null) {
    return (
      <Card className="mx-auto max-w-lg">
        <div className="py-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
          <h3 className="text-lg font-bold text-text-primary">Lead submitted</h3>
          <p className="mt-2 text-sm text-text-muted">
            Your relationship manager has been notified and will follow up.
            {done && (
              <>
                {' '}Reference <span className="font-mono text-text-secondary">{done}</span>.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => setDone(null)}
            className="mt-6 rounded-token-md border border-border bg-bg-surface px-4 py-2 text-xs font-semibold text-text-primary transition-colors hover:text-accent"
          >
            Submit another
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="mx-auto max-w-lg">
      <SectionHeader title="Refer a Prospect" icon={UserPlus} />
      <p className="mt-3 text-sm text-text-muted">
        Share their details and your relationship manager will take it from there.
        Only name and mobile are required.
      </p>

      {error && (
        <div className="mt-5 flex items-start gap-2.5 rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-soft" />
          <p className="text-sm text-danger-soft">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <Label required>Full Name</Label>
          <input
            className={inputClass}
            value={form.full_name}
            onChange={(e) => set('full_name', e.target.value)}
            placeholder="Prospect's full name"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label required>Mobile</Label>
            <input
              className={`${inputClass} font-mono`}
              value={form.mobile}
              onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit number"
              inputMode="numeric"
            />
          </div>
          <div>
            <Label>City</Label>
            <input
              className={inputClass}
              value={form.city}
              onChange={(e) => set('city', e.target.value)}
              placeholder="City"
            />
          </div>
        </div>

        <div>
          <Label>Email</Label>
          <input
            className={inputClass}
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="Optional"
          />
        </div>

        <div>
          <Label>Interested In</Label>
          <select
            className={inputClass}
            value={form.interested_product}
            onChange={(e) => set('interested_product', e.target.value)}
          >
            <option value="">Select a product (optional)</option>
            {PRODUCTS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div>
          <Label>Notes for your RM</Label>
          <textarea
            className={`${inputClass} min-h-[88px] resize-y`}
            value={form.remarks}
            onChange={(e) => set('remarks', e.target.value)}
            placeholder="Anything useful — best time to call, what they asked about…"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
        >
          {busy ? 'Submitting…' : 'Submit Lead'}
        </button>
      </form>
    </Card>
  );
}
