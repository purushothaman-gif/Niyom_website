import { useState } from 'react';
import { ArrowRight, Check, Lock } from 'lucide-react';
import {
  CONSENT_COPY,
  IMPORT_CONSENTS,
  hasRequiredConsents,
  type ConsentType,
} from '../../types/consent';

/**
 * What the client is authorising, asked once and asked plainly.
 *
 * The required items are shown ticked and locked rather than hidden. Hiding
 * them would be quicker, but a client who has never been told that we read
 * their whole statement — including funds bought elsewhere — has not really
 * agreed to it. The optional one is genuinely optional and starts unticked.
 *
 * All wording comes from `types/consent.ts` against a pinned policy version, so
 * what a past consent recorded stays recoverable.
 */
export function CasConsentStep({
  onContinue,
  onClose,
}: {
  onContinue: (granted: ConsentType[]) => void;
  onClose: () => void;
}) {
  const [granted, setGranted] = useState<ConsentType[]>(
    IMPORT_CONSENTS.filter((c) => CONSENT_COPY[c].required),
  );

  const toggle = (c: ConsentType) => {
    if (CONSENT_COPY[c].required) return; // locked on purpose
    setGranted((g) => (g.includes(c) ? g.filter((x) => x !== c) : [...g, c]));
  };

  return (
    <div className="space-y-5 p-6">
      <p className="text-sm leading-relaxed text-text-muted">
        Before we start, here is exactly what you are agreeing to. You can withdraw any of it
        later from your profile.
      </p>

      <ul className="space-y-2.5">
        {IMPORT_CONSENTS.map((c) => {
          const { label, detail, required } = CONSENT_COPY[c];
          const on = granted.includes(c);
          return (
            <li key={c}>
              <button
                type="button"
                onClick={() => toggle(c)}
                disabled={required}
                className={`flex w-full items-start gap-3 rounded-token-md border p-3.5 text-left transition-colors ${
                  on ? 'border-accent/35 bg-selected' : 'border-border bg-bg-base hover:border-accent/30'
                } ${required ? 'cursor-default' : ''}`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${
                    on ? 'border-accent bg-accent text-on-accent' : 'border-border-strong'
                  }`}
                >
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">{label}</span>
                    {required && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-text-faint">
                        <Lock className="h-2.5 w-2.5" />
                        Required
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">
                    {detail}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted"
        >
          Not now
        </button>
        <button
          onClick={() => onContinue(granted)}
          disabled={!hasRequiredConsents(granted)}
          className="press flex items-center gap-2 rounded-token-md px-5 py-2.5 text-sm font-bold text-text-on-accent disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
        >
          Continue
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
