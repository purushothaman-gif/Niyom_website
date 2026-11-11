import { useMemo, useState } from 'react';
import { Download, Loader2, Upload, Wallet } from 'lucide-react';
import type { NWClient } from '../../../crm/types';
import { useMfScope } from '../statement/useMfScope';
import { useRtaMf } from '../../hooks/useRtaMf';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { CasStatusNote } from '../../components/CasStatusNote';
import type { PortfolioData } from '../../types';
import type { CasFreshness, PortalHolding } from '../../types/cas';
import type { PortalView } from '../../layout/navigation';
import { ImportHubBanner } from './ImportHubBanner';
import { fromClientHoldings } from '../../../../shared/portal/investments/model';
import { InvestmentsBoard } from '../investments/InvestmentsBoard';
import { useInvestmentRows } from '../investments/useInvestmentRows';

export function PortfolioPage({
  clientId,
  client,
  holdings,
  xirrPercent = null,
  xirrCoveragePct = null,
  xirrNote = null,
  onNavigate,
  onImport,
  onOpenImportHub,
  freshness,
  hasImportedStatement = false,
  valuedOn,
}: {
  clientId: string;
  /** For the statement header. */
  client: NWClient | null;
  /** Kept for prop compatibility; the board now renders from `holdings`. */
  data: PortfolioData;
  holdings: PortalHolding[];
  xirrPercent?: number | null;
  xirrCoveragePct?: number | null;
  xirrNote?: 'under_1y' | null;
  onNavigate?: (view: PortalView) => void;
  /** Opens the import wizard, which PortalApp owns so both screens share one. */
  onImport: () => void;
  /** Opens the import hub — every route for bringing outside holdings in. */
  onOpenImportHub: () => void;
  /** How current the imported mutual fund picture is; absent until one exists. */
  freshness?: CasFreshness;
  hasImportedStatement?: boolean;
  /** NAV date the mutual fund figures are priced at, when newer than the statement. */
  valuedOn?: string | null;
}) {
  const mf = useMfScope(holdings);
  const rta = useRtaMf(clientId);
  const baseRows = useMemo(() => fromClientHoldings(mf.holdings), [mf.holdings]);
  const { rows, enriching } = useInvestmentRows('client', baseRows);
  // See DashboardPage: no XIRR while registrar funds lack purchase flows, nor
  // in all-distributor mode (statement funds' flows aren't in our ledger).
  const xirr = xirrPercent;
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    if (!client) return;
    setDownloading(true);
    try {
      const { generatePortfolioStatement } = await import('../statement/portfolioStatementPdf');
      await generatePortfolioStatement({
        client: {
          full_name: client.full_name,
          client_code: client.client_code,
          pan: client.pan,
          email: client.email,
          phone: client.phone,
          city: client.city,
          state: client.state,
        },
        rows,
        sips: rta.data?.sips ?? [],
        mfScope: mf.scope,
        casStatementTo: mf.casStatementTo,
        valuedOn: valuedOn ?? rta.data?.snapshotDate ?? null,
      });
    } finally {
      setDownloading(false);
    }
  };

  /**
   * An investor with nothing here has almost always invested elsewhere — an
   * empty portfolio is far more often "we cannot see it yet" than "there is
   * nothing". So the empty state offers the import rather than waiting for them
   * to start from scratch with us.
   */
  if (holdings.length === 0) {
    return (
      <div className="space-y-5">
        {/* The pitch does the work here; a bare "no holdings" card would not. */}
        <ImportHubBanner onOpen={onOpenImportHub} />
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
        One entry for every way of bringing outside holdings in. Before anything
        is imported the client does not know the picture is partial, so it gets
        real space; afterwards it is a single quiet row.
      */}
      <ImportHubBanner onOpen={onOpenImportHub} compact={hasImportedStatement} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {freshness && (
            <CasStatusNote freshness={freshness} onImport={onImport} valuedOn={valuedOn} />
          )}
        </div>
        {hasImportedStatement && <ImportButton onClick={onImport} />}
      </div>

      {/* Mutual fund scope + statement download */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-token-xl border border-border bg-bg-elevated px-4 py-3 shadow-token-card">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-text-secondary">Mutual funds:</span>
          <div className="inline-flex rounded-full border border-border bg-bg-surface p-0.5">
            {(
              [
                { key: 'all', label: 'All distributors' },
                { key: 'niyom', label: 'Through Niyom' },
              ] as const
            ).map((o) => {
              const on = mf.scope === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => mf.setScope(o.key)}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    on ? 'bg-accent text-on-accent' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          <span className="text-[11px] text-text-faint">
            {mf.heldAwayCount === 0
              ? 'All your funds are held through Niyom. Upload your CAS to add funds held with other distributors.'
              : mf.scope === 'all'
                ? `Includes ${mf.heldAwayCount} fund${mf.heldAwayCount > 1 ? 's' : ''} held with other distributors, from your CAS${
                    mf.casStatementTo
                      ? ` (units as of ${new Date(mf.casStatementTo).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })})`
                      : ''
                  }`
                : `Only funds held through Niyom · ${mf.heldAwayCount} fund${mf.heldAwayCount > 1 ? 's' : ''} with other distributors hidden`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void download()}
          disabled={downloading || !client}
          className="inline-flex items-center gap-2 rounded-token-md bg-accent px-4 py-2 text-xs font-bold text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-60"
        >
          {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {downloading ? 'Preparing…' : 'Download statement (PDF)'}
        </button>
      </div>

      <InvestmentsBoard
        rows={rows}
        enriching={enriching}
        title="Holdings"
        xirrPercent={xirr}
        xirrCoveragePct={xirrCoveragePct}
        xirrNote={xirrNote}
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
