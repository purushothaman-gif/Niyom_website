import { useState } from 'react';
import {
  CreditCard, FileText, Landmark, ShieldCheck, CheckCircle2, AlertCircle,
  ArrowLeft, ArrowRight, Upload, Loader2, Clock, Sparkles, PartyPopper,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import type { NWClient } from '../../../crm/types';
import type { PortalView } from '../../layout/navigation';
import { Card } from '../../components/Card';
import { Segmented } from '../../components/Segmented';
import { StatusPill } from '../../components/StatusPill';
import { OnboardingService } from './onboardingService';
import { PRODUCTS, cmlRequiredFor, kycUnderReview } from './onboardingSteps';

type StepKey = 'pan' | 'products' | 'documents' | 'review';
type DocType = 'PAN' | 'CML' | 'BANK';

interface Props {
  client: NWClient | null;
  clientId: string;
  onRefresh: () => void;
  onNavigate: (view: PortalView) => void;
}

const STEP_LABELS: Record<StepKey, string> = { pan: 'PAN', products: 'Products', documents: 'Documents', review: 'Review' };

export function OnboardingWizard({ client, clientId, onRefresh, onNavigate }: Props) {
  const [pan, setPan] = useState((client?.pan || '').toUpperCase());
  const [panVerified, setPanVerified] = useState(!!client?.pan_verified);
  const [panName, setPanName] = useState(client?.pan_name || '');
  const [prefs, setPrefs] = useState<string[]>(client?.investment_preferences || []);
  const [uploaded, setUploaded] = useState<Record<DocType, boolean>>({
    PAN: !!client?.pan_doc_uploaded,
    BANK: !!client?.bank_verified,
    CML: !!client?.cml_uploaded,
  });

  const cmlRequired = cmlRequiredFor(prefs);
  // CML (Demat proof) is DEFERRABLE — it doesn't block KYC submission. Only
  // PAN + Bank proof are mandatory; Bonds/Unlisted stay "pending CML" until the
  // client adds it (they can do so here or later).
  const docsComplete = uploaded.PAN && uploaded.BANK;
  const cmlPending = cmlRequired && !uploaded.CML;

  const initialStep: StepKey = !panVerified ? 'pan' : prefs.length === 0 ? 'products' : !docsComplete ? 'documents' : 'review';
  const [step, setStep] = useState<StepKey>(initialStep);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(kycUnderReview(client));

  const clientCode = client?.client_code || '';

  // ── Handlers ───────────────────────────────────────────────────────────
  const verifyPan = async () => {
    setError('');
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return setError('Enter a valid PAN (e.g. ABCDE1234F).');
    setBusy(true);
    const r = await OnboardingService.verifyPan(clientId, pan);
    setBusy(false);
    if (!r.ok) return setError(r.error || 'PAN could not be verified.');
    setPanVerified(true);
    setPanName(r.name || '');
    onRefresh();
    setStep('products');
  };

  const togglePref = (value: string) => {
    setPrefs((p) => (p.includes(value) ? p.filter((x) => x !== value) : [...p, value]));
  };

  const allSelected = prefs.length === PRODUCTS.length;
  const toggleSelectAll = () => setPrefs(allSelected ? [] : PRODUCTS.map((p) => p.value));

  const saveProductsAndNext = async () => {
    setError('');
    if (prefs.length === 0) return setError('Select at least one product you want to access.');
    // Auto-save the client's own choices so a later resume restores them.
    setBusy(true);
    try {
      await supabase.from('nw_clients')
        .update({ investment_preferences: prefs, cml_required: cmlRequiredFor(prefs) })
        .eq('id', clientId);
      onRefresh();
    } catch { /* non-fatal — prefs still held in wizard state */ }
    setBusy(false);
    setStep('documents');
  };

  const handleUpload = async (docType: DocType, file: File | null) => {
    if (!file) return;
    setError('');
    setBusy(true);
    const r = await OnboardingService.uploadDoc(clientId, clientCode, docType, file);
    setBusy(false);
    if (!r.ok) return setError(r.error || 'Upload failed. Please try again.');
    setUploaded((u) => ({ ...u, [docType]: true }));
    onRefresh();
  };

  const submit = async () => {
    setError('');
    if (!panVerified) return setError('Please verify your PAN first.');
    if (!docsComplete) return setError('Please upload all required documents.');
    setBusy(true);
    const r = await OnboardingService.submit(clientId, prefs);
    setBusy(false);
    if (!r.ok) return setError(r.error || 'Submission failed. Please try again.');
    onRefresh();
    setSubmitted(true);
  };

  const stepOptions = (['pan', 'products', 'documents', 'review'] as StepKey[]).map((k) => ({ value: k, label: STEP_LABELS[k] }));

  // ── Terminal states ────────────────────────────────────────────────────
  if (client?.onboarding_status === 'active') {
    return (
      <StatusScreen
        icon={PartyPopper}
        tone="success"
        title="You're ready to invest"
        body="Your account is fully activated. Explore products and start building your portfolio."
        cta="Go to Dashboard"
        onClick={() => onNavigate('dashboard')}
      />
    );
  }
  if (submitted) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <StatusScreen
          icon={Clock}
          tone="warning"
          title="KYC Under Review"
          body="Thanks — we've received your details. Your relationship manager will review and activate your account, usually within 24 hours. We'll notify you by email and SMS."
          cta="Back to Dashboard"
          onClick={() => onNavigate('dashboard')}
        />
        {cmlPending && (
          <Card>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-bold text-text-primary">Add your Demat Proof (CML)</h3>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Optional — needed only to activate <strong>Bonds &amp; Unlisted Shares</strong>. Add it now or anytime later.
            </p>
            <div className="mt-3">
              <UploadRow icon={FileText} label="Demat Proof (CML)" optional
                hint="Tap to upload — unlocks Bonds & Unlisted Shares" done={uploaded.CML} busy={busy}
                onFile={(f) => handleUpload('CML', f)} />
            </div>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-1.5 text-accent">
          <Sparkles className="h-3.5 w-3.5" />
          <p className="text-xs font-semibold uppercase tracking-widest">Complete Your KYC</p>
        </div>
        <h1 className="mt-1 font-display text-2xl font-bold text-text-primary">Activate investing</h1>
        <p className="mt-1 text-sm text-text-muted">One step at a time — about 5 minutes. Your progress is saved automatically.</p>
      </div>

      <Segmented options={stepOptions} value={step} onChange={(v) => setStep(v)} />

      {error && (
        <div className="flex items-center gap-2.5 rounded-token-md border border-danger-soft/20 bg-danger-soft/10 px-3.5 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-danger-soft" />
          <p className="text-sm text-danger-soft">{error}</p>
        </div>
      )}

      <Card>
        {/* ── PAN ── */}
        {step === 'pan' && (
          <div className="space-y-5">
            <StepTitle icon={CreditCard} title="Verify your PAN" hint="We verify instantly and fetch your name — no typing needed." />
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">PAN Number</label>
              <input
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                placeholder="ABCDE1234F" maxLength={10} disabled={panVerified}
                className="w-full rounded-token-md border border-border bg-bg-base px-3.5 py-2.5 font-mono text-sm tracking-widest text-text-primary outline-none focus:border-accent disabled:opacity-60"
              />
            </div>
            {panVerified && (
              <div className="rounded-token-md border border-success-soft/20 bg-success-soft/10 p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-success-soft">Verified — Name as per PAN</p>
                <p className="mt-0.5 text-sm font-semibold text-text-primary">{panName || client?.full_name}</p>
              </div>
            )}
            <div className="flex justify-end">
              {panVerified ? (
                <NextButton onClick={() => setStep('products')} />
              ) : (
                <PrimaryButton onClick={verifyPan} busy={busy} icon={ShieldCheck}>Verify PAN</PrimaryButton>
              )}
            </div>
          </div>
        )}

        {/* ── Products ── */}
        {step === 'products' && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-3">
              <StepTitle icon={Sparkles} title="What would you like to access?" hint="Pick what you're interested in — unlock everything now, change it anytime." />
              <button type="button" onClick={toggleSelectAll}
                className="shrink-0 rounded-token-md border border-accent/30 bg-accent/10 px-3 py-1.5 text-xs font-bold text-accent transition-colors hover:bg-accent/15">
                {allSelected ? 'Clear all' : <>Select all <span className="opacity-75">(recommended)</span></>}
              </button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <ProductCategory
                title="Mutual Funds, FDs & Insurance"
                docNote="Documents: PAN Card + Bank proof"
                values={['mutual_funds', 'fixed_deposits', 'insurance']}
                prefs={prefs} onToggle={togglePref}
              />
              <ProductCategory
                title="Bonds & Unlisted Shares"
                docNote="Documents: PAN Card + Bank proof + Demat Proof (CML)"
                highlight
                values={['bonds', 'unlisted_shares']}
                prefs={prefs} onToggle={togglePref}
              />
            </div>

            <div className="flex justify-between">
              <BackButton onClick={() => setStep('pan')} />
              <PrimaryButton onClick={saveProductsAndNext} busy={busy} icon={ArrowRight}>Continue</PrimaryButton>
            </div>
          </div>
        )}

        {/* ── Documents ── */}
        {step === 'documents' && (
          <div className="space-y-5">
            <StepTitle icon={FileText} title="Upload your KYC documents" hint="PDF, JPG or PNG. Your files are encrypted and confidential." />
            <div className="space-y-3">
              <UploadRow icon={CreditCard} label="PAN Card Copy" required done={uploaded.PAN} busy={busy} onFile={(f) => handleUpload('PAN', f)} />
              <UploadRow icon={Landmark} label="Cancelled Cheque or Bank Statement" required done={uploaded.BANK} busy={busy} onFile={(f) => handleUpload('BANK', f)} />
              {cmlRequired && (
                <UploadRow icon={FileText} label="Demat Proof (CML)" optional
                  hint="For Bonds & Unlisted Shares — add now or later" done={uploaded.CML} busy={busy} onFile={(f) => handleUpload('CML', f)} />
              )}
            </div>
            {cmlPending && (
              <p className="text-xs text-text-muted">
                The Demat Proof (CML) is optional — you can submit now and add it later; Bonds &amp;
                Unlisted Shares activate once it's uploaded.
              </p>
            )}
            <div className="flex justify-between">
              <BackButton onClick={() => setStep('products')} />
              <NextButton onClick={() => setStep('review')} disabled={!docsComplete} />
            </div>
          </div>
        )}

        {/* ── Review ── */}
        {step === 'review' && (
          <div className="space-y-5">
            <StepTitle icon={CheckCircle2} title="Review & submit" hint="Check everything looks right. You can edit any step before submitting." />
            <ReviewRow label="Name as per PAN" value={panName || client?.full_name || '—'} onEdit={() => setStep('pan')} />
            <ReviewRow label="PAN" value={pan} onEdit={() => setStep('pan')} />
            <ReviewRow
              label="Products"
              value={prefs.length ? prefs.map((v) => PRODUCTS.find((p) => p.value === v)?.label).join(', ') : '—'}
              onEdit={() => setStep('products')}
            />
            <div className="rounded-token-md border border-border">
              <div className="flex items-center justify-between px-4 py-2.5">
                <p className="text-xs font-medium text-text-secondary">Documents</p>
                <button onClick={() => setStep('documents')} className="text-xs font-semibold text-accent">Edit</button>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
                {(['PAN', 'BANK', ...(cmlRequired ? ['CML'] : [])] as DocType[]).map((t) => {
                  const isCml = t === 'CML';
                  const ok = uploaded[t];
                  const name = t === 'BANK' ? 'Bank Proof' : t === 'PAN' ? 'PAN Card' : 'Demat Proof (CML)';
                  return (
                    <StatusPill key={t} tone={ok ? 'success' : isCml ? 'muted' : 'danger'}>
                      {ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                      {name}{isCml && !ok ? ' · optional' : ''}
                    </StatusPill>
                  );
                })}
              </div>
            </div>
            <p className="rounded-token-md border border-accent/15 bg-accent/5 p-3.5 text-xs leading-relaxed text-text-muted">
              By submitting, you confirm the information is accurate and consent to Niyom Wealth Distribution LLP processing it for account activation and KYC verification.
            </p>
            <div className="flex justify-between">
              <BackButton onClick={() => setStep('documents')} />
              <PrimaryButton onClick={submit} busy={busy} icon={ShieldCheck} disabled={!panVerified || !docsComplete}>
                Submit for Review
              </PrimaryButton>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Small building blocks ─────────────────────────────────────────────────
function StepTitle({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint: string }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-bold text-text-primary">{title}</h2>
      </div>
      <p className="mt-1 text-xs text-text-muted">{hint}</p>
    </div>
  );
}

// A product category column with the required documents stated in its header.
function ProductCategory({ title, docNote, values, prefs, onToggle, highlight }:
  { title: string; docNote: string; values: string[]; prefs: string[]; onToggle: (v: string) => void; highlight?: boolean }) {
  return (
    <div className={`rounded-token-md border p-3 ${highlight ? 'border-accent/30 bg-accent/5' : 'border-border bg-bg-base'}`}>
      <div className="mb-2 px-0.5">
        <p className="text-xs font-bold text-text-primary">{title}</p>
        <p className="text-[11px] text-text-muted">{docNote}</p>
      </div>
      <div className="space-y-2">
        {values.map((v) => {
          const label = PRODUCTS.find((p) => p.value === v)?.label ?? v;
          const on = prefs.includes(v);
          return (
            <button
              key={v} type="button" onClick={() => onToggle(v)}
              className={`flex w-full items-center justify-between rounded-token-sm border px-3 py-2.5 text-left text-sm transition-colors ${
                on ? 'border-accent/40 bg-selected text-text-primary' : 'border-border bg-bg-elevated text-text-muted hover:text-text-primary'
              }`}
            >
              <span className="font-semibold">{label}</span>
              {on ? <CheckCircle2 className="h-4 w-4 text-accent" /> : <span className="h-4 w-4 rounded-full border border-border" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UploadRow({ icon: Icon, label, required, optional, hint, done, busy, onFile }:
  { icon: LucideIcon; label: string; required?: boolean; optional?: boolean; hint?: string; done: boolean; busy: boolean; onFile: (f: File | null) => void }) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-token-md border px-3.5 py-3 transition-colors ${
        done ? 'border-success-soft/30 bg-success-soft/5' : 'border-border bg-bg-base hover:border-accent/40'
      }`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-token-sm ${done ? 'bg-success-soft/10' : 'bg-accent/10'}`}>
        {done ? <CheckCircle2 className="h-4 w-4 text-success-soft" /> : <Icon className="h-4 w-4 text-accent" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-text-primary">{label}</span>
        <span className="block text-xs text-text-muted">{done ? 'Uploaded — tap to replace' : (hint || 'Tap to upload')}</span>
      </span>
      {!done && required && <StatusPill tone="accent">Required</StatusPill>}
      {!done && optional && <StatusPill tone="muted">Optional</StatusPill>}
      {busy ? <Loader2 className="h-4 w-4 animate-spin text-text-muted" /> : <Upload className="h-4 w-4 text-text-muted" />}
      <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => onFile(e.target.files?.[0] || null)} />
    </label>
  );
}

function ReviewRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-token-md border border-border px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-text-secondary">{label}</p>
        <p className="truncate text-sm text-text-primary">{value}</p>
      </div>
      <button onClick={onEdit} className="ml-3 shrink-0 text-xs font-semibold text-accent">Edit</button>
    </div>
  );
}

function PrimaryButton({ children, onClick, busy, icon: Icon, disabled }:
  { children: React.ReactNode; onClick: () => void; busy?: boolean; icon?: any; disabled?: boolean }) {
  return (
    <button
      onClick={onClick} disabled={busy || disabled}
      className="press flex items-center gap-2 rounded-token-md px-6 py-2.5 text-sm font-bold text-text-on-accent disabled:opacity-50"
      style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

function NextButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      className="press flex items-center gap-2 rounded-token-md px-6 py-2.5 text-sm font-bold text-text-on-accent disabled:opacity-50"
      style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
    >
      Continue <ArrowRight className="h-4 w-4" />
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 rounded-token-md border border-border bg-bg-raised px-5 py-2.5 text-sm font-semibold text-text-muted">
      <ArrowLeft className="h-4 w-4" /> Back
    </button>
  );
}

function StatusScreen({ icon: Icon, tone, title, body, cta, onClick }:
  { icon: LucideIcon; tone: 'success' | 'warning'; title: string; body: string; cta: string; onClick: () => void }) {
  const ring = tone === 'success' ? 'border-success-soft/30 bg-success-soft/10 text-success-soft' : 'border-warning-soft/30 bg-warning-soft/10 text-warning-soft';
  return (
    <div className="mx-auto max-w-lg">
      <Card className="animate-fadeInUp text-center">
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full border ${ring}`}>
          <Icon className="h-8 w-8" />
        </div>
        <h1 className="mt-4 font-display text-2xl font-bold text-text-primary">{title}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">{body}</p>
        <button
          onClick={onClick}
          className="press mt-6 inline-flex items-center gap-2 rounded-token-md px-6 py-3 text-sm font-bold text-text-on-accent"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
        >
          {cta} <ArrowRight className="h-4 w-4" />
        </button>
      </Card>
    </div>
  );
}
