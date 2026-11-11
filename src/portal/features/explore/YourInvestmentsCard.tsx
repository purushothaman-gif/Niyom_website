import { ChevronRight, Sprout } from 'lucide-react';
import { inr } from '../../../lib/money';
import type { InvestmentSummary } from '../../../../shared/portal/investments/model';
import { signedInr, signedPct, toneOf } from '../investments/format';

/**
 * The right-hand "Your investments" panel from the Groww Explore screens:
 * current value up top, then 1D returns, total returns, invested and XIRR.
 * Unknown figures (registrar funds have no cost basis) read "—", never 0.
 */
export function YourInvestmentsCard({
  summary,
  xirr,
  xirrCoveragePct = null,
  xirrNote = null,
  title = 'Your investments',
  onOpen,
}: {
  summary: InvestmentSummary | null;
  xirr?: number | null;
  /** Share of the portfolio's value the XIRR covers; a note shows below 100%. */
  xirrCoveragePct?: number | null;
  /** 'under_1y': oldest investment is under a year old, so XIRR is not annualised yet. */
  xirrNote?: 'under_1y' | null;
  title?: string;
  onOpen?: () => void;
}) {
  const empty = !summary || summary.count === 0;
  const known = summary?.returnsPct != null;
  return (
    <section>
      <h2 className="mb-4 font-display text-xl font-bold tracking-tight text-text-primary">{title}</h2>
      <div className="rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card">
        {empty ? (
          <div className="py-6 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
              <Sprout className="h-8 w-8 text-accent" />
            </span>
            <p className="mt-4 font-display text-base font-bold text-text-primary">You haven&rsquo;t invested yet</p>
            <p className="mt-1 text-xs text-text-secondary">Pick a bond or a mutual fund to get started.</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-text-secondary">Current</p>
            <p className="mt-1 font-display text-3xl font-bold tabular-nums text-text-primary">{inr(summary!.current)}</p>
            <div className="mt-4 divide-y divide-border-subtle border-t border-dashed border-border">
              <Row label="1D returns">
                {summary!.dayChange == null ? (
                  '—'
                ) : (
                  <span className={toneOf(summary!.dayChange)}>
                    {signedInr(summary!.dayChange)} ({signedPct(summary!.dayChangePct)})
                  </span>
                )}
              </Row>
              <Row label="Total returns">
                {known ? (
                  <span className={toneOf(summary!.returns)}>
                    {signedInr(summary!.returns)} ({signedPct(summary!.returnsPct)})
                  </span>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Invested">{known ? inr(summary!.invested) : '—'}</Row>
              {xirr !== undefined && (
                <Row label="XIRR">{xirr == null ? '—' : <span className={toneOf(xirr)}>{signedPct(xirr)}</span>}</Row>
              )}
              {xirr == null && xirrNote === 'under_1y' && (
                <p className="py-2 text-[11px] leading-relaxed text-text-faint">
                  XIRR appears once your oldest investment is a year old. Until then returns aren&rsquo;t
                  annualised &mdash; see Total returns.
                </p>
              )}
              {xirr != null && xirrCoveragePct != null && xirrCoveragePct < 99.5 && (
                <p className="py-2 text-[11px] leading-relaxed text-text-faint">
                  XIRR covers {Math.round(xirrCoveragePct)}% of your portfolio. Funds whose full purchase history
                  isn&rsquo;t on file yet are left out rather than estimated.
                </p>
              )}
            </div>
            {onOpen && (
              <button
                type="button"
                onClick={onOpen}
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-soft"
              >
                View portfolio <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-sm font-semibold tabular-nums text-text-primary">{children}</span>
    </div>
  );
}
