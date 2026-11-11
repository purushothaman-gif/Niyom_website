import { AlertCircle, Loader2 } from 'lucide-react';

/**
 * The one thing we need before placing the request: which email the client's
 * funds are registered under.
 *
 * A CAS is consolidated by EMAIL, not PAN, so folios under a different address
 * are silently absent — the one choice that decides whether the statement is
 * complete. Everything else (detailed, full period, the registrar) we send for
 * them, and we place the request ourselves, so there is nothing to fill in on
 * any registrar's website.
 */
export function CasRequestStep({
  email,
  onEmailChange,
  onSubmitted,
  onBack,
  busy,
  error,
}: {
  email: string;
  onEmailChange: (v: string) => void;
  onSubmitted: () => void;
  onBack: () => void;
  busy: boolean;
  error: string;
}) {
  return (
    <div className="space-y-5 p-6">
      <p className="text-sm leading-relaxed text-text-muted">
        Confirm the email your mutual funds are registered under, and we’ll request your statement.
      </p>

      <div className="flex items-start gap-2 rounded-token-md border border-accent/15 bg-accent/5 p-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p className="text-xs leading-relaxed text-text-muted">
          Use the email your funds are <b>registered under</b>. Funds under a different email won’t
          appear — you can request a second statement for those afterwards.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-token-md border border-danger-soft/20 bg-danger-soft/10 px-3.5 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-soft" />
          <p className="text-sm text-danger-soft">{error}</p>
        </div>
      )}

      <div>
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
          Registered email <span className="text-accent">*</span>
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-token-md border border-border bg-bg-base px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-accent"
        />
      </div>

      <div className="flex justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={onBack}
          className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted"
        >
          Back
        </button>
        <button
          onClick={onSubmitted}
          disabled={busy || !email.trim()}
          className="press flex items-center gap-2 rounded-token-md px-5 py-2.5 text-sm font-bold text-text-on-accent disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? 'Sending request…' : 'Send CAS request'}
        </button>
      </div>
    </div>
  );
}
