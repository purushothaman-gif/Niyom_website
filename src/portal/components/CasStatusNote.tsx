import { CalendarCheck, Info, X } from 'lucide-react';
import { fmtDate } from '../../crm/utils';
import { useDismissed } from '../hooks/useDismissed';
import { CAS_FRESHNESS_COPY, type CasFreshness } from '../types/cas';

/**
 * How current the imported mutual fund picture is.
 *
 * Three states, and the difference between them matters:
 *
 *   none      no statement imported — render nothing at all
 *   current   just the date, quietly
 *   stale     we have recorded fund activity since the statement was drawn up,
 *             so the holdings shown are knowably behind
 *
 * The stale notice is informative and never blocking: the figures below it are
 * still real, just as at an earlier date, so it explains and offers the fix
 * rather than hiding anything or demanding action. It is dismissible, and
 * dismissal is remembered against THIS statement date — import a newer one and
 * a fresh warning is free to appear.
 *
 * Dismissing does not remove the date. The client still needs to know what the
 * figures are as at; they only asked to stop being told about it.
 */
export function CasStatusNote({
  freshness,
  onImport,
}: {
  freshness: CasFreshness;
  /** Optional: offers the client the import flow straight from the notice. */
  onImport?: () => void;
}) {
  const { state, statementTo } = freshness;
  const [dismissed, dismiss] = useDismissed(statementTo ? `cas-stale:${statementTo}` : null);

  if (state === 'none' || !statementTo) return null;
  const shown = fmtDate(statementTo);

  if (state === 'current') {
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-text-faint">
        <CalendarCheck className="h-3.5 w-3.5" />
        {CAS_FRESHNESS_COPY.current(shown)}
      </p>
    );
  }

  if (dismissed) {
    return (
      <p className="text-xs text-text-faint">{CAS_FRESHNESS_COPY.staleDismissed(shown)}</p>
    );
  }

  return (
    <div className="flex w-full items-start gap-2.5 rounded-token-md border border-warning-soft/25 bg-warning-soft/5 px-3.5 py-3">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning-soft" />
      <div className="min-w-0 flex-1">
        <p className="text-xs leading-relaxed text-text-muted">{CAS_FRESHNESS_COPY.stale}</p>
        <p className="mt-1 text-[11px] text-text-faint">
          {CAS_FRESHNESS_COPY.staleDismissed(shown)}
        </p>
        {onImport && (
          <button
            type="button"
            onClick={onImport}
            className="mt-2 text-xs font-semibold text-accent hover:underline"
          >
            Import a newer statement
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 text-text-faint hover:text-text-primary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
