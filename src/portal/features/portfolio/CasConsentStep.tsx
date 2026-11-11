import { ArrowRight } from 'lucide-react';
import { CAS_AUTO_SUMMARY_COPY, requiredConsents, type ConsentType } from '../../types/consent';

/**
 * What the client is agreeing to, in one plain card.
 *
 * We always place the statement request for the client through our service
 * provider, so there is one thing to agree to, not a checklist. The granular
 * consents are still recorded server-side (policy v2); this is their wording.
 * Shown before anything happens and withdrawable later from the profile.
 */
export function CasConsentStep({
  onContinue,
  onClose,
}: {
  onContinue: (granted: ConsentType[]) => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-5 p-6">
      <p className="text-sm leading-relaxed text-text-muted">
        Here’s what we’ll do. Continue to go ahead — you can withdraw this later from your profile.
      </p>

      <div className="rounded-token-md border border-accent/20 bg-accent/5 p-4">
        <p className="text-sm font-semibold text-text-primary">{CAS_AUTO_SUMMARY_COPY.label}</p>
        <p className="mt-1.5 text-xs leading-relaxed text-text-muted">
          {CAS_AUTO_SUMMARY_COPY.detail}
        </p>
      </div>

      <div className="flex flex-wrap justify-end gap-3 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="rounded-token-md border border-border bg-bg-raised px-4 py-2 text-sm text-text-muted"
        >
          Not now
        </button>
        <button
          onClick={() => onContinue(requiredConsents())}
          className="press flex items-center gap-2 rounded-token-md px-5 py-2.5 text-sm font-bold text-text-on-accent"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
        >
          Continue
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
