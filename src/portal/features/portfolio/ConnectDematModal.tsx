import { useState } from 'react';
import { AlertCircle, CheckCircle2, Landmark, Loader2, Lock, ShieldCheck, Smartphone, X } from 'lucide-react';
import { fmtFull } from '../../../crm/utils';
import { DematImportService, type DematImportSummary } from '../../services/DematImportService';

/**
 * Bring in a client's demat holdings — shares, bonds, G-secs, NPS — from their
 * CDSL account by OTP.
 *
 * ## Why this is so short
 *
 * Everything the depository needs (PAN, demat account, date of birth) is
 * already on the client's record, so there is nothing to type but the OTP. The
 * statement is fetched, read and stored on our own servers; the client only
 * proves it is them.
 *
 * Two screens: ask the depository to text the OTP, then enter it. A third shows
 * what came in.
 */
type Step = 'intro' | 'otp' | 'needsEmail' | 'done';

export function ConnectDematModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<Step>('intro');
  const [sessionId, setSessionId] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<DematImportSummary | null>(null);

  const sendOtp = async () => {
    setError('');
    setBusy(true);
    const r = await DematImportService.start();
    setBusy(false);
    if (!r.ok) {
      // NSDL-first client: no OTP rail exists — send them to email import.
      if (r.needsEmail) return setStep('needsEmail');
      return setError(r.error);
    }
    setSessionId(r.sessionId);
    setStep('otp');
  };

  const verify = async () => {
    if (otp.trim().length < 4) return setError('Enter the OTP from your phone.');
    setError('');
    setBusy(true);
    const r = await DematImportService.verify(sessionId, otp.trim());
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSummary(r.summary);
    setStep('done');
    onImported();
  };

  return (
    <div className="m-sheet fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4">
      <div className="m-sheet-panel max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-token-xl border border-border bg-modal shadow-token-lg">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-modal px-6 py-4">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-bold text-text-primary">Connect your demat account</h3>
          </div>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-5 flex items-start gap-2.5 rounded-token-md border border-danger-soft/20 bg-danger-soft/10 px-3.5 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-soft" />
            <p className="text-sm text-danger-soft">{error}</p>
          </div>
        )}

        {step === 'intro' && (
          <div className="space-y-5 p-6">
            <p className="text-sm leading-relaxed text-text-muted">
              We’ll bring in everything you hold in demat — shares, bonds, government securities and
              NPS — straight from CDSL by OTP. Hold with NSDL instead? We’ll point you to forward
              your statement, which we import just the same.
            </p>
            <div className="flex items-start gap-2 rounded-token-md border border-accent/15 bg-accent/5 p-3">
              <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <p className="text-xs leading-relaxed text-text-muted">
                CDSL will text a one-time password to the mobile registered with your demat account.
                That’s all you’ll need to enter — your PAN and account details are already on file.
              </p>
            </div>
            <div className="flex items-start gap-2 rounded-token-md border border-border bg-bg-base p-3">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
              <p className="text-xs leading-relaxed text-text-muted">
                Your statement is read on our own servers and the file itself is never stored. We
                keep the holdings it contains, nothing else.
              </p>
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <button
                onClick={sendOtp}
                disabled={busy}
                className="press flex items-center gap-2 rounded-token-md px-5 py-2.5 text-sm font-bold text-text-on-accent disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                {busy ? 'Requesting OTP…' : 'Send me the OTP'}
              </button>
            </div>
          </div>
        )}

        {step === 'otp' && (
          <div className="space-y-5 p-6">
            <p className="text-sm leading-relaxed text-text-muted">
              Enter the OTP CDSL just sent to your registered mobile. It’s valid for a few minutes.
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
                One-time password <span className="text-accent">*</span>
              </label>
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="● ● ● ● ● ●"
                className="w-full rounded-token-md border border-border bg-bg-base px-3.5 py-2.5 text-center text-lg tracking-[0.4em] text-text-primary outline-none focus:border-accent"
              />
            </div>
            <div className="flex justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  setOtp('');
                  setError('');
                  setStep('intro');
                }}
                className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted"
              >
                Resend
              </button>
              <button
                onClick={verify}
                disabled={busy || otp.trim().length < 4}
                className="press flex items-center gap-2 rounded-token-md px-5 py-2.5 text-sm font-bold text-text-on-accent disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {busy ? 'Reading your statement…' : 'Import holdings'}
              </button>
            </div>
          </div>
        )}

        {step === 'needsEmail' && (
          <div className="space-y-5 p-6">
            <div className="flex items-start gap-2 rounded-token-md border border-accent/15 bg-accent/5 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <p className="text-xs leading-relaxed text-text-muted">
                Your demat account is held with <b>NSDL</b>, which can&apos;t be fetched with an OTP.
                You can still bring these holdings in — by email.
              </p>
            </div>
            <p className="text-sm leading-relaxed text-text-muted">
              Close this and use <b>&ldquo;Forward your statements in&rdquo;</b> (or
              &ldquo;Import statements from your email&rdquo;) on your portfolio screen. Forward your
              NSDL statement there and we&apos;ll import it automatically.
            </p>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="press inline-flex items-center justify-center rounded-token-md px-6 py-2.5 text-sm font-bold text-text-on-accent"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                Got it
              </button>
            </div>
          </div>
        )}

        {step === 'done' && summary && (
          <div className="space-y-4 p-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-success-soft/30 bg-success-soft/10 text-success-soft">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h4 className="font-display text-lg font-bold text-text-primary">
              {summary.duplicate ? 'Already up to date' : 'Demat holdings added'}
            </h4>
            {summary.totalValue != null && (
              <p className="font-display text-3xl font-bold tabular-nums text-text-primary">
                {fmtFull(summary.totalValue)}
              </p>
            )}
            {!summary.duplicate && (
              <p className="text-sm text-text-muted">
                {summary.holdings} holding{summary.holdings === 1 ? '' : 's'} across{' '}
                {summary.accounts} account{summary.accounts === 1 ? '' : 's'}
                {summary.statementDate ? `, as on ${summary.statementDate}` : ''}.
              </p>
            )}
            <div className="flex justify-center pt-1">
              <button
                onClick={onClose}
                className="press inline-flex items-center justify-center rounded-token-md px-6 py-2.5 text-sm font-bold text-text-on-accent"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
