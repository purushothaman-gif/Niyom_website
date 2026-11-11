import { ArrowRight, PackagePlus } from 'lucide-react';

/**
 * The visible entry to the import hub, used at the top of the dashboard and of
 * My Portfolio.
 *
 * Two sizes of the same offer. Before anything has been imported the client
 * does not know their picture is partial, so it takes real space and says what
 * is missing. Afterwards it shrinks to a single row — still one tap away for a
 * second statement or a demat account, without re-arguing a case already won.
 */
interface Props {
  onOpen: () => void;
  /** True once a statement has been imported: renders the compact row. */
  compact?: boolean;
}

export function ImportHubBanner({ onOpen, compact = false }: Props) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="press group flex w-full items-center gap-3 rounded-token-lg border border-accent/30 bg-accent/5 px-4 py-3 text-left transition-colors hover:border-accent/60"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-token-md bg-accent/10">
          <PackagePlus className="h-4 w-4 text-accent" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text-primary">Import my portfolio</span>
          <span className="block text-xs text-text-muted">
            Add or refresh mutual funds, shares, bonds and NPS held elsewhere.
          </span>
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-accent transition-transform group-hover:translate-x-0.5" />
      </button>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-token-xl border border-accent/30 bg-card p-5 shadow-token-card sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full opacity-[0.09]"
        style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }}
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-token-lg bg-accent/10">
            <PackagePlus className="h-5 w-5 text-accent" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold tracking-tight text-text-primary">
              See everything you own in one place
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-text-secondary">
              This page shows what you hold through Niyom. Bring in mutual funds, shares, bonds
              and NPS held with other apps, banks and brokers — it takes a few minutes.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="press inline-flex shrink-0 items-center justify-center gap-2 rounded-token-md px-5 py-3 text-sm font-bold text-on-accent"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
        >
          Import my portfolio
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
