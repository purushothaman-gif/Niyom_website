import { useMemo } from 'react';
import { Upload, Wallet } from 'lucide-react';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { CasStatusNote } from '../../components/CasStatusNote';
import type { PortfolioData } from '../../types';
import type { CasFreshness, PortalHolding } from '../../types/cas';
import type { PortalView } from '../../layout/navigation';
import { ImportPortfolioCard } from './ImportPortfolioCard';
import { mfSsoEnabled } from '../../../../shared/platform/env';
import { fromClientHoldings } from '../../../../shared/portal/investments/model';
import { InvestmentsBoard } from '../investments/InvestmentsBoard';
import { useInvestmentRows } from '../investments/useInvestmentRows';

export function PortfolioPage({
  holdings,
  xirrPercent = null,
  onNavigate,
  onImport,
  freshness,
  hasImportedStatement = false,
  valuedOn,
}: {
  /** Kept for prop compatibility; the board now renders from `holdings`. */
  data: PortfolioData;
  holdings: PortalHolding[];
  xirrPercent?: number | null;
  onNavigate?: (view: PortalView) => void;
  /** Opens the import wizard, which PortalApp owns so both screens share one. */
  onImport: () => void;
  /** How current the imported mutual fund picture is; absent until one exists. */
  freshness?: CasFreshness;
  hasImportedStatement?: boolean;
  /** NAV date the mutual fund figures are priced at, when newer than the statement. */
  valuedOn?: string | null;
}) {
  const baseRows = useMemo(() => fromClientHoldings(holdings), [holdings]);
  const { rows, enriching } = useInvestmentRows('client', baseRows);
  // See DashboardPage: no XIRR while registrar funds lack purchase flows.
  const xirr = rows.some((r) => r.source === 'registrar') ? null : xirrPercent;

  /**
   * An investor with nothing here has almost always invested elsewhere — an
   * empty portfolio is far more often "we cannot see it yet" than "there is
   * nothing". So the empty state offers the import rather than waiting for them
   * to start from scratch with us.
   */
  // Statement imports retire once mutual funds run on the MF platform.
  const mfOnPlatform = mfSsoEnabled();
  if (holdings.length === 0) {
    return (
      <div className="space-y-5">
        {/* The pitch does the work here; a bare "no holdings" card would not. */}
        {!mfOnPlatform && <ImportPortfolioCard onImport={onImport} dismissible={false} />}
        <Card>
          <EmptyState
            icon={Wallet}
            title="Nothing here yet."
            hint="Holdings you buy through us will appear here as they settle."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/*
        Imported funds are valued as at the statement date, not today, and a
        client who has transacted since then is looking at figures we already
        know are behind. Saying so is the difference between a number they can
        rely on and one they will query when it does not match their fund house.
      */}
      {/*
        Before a statement exists the client does not know anything is missing,
        so the case for it gets real space. Once imported, the same action
        becomes a quiet "bring it up to date" button.
      */}
      {!hasImportedStatement && !mfOnPlatform && (
        <ImportPortfolioCard
          onImport={onImport}
          visibleHoldings={holdings.length}
          returnsUnavailable={false}
        />
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {freshness && (
            <CasStatusNote freshness={freshness} onImport={onImport} valuedOn={valuedOn} />
          )}
        </div>
        {hasImportedStatement && <ImportButton onClick={onImport} />}
      </div>

      <InvestmentsBoard
        rows={rows}
        enriching={enriching}
        title="Holdings"
        xirrPercent={xirr}
        actions={
          onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('allocation')}
              className="hidden rounded-token-md border border-border bg-bg-surface px-3.5 py-2 text-xs font-semibold text-text-primary hover:border-accent/40 sm:inline-flex"
            >
              Analyse
            </button>
          )
        }
      />
    </div>
  );
}

/** The quiet variant, shown only once a statement has already been imported. */
/**
 * The way back into the import flow once a statement already exists.
 *
 * Wording and prominence both matter here, and both were wrong. It read
 * "Update from a newer statement", which describes only half of what the flow
 * does — a second statement ADDS to the portfolio rather than replacing it,
 * which is exactly what a client with folios under two email addresses needs.
 * Someone looking for "add another statement" would not recognise this button
 * as the thing they wanted, and reasonably concluded there was no such option.
 *
 * It also carried a Download icon for an action that uploads.
 */
function ImportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-token-md border border-accent/30 bg-accent/5 px-3.5 py-2 text-xs font-semibold text-accent transition-colors hover:border-accent/50 hover:bg-accent/10"
    >
      <Upload className="h-3.5 w-3.5" />
      Add or update a statement
    </button>
  );
}
