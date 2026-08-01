import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, CheckCircle2, Download, FileText, Loader2, Lock, ShieldCheck, Upload, X,
} from 'lucide-react';
import { fmtDate, fmtFull } from '../../../crm/utils';
import { StatusPill } from '../../components/StatusPill';
import {
  CasImportService,
  type CasImportOutcome,
  type CasImportRecord,
} from '../../services/CasImportService';
import {
  CasRequestService,
  isOpenRequest,
  type CasFormGuidance,
  type CasRequest,
} from '../../services/CasRequestService';
import type { ConsentType } from '../../types/consent';
import { CasConsentStep } from './CasConsentStep';
import { CasRequestStep } from './CasRequestStep';
import { CasAwaitingStep } from './CasAwaitingStep';

/**
 * Import an existing mutual fund portfolio from a Consolidated Account
 * Statement.
 *
 * ## Why this is two steps and not one
 *
 * The statement does not exist yet when a client decides they want this. It is
 * requested from CAMS, who email it to the investor roughly five minutes later.
 * A single upload screen would therefore be a dead end for everyone who has not
 * already been through the process — so the first screen exists to get the
 * request right, and the client returns to the second when the mail arrives.
 *
 * ## Why the first screen is this insistent
 *
 * Four choices on the CAMS form decide whether the resulting file is any use,
 * and all four have a plausible-looking wrong answer:
 *
 *   Detailed, not Summary   a summary carries no transactions and no advisor
 *                           code, so no capital gains and no real returns.
 *   Earliest start date     returns are computed from the whole history.
 *   Zero-balance folios     funds fully exited still carry realised gains.
 *   The registered email    CAMS consolidates by EMAIL, not PAN, so folios held
 *                           under another address are silently absent — the file
 *                           looks complete and simply is not.
 *
 * None of these can be recovered afterwards, and a wrong one costs the client
 * another five-minute round trip, so they are stated before they choose.
 */
interface Props {
  onClose: () => void;
  onImported: () => void;
}

/**
 * consent  what they are authorising
 * request  the registrar's form, prefilled from their own record
 * awaiting the ~5 minutes before the email arrives
 * upload   the statement itself
 * done     the outcome
 *
 * `upload` is reachable from everywhere: a client who already has a statement,
 * or who imported before, should never be walked through the earlier steps.
 */
type Step = 'consent' | 'request' | 'awaiting' | 'upload' | 'done';

export function ImportPortfolioModal({ onClose, onImported }: Props) {
  const [step, setStep] = useState<Step>('consent');
  /**
   * Set as soon as the client navigates, so the asynchronous "have they done
   * this before?" answer can never yank the screen out from under someone who
   * has already started reading or typing.
   */
  const navigated = useRef(false);
  const goTo = (next: Step) => {
    navigated.current = true;
    setStep(next);
  };
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<CasImportOutcome | null>(null);
  const [previous, setPrevious] = useState<CasImportRecord[]>([]);
  const [consents, setConsents] = useState<ConsentType[]>([]);
  const [request, setRequest] = useState<CasRequest | null>(null);
  const [form, setForm] = useState<CasFormGuidance | null>(null);
  const [email, setEmail] = useState('');

  /**
   * Where to open.
   *
   * An open request means they are mid-journey and want to know what happened to
   * it, not to start again. A previous successful import means they know the
   * drill and are holding a file. Only a genuine first-timer sees consent first.
   */
  useEffect(() => {
    let alive = true;
    void Promise.all([CasImportService.listImports(), CasRequestService.latest()]).then(
      ([rows, latest]) => {
        if (!alive) return;
        setPrevious(rows);
        if (latest) setRequest(latest);
        if (latest?.requestedEmail) setEmail(latest.requestedEmail);
        if (navigated.current) return;
        if (latest && isOpenRequest(latest.status)) setStep('awaiting');
        else if (rows.some((r) => r.status === 'reconciled')) setStep('upload');
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  /** Consent granted → create the tracked request and fetch the form values. */
  const startRequest = async () => {
    setError('');
    setBusy(true);
    const r = await CasRequestService.start({ email: email.trim(), consents });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setForm(r.request.form);
    setRequest({
      requestId: r.request.requestId,
      status: r.request.status,
      requestedEmail: email.trim(),
      statementFrom: null,
      statementTo: null,
      expectedBy: r.request.expectedBy,
      importId: null,
      failureReason: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
  };

  const submit = async () => {
    if (!file) return setError('Choose the statement you received by email.');
    if (!password) return setError('Enter the password you set when you requested the statement.');
    setError('');
    setBusy(true);
    const r = await CasImportService.importStatement(file, password, request?.requestId ?? null);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setOutcome(r.outcome);
    setStep('done');
    // The password has done its job; there is no reason to keep it in memory.
    setPassword('');
    if (r.outcome.status === 'reconciled') onImported();
  };

  const lastGood = previous.find((p) => p.status === 'reconciled');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-token-xl border border-border bg-modal shadow-token-lg">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-modal px-6 py-4">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-bold text-text-primary">Import your existing portfolio</h3>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        {step === 'consent' && (
          <CasConsentStep
            onContinue={(granted) => {
              setConsents(granted);
              goTo('request');
            }}
            onClose={onClose}
          />
        )}

        {step === 'request' && (
          <CasRequestStep
            form={form}
            email={email}
            onEmailChange={setEmail}
            busy={busy}
            error={error}
            // Before the request exists this creates it; afterwards it means
            // "I've filled in the CAMS form" and moves on to waiting.
            onSubmitted={() => (form ? goTo('awaiting') : void startRequest())}
            onBack={() => goTo('consent')}
          />
        )}

        {step === 'awaiting' && request && (
          <CasAwaitingStep
            request={request}
            onUpload={() => goTo('upload')}
            onCancelled={() => {
              setRequest(null);
              setForm(null);
              goTo('consent');
            }}
          />
        )}

        {step === 'upload' && (
          <div className="space-y-5 p-6">
            <p className="text-sm leading-relaxed text-text-muted">
              Upload the statement exactly as the registrar emailed it, and enter the password you
              chose when you requested it.
            </p>

            {lastGood && (
              <p className="text-xs text-text-faint">
                You last imported on {fmtDate(lastGood.created_at)}
                {lastGood.scheme_count ? `, covering ${lastGood.scheme_count} schemes` : ''}.
              </p>
            )}

            {error && (
              <div className="flex items-start gap-2.5 rounded-token-md border border-danger-soft/20 bg-danger-soft/10 px-3.5 py-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-soft" />
                <p className="text-sm text-danger-soft">{error}</p>
              </div>
            )}

            <label
              className={`flex cursor-pointer items-center gap-3 rounded-token-md border px-3.5 py-3 transition-colors ${
                file ? 'border-success-soft/30 bg-success-soft/5' : 'border-border bg-bg-base hover:border-accent/40'
              }`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-token-sm ${
                  file ? 'bg-success-soft/10' : 'bg-accent/10'
                }`}
              >
                {file ? (
                  <CheckCircle2 className="h-4 w-4 text-success-soft" />
                ) : (
                  <FileText className="h-4 w-4 text-accent" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-text-primary">
                  {file ? file.name : 'Consolidated Account Statement'}
                </span>
                <span className="block text-xs text-text-muted">
                  {file ? 'Tap to choose a different file' : 'The PDF attached to the email from CAMS'}
                </span>
              </span>
              <Upload className="h-4 w-4 shrink-0 text-text-muted" />
              <input
                type="file"
                className="hidden"
                accept="application/pdf,.pdf"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError('');
                }}
              />
            </label>

            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                Statement password <span className="text-accent">*</span>
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="The password you set on the CAMS form"
                autoComplete="off"
                className="w-full rounded-token-md border border-border bg-bg-base px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
              />
              <p className="mt-1.5 text-xs text-text-faint">
                This is not your PAN — CAMS let you choose it when you made the request.
              </p>
            </div>

            <div className="flex items-start gap-2 rounded-token-md border border-border bg-bg-base p-3">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
              <p className="text-xs leading-relaxed text-text-muted">
                Your statement is read on our own servers and the file itself is never stored. We
                keep the holdings and transactions it contains, nothing else.
              </p>
            </div>

            <div className="flex justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => goTo(form ? 'request' : 'consent')}
                className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted"
              >
                How do I request one?
              </button>
              <button
                onClick={submit}
                disabled={busy || !file || !password}
                className="press flex items-center gap-2 rounded-token-md px-5 py-2.5 text-sm font-bold text-text-on-accent disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {busy ? 'Reading your statement…' : 'Import portfolio'}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && outcome && (
          <Result
            outcome={outcome}
            onClose={onClose}
            onAnother={() => {
              setOutcome(null);
              setFile(null);
              goTo('upload');
            }}
          />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * What happened, in the client's terms.
 *
 * A statement that did not reconcile is deliberately NOT reported as a success
 * with a caveat. We hold the figures back entirely, because a portfolio total
 * that is quietly short is worse than one that is missing — so this says the
 * import needs checking and shows no numbers at all.
 */
function Result({
  outcome,
  onClose,
  onAnother,
}: {
  outcome: CasImportOutcome;
  onClose: () => void;
  onAnother: () => void;
}) {
  const { status, duplicate, counts, totals, variant } = outcome;

  if (duplicate) {
    return (
      <Outcome
        tone="muted"
        icon={CheckCircle2}
        title="You have already imported this statement"
        body="Nothing has changed. Request a newer statement from CAMS when you want to bring your portfolio up to date."
        onClose={onClose}
        onAnother={onAnother}
      />
    );
  }

  if (status !== 'reconciled') {
    return (
      <Outcome
        tone="warning"
        icon={AlertCircle}
        title="We could not verify this statement"
        body="Every statement is checked against the totals printed inside it, and this one did not add up. Rather than show you figures we are not sure of, we have held it back for our team to look at. Your relationship manager can help — nothing has been added to your portfolio."
        onClose={onClose}
        onAnother={onAnother}
      />
    );
  }

  return (
    <div className="space-y-4 p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-success-soft/30 bg-success-soft/10 text-success-soft">
        <ShieldCheck className="h-7 w-7" />
      </div>
      <h4 className="font-display text-lg font-bold text-text-primary">Portfolio imported</h4>

      {totals && (
        <p className="font-display text-3xl font-bold tabular-nums text-text-primary">
          {fmtFull(totals.parsedMarketValue)}
        </p>
      )}
      {counts && (
        <p className="text-sm text-text-muted">
          {counts.schemes} scheme{counts.schemes === 1 ? '' : 's'} across {counts.folios} folio
          {counts.folios === 1 ? '' : 's'}
          {counts.transactions > 0 ? `, and ${counts.transactions} transactions` : ''}.
        </p>
      )}

      <div className="flex items-start gap-2 rounded-token-md border border-success-soft/25 bg-success-soft/5 p-3 text-left">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-soft" />
        <p className="text-xs leading-relaxed text-text-muted">
          Every figure was checked against the totals printed on your own statement, to the paisa.
        </p>
      </div>

      {variant === 'summary' && (
        <div className="flex items-start gap-2 rounded-token-md border border-accent/15 bg-accent/5 p-3 text-left">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p className="text-xs leading-relaxed text-text-muted">
            This was a <b>Summary</b> statement, so it carries what you hold but not how you got
            there. Import a <b>Detailed</b> one when you can — returns and capital gains need the
            transaction history.
          </p>
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-3 pt-1">
        <button
          type="button"
          onClick={onAnother}
          className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted"
        >
          Import another
        </button>
        <button
          onClick={onClose}
          className="press inline-flex items-center justify-center rounded-token-md px-6 py-2.5 text-sm font-bold text-text-on-accent"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function Outcome({
  tone,
  icon: Icon,
  title,
  body,
  onClose,
  onAnother,
}: {
  tone: 'muted' | 'warning';
  icon: typeof AlertCircle;
  title: string;
  body: string;
  onClose: () => void;
  onAnother: () => void;
}) {
  const ring =
    tone === 'warning'
      ? 'border-warning-soft/30 bg-warning-soft/10 text-warning-soft'
      : 'border-border bg-bg-surface text-text-muted';
  return (
    <div className="space-y-4 p-6 text-center">
      <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full border ${ring}`}>
        <Icon className="h-7 w-7" />
      </div>
      <h4 className="font-display text-lg font-bold text-text-primary">{title}</h4>
      <p className="mx-auto max-w-sm text-sm leading-relaxed text-text-muted">{body}</p>
      {tone === 'warning' && (
        <div className="flex justify-center">
          <StatusPill tone="warning">Not added to your portfolio</StatusPill>
        </div>
      )}
      <div className="flex flex-wrap justify-center gap-3 pt-1">
        <button
          type="button"
          onClick={onAnother}
          className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted"
        >
          Try another statement
        </button>
        <button
          onClick={onClose}
          className="press inline-flex items-center justify-center rounded-token-md px-6 py-2.5 text-sm font-bold text-text-on-accent"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
