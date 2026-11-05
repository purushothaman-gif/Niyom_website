import { ChevronRight, Layers, Sparkles } from 'lucide-react';

/**
 * "Add external funds" — the entry point into the Smart CAS import flow, placed
 * directly below the holdings list so a client looking at a partial picture is
 * nudged to complete it. One tap opens the existing Consolidated Account
 * Statement importer (see ImportPortfolioModal), which pulls in whatever they
 * hold through other apps, banks and distributors, with real cost and returns.
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
      className="group flex w-full items-center gap-3 rounded-token-xl border border-accent/25 bg-gradient-to-br from-accent/[0.07] to-accent/[0.015] px-4 py-4 text-left transition-colors hover:border-accent/50"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-token-lg bg-accent/10">
        <Layers className="h-5 w-5 text-accent" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-bold text-text-primary">Add external funds</span>
          <span className="inline-flex items-center gap-0.5 rounded-full bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent">
            <Sparkles className="h-2.5 w-2.5" /> Smart CAS
          </span>
        </span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-text-secondary">
          Manage all your mutual funds in one place — bring in holdings from other apps, banks
          &amp; distributors in minutes.
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-secondary transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
