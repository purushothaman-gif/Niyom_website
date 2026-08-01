import { ArrowRight, Layers, Lock, Percent, ReceiptText, X } from 'lucide-react';
import { useDismissed } from '../../hooks/useDismissed';

/**
 * The case for importing a statement, made where the gap is actually felt.
 *
 * ## Why this argues from absence rather than benefit
 *
 * A client looking at this screen believes they are looking at their portfolio.
 * They are looking at the part of it we sold them. That gap is invisible — the
 * numbers are correct, the page looks complete, and nothing about it suggests
 * anything is missing. So the card names the gap first and the benefits second;
 * "here is something you did not know was wrong" is the only honest reason to
 * interrupt someone who thinks they are already done.
 *
 * ## What it will not do
 *
 * No invented statistics, no manufactured urgency, no counting down. Every
 * claim here is checkable: we really can only see what we sold, XIRR really is
 * blank without the history, and the statement really does carry every buy and
 * sell. A financial product that has to exaggerate to get a click has told the
 * client something about itself.
 *
 * It disappears the moment a statement is imported, and stays dismissed if the
 * client says no — the button on the portfolio screen is always there for when
 * they change their mind.
 */
interface Props {
  onImport: () => void;
  /** Shown when we can be concrete about how little we can see. */
  visibleHoldings?: number;
  /** True when returns cannot be computed yet — the most tangible gap. */
  returnsUnavailable?: boolean;
  dismissible?: boolean;
}

const REASONS = [
  {
    icon: Layers,
    title: 'Everything in one place',
    body: 'Funds you bought through other distributors appear here alongside the ones you bought through us.',
  },
  {
    icon: Percent,
    title: 'Your actual return',
    body: 'Calculated from every transaction since you started investing, rather than estimated from what we can see.',
  },
  {
    icon: ReceiptText,
    title: 'Ready for tax time',
    body: 'The statement carries every purchase and redemption you have ever made — the record capital gains are worked out from.',
  },
];

export function ImportPortfolioCard({
  onImport,
  visibleHoldings,
  returnsUnavailable,
  dismissible = true,
}: Props) {
  const [dismissed, dismiss] = useDismissed(dismissible ? 'import-portfolio-prompt' : null);
  if (dismissed) return null;

  return (
    <section className="relative overflow-hidden rounded-token-lg border border-accent/25 bg-card p-5 sm:p-6">
      {/* A warm wash rather than a coloured alert box — this is an offer, not a problem. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-[0.07]"
        style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }}
      />

      {dismissible && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-3 top-3 text-text-faint transition-colors hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      <div className="relative">
        <h2 className="pr-6 font-display text-lg font-bold tracking-tight text-text-primary">
          You may be holding more than this
        </h2>
        <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-text-secondary">
          {/*
            The specific number is what makes this land. "Some funds may be
            missing" is easy to skip past; "these 6 are the ones we sold you"
            is a fact the client can check against their own memory.
          */}
          {visibleHoldings
            ? `These ${visibleHoldings} holdings are the ones you bought through us. `
            : 'This page shows only what you bought through us. '}
          Your Consolidated Account Statement covers every mutual fund you own, across every fund
          house — and it takes about five minutes to bring in.
        </p>

        <ul className="mt-5 grid gap-4 sm:grid-cols-3">
          {REASONS.map((r) => (
            <li key={r.title} className="flex gap-3 sm:flex-col sm:gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-token-md bg-accent/10">
                <r.icon className="h-4 w-4 text-accent" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">{r.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{r.body}</p>
              </div>
            </li>
          ))}
        </ul>

        {/*
          Only shown when it is true. A client staring at "—" where their return
          should be already knows something is missing; naming it is the most
          concrete reason we have.
        */}
        {returnsUnavailable && (
          <p className="mt-4 rounded-token-md border border-border bg-bg-base px-3.5 py-2.5 text-xs leading-relaxed text-text-muted">
            Your returns are showing as <span className="font-semibold text-text-primary">—</span>{' '}
            because we do not have enough of your transaction history to calculate them. The
            statement supplies it.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={onImport}
            className="press inline-flex items-center gap-2 rounded-token-md px-5 py-2.5 text-sm font-bold text-text-on-accent"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
          >
            Import my portfolio
            <ArrowRight className="h-4 w-4" />
          </button>
          <span className="inline-flex items-center gap-1.5 text-xs text-text-faint">
            <Lock className="h-3.5 w-3.5" />
            We read the statement and never store the file
          </span>
        </div>
      </div>
    </section>
  );
}
