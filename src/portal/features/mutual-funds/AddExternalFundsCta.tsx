import { ChevronRight, Layers, Sparkles } from 'lucide-react';

/**
 * "Add external funds" — the entry point into the Smart CAS import flow. A bold,
 * filled accent card (not a quiet outline) so it reads clearly as the action to
 * take: one tap opens the Consolidated Account Statement importer, which pulls in
 * whatever the client holds through other apps, banks and distributors, with real
 * cost and returns. Placed below the holdings list and on the dashboard.
 *
 * Rendered only when an `onAdd` handler is wired (the portal owns the modal), so
 * it silently no-ops on any surface that has not opted in.
 */
export function AddExternalFundsCta({ onAdd }: { onAdd?: () => void }) {
  if (!onAdd) return null;
  return (
    <button
      type="button"
      onClick={onAdd}
      className="press group flex w-full items-center gap-3.5 rounded-token-xl px-4 py-4 text-left text-text-on-accent shadow-token-md transition-transform hover:-translate-y-0.5"
      style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-token-lg bg-white/15">
        <Layers className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[15px] font-bold">Add external funds</span>
          <span className="inline-flex items-center gap-0.5 rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider">
            <Sparkles className="h-2.5 w-2.5" /> Smart CAS
          </span>
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed opacity-90">
          Manage all your mutual funds in one place — bring in holdings from other apps, banks
          &amp; distributors in minutes.
        </span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
