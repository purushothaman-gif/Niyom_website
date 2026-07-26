import { useState } from 'react';
import {
  Landmark, Upload, CheckCircle2, AlertCircle, X, Loader2, Sparkles, PartyPopper, FileText,
} from 'lucide-react';
import type { NWClient } from '../../../crm/types';
import { StatusPill } from '../../components/StatusPill';
import { OnboardingService } from './onboardingService';
import { ACTIVATABLE_PRODUCTS, activatableProducts } from './onboardingSteps';

interface Props {
  client: NWClient | null;
  clientId: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Post-onboarding product activation. An active client enables Bonds and/or
 * Unlisted Shares by supplying their demat (BO ID) + DP name and uploading a
 * Demat proof (CML). The CML upload flips cml_uploaded server-side; a second
 * call records the products and notifies the RM (who verifies before dealing).
 */
export function ActivateProductsModal({ client, clientId, onClose, onDone }: Props) {
  const canAdd = activatableProducts(client); // e.g. ['bonds','unlisted_shares']
  const [selected, setSelected] = useState<string[]>(canAdd);
  const [demat, setDemat] = useState(client?.demat_account || '');
  const [dpName, setDpName] = useState(client?.dp_name || '');
  const [cmlDone, setCmlDone] = useState(!!client?.cml_uploaded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const clientCode = client?.client_code || '';
  const toggle = (v: string) => setSelected((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));

  const canSubmit = selected.length > 0 && demat.trim().length >= 8 && dpName.trim().length > 0 && cmlDone;

  const uploadCml = async (file: File | null) => {
    if (!file) return;
    setError('');
    setBusy(true);
    const r = await OnboardingService.uploadDoc(clientId, clientCode, 'CML', file);
    setBusy(false);
    if (!r.ok) return setError(r.error || 'Could not upload the CML. Please try again.');
    setCmlDone(true);
  };

  const submit = async () => {
    setError('');
    if (selected.length === 0) return setError('Select at least one product to activate.');
    if (demat.trim().length < 8 || !dpName.trim()) return setError('Enter your demat account (BO ID) and DP name.');
    if (!cmlDone) return setError('Please upload your Demat proof (CML).');
    setBusy(true);
    const r = await OnboardingService.activateProducts(clientId, selected, demat.trim(), dpName.trim());
    setBusy(false);
    if (!r.ok) return setError(r.error || 'Could not activate products. Please try again.');
    setDone(true);
    onDone();
  };

  const labelFor = (v: string) => ACTIVATABLE_PRODUCTS.find((p) => p.value === v)?.label ?? v;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-token-xl border border-border bg-modal shadow-token-lg">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-modal px-6 py-4">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-bold text-text-primary">Activate Bonds &amp; Unlisted Shares</h3>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="space-y-4 p-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-success-soft/30 bg-success-soft/10 text-success-soft">
              <PartyPopper className="h-7 w-7" />
            </div>
            <h4 className="font-display text-lg font-bold text-text-primary">Request received</h4>
            <p className="mx-auto max-w-sm text-sm text-text-muted">
              {selected.map(labelFor).join(' & ')} {selected.length > 1 ? 'are' : 'is'} being activated. Your
              relationship manager will verify your Demat proof and confirm — usually within 24 hours.
            </p>
            <button
              onClick={onClose}
              className="press mt-2 inline-flex items-center justify-center rounded-token-md px-6 py-2.5 text-sm font-bold text-text-on-accent"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-5 p-6">
            <div className="flex items-start gap-2 rounded-token-md border border-accent/15 bg-accent/5 p-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <p className="text-xs leading-relaxed text-text-muted">
                Bonds &amp; Unlisted Shares settle into your demat account. Add your demat (BO ID) and a Demat
                proof (CML) to enable them.
              </p>
            </div>

            {error && (
              <div className="flex items-center gap-2.5 rounded-token-md border border-danger-soft/20 bg-danger-soft/10 px-3.5 py-3">
                <AlertCircle className="h-4 w-4 shrink-0 text-danger-soft" />
                <p className="text-sm text-danger-soft">{error}</p>
              </div>
            )}

            {/* Products to activate */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Products to activate</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {canAdd.map((v) => {
                  const on = selected.includes(v);
                  return (
                    <button
                      key={v} type="button" onClick={() => toggle(v)}
                      className={`flex items-center justify-between rounded-token-md border px-3.5 py-3 text-left text-sm transition-colors ${
                        on ? 'border-accent/40 bg-selected text-text-primary' : 'border-border bg-bg-base text-text-muted hover:text-text-primary'
                      }`}
                    >
                      <span className="font-semibold">{labelFor(v)}</span>
                      {on ? <CheckCircle2 className="h-4 w-4 text-accent" /> : <span className="h-4 w-4 rounded-full border border-border" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Demat details */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Demat Account (BO ID) <span className="text-accent">*</span>
                </label>
                <input
                  value={demat}
                  onChange={(e) => setDemat(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 16))}
                  placeholder="1234567890123456"
                  className="w-full rounded-token-md border border-border bg-bg-base px-3.5 py-2.5 font-mono text-sm text-text-primary outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                  DP Name <span className="text-accent">*</span>
                </label>
                <input
                  value={dpName}
                  onChange={(e) => setDpName(e.target.value)}
                  placeholder="HDFC Securities"
                  className="w-full rounded-token-md border border-border bg-bg-base px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* CML upload */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">Demat proof (CML)</p>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-token-md border px-3.5 py-3 transition-colors ${
                  cmlDone ? 'border-success-soft/30 bg-success-soft/5' : 'border-border bg-bg-base hover:border-accent/40'
                }`}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-token-sm ${cmlDone ? 'bg-success-soft/10' : 'bg-accent/10'}`}>
                  {cmlDone ? <CheckCircle2 className="h-4 w-4 text-success-soft" /> : <FileText className="h-4 w-4 text-accent" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-text-primary">Client Master List (CML)</span>
                  <span className="block text-xs text-text-muted">{cmlDone ? 'Uploaded — tap to replace' : 'PDF, JPG or PNG'}</span>
                </span>
                {!cmlDone && <StatusPill tone="accent">Required</StatusPill>}
                {busy ? <Loader2 className="h-4 w-4 animate-spin text-text-muted" /> : <Upload className="h-4 w-4 text-text-muted" />}
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => uploadCml(e.target.files?.[0] || null)} />
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button" onClick={onClose}
                className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted"
              >
                Cancel
              </button>
              <button
                onClick={submit} disabled={busy || !canSubmit}
                className="press flex items-center gap-2 rounded-token-md px-5 py-2.5 text-sm font-bold text-text-on-accent disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Activate
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
