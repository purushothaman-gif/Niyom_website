/**
 * Shown for modules BSE cannot supply on our member tier.
 *
 * Better than "coming soon", which implies we simply haven't built it: these
 * are blocked on an entitlement from BSE, and saying so tells whoever opens the
 * screen exactly what to ask for.
 */
import { Lock } from 'lucide-react';
import { Card } from '../../../portal/components/Card';

export function NoBseDataPage({
  title,
  needs,
}: {
  title: string;
  /** The BSE APIs that would supply this, e.g. "get_mis_detail". */
  needs: string[];
}) {
  return (
    <div className="mx-auto max-w-lg py-12">
      <Card padding="lg" className="text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-token-xl bg-warning/10">
          <Lock className="h-6 w-6 text-warning" />
        </span>
        <h2 className="font-display text-xl font-bold text-text-primary">{title}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-text-secondary">
          BSE does not expose this data to our member code. Every relevant API returns{' '}
          <code className="rounded bg-bg-base px-1 py-0.5 text-[11px]">authz</code> — an entitlement
          BSE has to grant, not something we can build around.
        </p>
        <div className="mt-4 rounded-token-md bg-bg-base px-3 py-2 text-left">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Blocked on
          </p>
          <ul className="mt-1 space-y-0.5">
            {needs.map((n) => (
              <li key={n} className="font-mono text-[11px] text-text-secondary">
                {n}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-4 text-[11px] text-text-faint">
          Ask BSE to enable these for member 66899, and this screen can be built on real figures.
          Until then it stays empty rather than showing estimates dressed as settled amounts.
        </p>
      </Card>
    </div>
  );
}
