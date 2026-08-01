import { useState } from 'react';
import { AlertCircle, ArrowRight, Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import type { CasFormGuidance } from '../../services/CasRequestService';

/**
 * The registrar's form, with our half already filled in.
 *
 * We cannot submit this for the client — no distributor may request a CAS on an
 * investor's behalf — so the next best thing is that they never have to look
 * anything up. Their PAN, date of birth and registered email all come from
 * their own record; the four choices that decide whether the statement is
 * usable are stated as the exact values to select, not as advice.
 *
 * The values come from the server rather than being assembled here, so a client
 * on a stale bundle cannot be shown instructions we have since corrected.
 */
export function CasRequestStep({
  form,
  email,
  onEmailChange,
  onSubmitted,
  onBack,
  busy,
  error,
}: {
  form: CasFormGuidance | null;
  email: string;
  onEmailChange: (v: string) => void;
  onSubmitted: () => void;
  onBack: () => void;
  busy: boolean;
  error: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      /* clipboard blocked — the value is on screen to type anyway */
    }
  };

  /* Before the request exists we collect the email; after, we show the form. */
  if (!form) {
    return (
      <div className="space-y-5 p-6">
        <p className="text-sm leading-relaxed text-text-muted">
          Which email address are your mutual funds registered against?
        </p>
        <div className="flex items-start gap-2 rounded-token-md border border-accent/15 bg-accent/5 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <p className="text-xs leading-relaxed text-text-muted">
            Statements are consolidated by <b>email address, not PAN</b>. Folios registered under a
            different address will be missing, and the file gives no sign that it is incomplete.
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
            Continue
          </button>
        </div>
      </div>
    );
  }

  /*
   * The form's own fields, in the form's own order, with the form's own labels.
   * Nothing else — CAMS does not ask for a date of birth, and showing one would
   * send a client hunting for a field that is not there and doubting the rest.
   *
   * Three of these are choices the page defaults to the WRONG answer for
   * (Detailed over Summary, Specific Period over Current Financial Year, and
   * zero-balance folios), so each carries its reason: none can be undone
   * afterwards, and a client who understands why gets it right more often than
   * one told to trust us.
   */
  const rows: {
    key: string;
    label: string;
    value: string;
    why?: string;
    optional?: boolean;
  }[] = [
    {
      key: 'type',
      label: 'Statement type',
      value: form.statementType,
      why: 'A summary lists only what you hold today. Returns and capital gains are worked out from the transactions, which only the detailed statement carries.',
    },
    {
      key: 'period',
      label: 'Period',
      value: form.period,
      why: 'The page defaults to the current financial year. Returns are computed across your whole history, and a shorter period quietly changes the answer.',
    },
    { key: 'from', label: 'From date', value: form.fromDate },
    { key: 'to', label: 'To date', value: form.toDate },
    {
      key: 'folios',
      label: 'Folio listing',
      value: form.folioListing,
      why: 'The page defaults to "Without zero balance folios", which leaves out funds you have since sold — and those are exactly the ones your realised capital gains come from.',
    },
    { key: 'email', label: 'Email', value: form.email },
    ...(form.pan ? [{ key: 'pan', label: 'PAN', value: form.pan, optional: true }] : []),
  ];

  return (
    <div className="space-y-5 p-6">
      <p className="text-sm leading-relaxed text-text-muted">
        Open the registrar's page and enter these. We have filled in everything we already hold —
        you only need to choose a password you will remember.
      </p>

      <a
        href={form.url}
        target="_blank"
        rel="noopener noreferrer"
        className="press flex w-full items-center justify-center gap-2 rounded-token-md px-5 py-2.5 text-sm font-bold text-text-on-accent"
        style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
      >
        Open the CAMS statement form
        <ExternalLink className="h-4 w-4" />
      </a>

      <div className="divide-y divide-border-subtle rounded-token-md border border-border bg-bg-base">
        {rows.map((r) => (
          <div key={r.key} className="px-3.5 py-2.5">
            <div className="flex items-center gap-3">
              <span className="w-28 shrink-0 text-[11px] uppercase tracking-wider text-text-faint">
                {r.label}
                {r.optional && <span className="ml-1 normal-case">(optional)</span>}
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-text-primary">
                {r.value}
              </span>
              <button
                type="button"
                onClick={() => copy(r.key, r.value)}
                className="shrink-0 text-text-faint hover:text-accent"
                aria-label={`Copy ${r.label}`}
              >
                {copied === r.key ? (
                  <Check className="h-3.5 w-3.5 text-success-soft" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            {r.why && (
              <p className="mt-1 pl-[7.75rem] text-[11px] leading-relaxed text-text-faint">{r.why}</p>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 rounded-token-md border border-accent/15 bg-accent/5 p-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <p className="text-xs leading-relaxed text-text-muted">
          CAMS asks you to set a password for the file — <b>it is not your PAN</b>. Remember it;
          you will type it here to open the statement.
        </p>
      </div>

      <div className="flex flex-wrap justify-end gap-3 pt-1">
        <button
          onClick={onSubmitted}
          className="press flex items-center gap-2 rounded-token-md px-5 py-2.5 text-sm font-bold text-text-on-accent"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
        >
          I&apos;ve submitted the form
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
