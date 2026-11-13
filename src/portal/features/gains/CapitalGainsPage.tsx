/**
 * The client's capital gains statement.
 *
 * ## What this screen promises, and what it does not
 *
 * It promises the GAIN: units bought at one price, sold at another, matched
 * FIFO the way the law requires. That number is arithmetic and it is checkable —
 * the working is on screen, one row per matched lot.
 *
 * It does NOT promise the tax. Rates are stated where the law states one, but a
 * short-term gain on a debt fund is taxed at the client's own slab, which we do
 * not know, and a handful of funds have compositions nobody has decided on yet.
 * Those are shown as gains without a tax figure rather than as a confident
 * number somebody might file. The footer says so plainly.
 *
 * ## Why funds can be missing, and why that is stated loudly
 *
 * A CAS requested for one financial year opens with units the client already
 * held, bought with money the file never mentions. The cost basis of those units
 * is unknowable, so the fund is excluded — and an excluded fund is called out by
 * name. A gains statement that silently drops a holding looks complete and
 * understates the year, which is the worst failure this screen has.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Loader2,
  Lock,
  Receipt,
  ShieldCheck,
  TrendingUp,
  Upload,
} from 'lucide-react';
import { fmt, fmtDate } from '../../../crm/utils';
import type { NWClient } from '../../../crm/types';
import { Card } from '../../components/Card';
import { KpiStat } from '../../components/KpiStat';
import { EmptyState } from '../../components/EmptyState';
import { Segmented } from '../../components/Segmented';
import { SectionHeader } from '../../components/SectionHeader';
import { StatusPill } from '../../components/StatusPill';
import { CasGainsService, type GainsStatement } from '../../services/CasGainsService';
import { exportCapitalGainsXlsx, exportElssLockInXlsx } from '../../services/exporters';
import { downloadCapitalGainsPdf, downloadElssLockInPdf } from '../reports/reportDocs';
import { displaySchemeName, termLabel, treatmentLabel } from '../../services/cas/gains';
import {
  computeElssLockIn,
  mergeElssSources,
  type ElssLockIn,
  type ElssLockInSource,
} from '../../services/cas/elssLockIn';
import { fetchRegistrarElssSources } from '../../services/cas/registrarElss';

interface Props {
  clientId: string;
  client: NWClient | null;
  /** Lets the empty state send the client straight to the import flow. */
  onImport?: () => void;
}

export function CapitalGainsPage({ clientId, client, onImport }: Props) {
  const [statement, setStatement] = useState<GainsStatement | null>(null);
  const [registrarSources, setRegistrarSources] = useState<ElssLockInSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [fy, setFy] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      CasGainsService.getStatement(clientId).catch(() => null),
      // ELSS lock-in for a client whose funds run on the platform, with no CAS.
      fetchRegistrarElssSources(clientId).catch(() => [] as ElssLockInSource[]),
    ])
      .then(([s, reg]) => {
        if (!alive) return;
        setStatement(s);
        setRegistrarSources(reg);
        // Open on the most recent year that actually has a sale in it.
        if (s?.financialYears.length) setFy(s.financialYears[0]);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [clientId]);

  const summary = useMemo(
    () => (statement && fy ? CasGainsService.summarise(statement, fy) : null),
    [statement, fy],
  );

  const rows = useMemo(
    () =>
      statement
        ? statement.disposals
            .filter((d) => d.fy === fy)
            .sort((a, b) => (a.sellDate < b.sellDate ? 1 : a.sellDate > b.sellDate ? -1 : 0))
        : [],
    [statement, fy],
  );

  // ELSS lock-in is about what is still held, so it does not depend on the year.
  // Both sources feed one overlay: the CAS lots where a statement was imported,
  // the registrar lots otherwise. A fund in both is counted once, CAS first —
  // it carries the real cost and grandfathering.
  const lockIn = useMemo(
    () => computeElssLockIn(mergeElssSources(statement?.schemes ?? [], registrarSources)),
    [statement, registrarSources],
  );

  if (loading) {
    return (
      <Card padding="lg">
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Working out your gains…
        </div>
      </Card>
    );
  }

  if (!statement) {
    // Even without a CAS, a client's registrar feed can show their ELSS lock-in.
    return (
      <div className="space-y-5">
        {lockIn && <ElssLockInCard lockIn={lockIn} client={client} />}
        <Card padding="lg">
          <EmptyState
            icon={Receipt}
            title={lockIn ? 'Import a statement for full capital gains' : 'No statement imported yet'}
            hint="Your realised capital gains are worked out from an imported Consolidated Account Statement — import yours and they appear here automatically."
          />
          {onImport && (
            <div className="text-center">
              <button
                type="button"
                onClick={onImport}
                className="rounded-token-md bg-accent px-4 py-2 text-xs font-semibold text-on-accent"
              >
                Import my portfolio
              </button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  if (!statement.financialYears.length) {
    /*
     * Two very different situations, and telling them apart matters.
     *
     * A client who has never redeemed genuinely has no gains. A client whose
     * every fund was excluded for a truncated history HAS sold — one holds 12
     * redemptions across two funds — and telling her she has not sold anything
     * is simply false. She would either believe it, or stop believing the
     * screen. So the exclusions decide the wording.
     */
    const allExcluded = statement.excluded.length > 0;
    return (
      <div className="space-y-5">
        <Card padding="lg">
          <EmptyState
            icon={allExcluded ? AlertTriangle : TrendingUp}
            title={
              allExcluded
                ? 'We can’t work out your gains yet'
                : 'You haven’t sold anything yet'
            }
            hint={
              allExcluded
                ? 'Your statement doesn’t reach back far enough to show what you originally paid for these units, and a gain cannot be worked out without it.'
                : 'Capital gains arise when units are redeemed or switched. Until then there is nothing to report — your unrealised gain is on the portfolio screen.'
            }
          />
        </Card>
        {lockIn && <ElssLockInCard lockIn={lockIn} client={client} />}
        <Exclusions statement={statement} />
      </div>
    );
  }

  const downloadExcel = async () => {
    setBusy(true);
    try {
      await exportCapitalGainsXlsx(
        rows.map((d) => ({
          schemeName: d.schemeName,
          isin: d.isin,
          buyDate: d.buyDate,
          sellDate: d.sellDate,
          units: d.units,
          buyNav: d.buyNav,
          sellNav: d.sellNav,
          actualCost: d.actualCost,
          cost: d.cost,
          grandfathered: d.grandfathered,
          proceeds: d.proceeds,
          gain: d.gain,
          term: termLabel(d.treatment),
          treatment: treatmentLabel(d.treatment),
        })),
        fy,
        client,
      );
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    setBusyPdf(true);
    try {
      await downloadCapitalGainsPdf(rows, fy, client);
    } finally {
      setBusyPdf(false);
    }
  };

  const total = summary?.totalGain ?? 0;
  const up = total >= 0;

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------- year picker */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          options={statement.financialYears.map((y) => ({ value: y, label: `FY ${y}` }))}
          value={fy}
          onChange={setFy}
        />
        <div className="flex items-center gap-2">
        {onImport && (
          <button
            type="button"
            onClick={onImport}
            className="inline-flex items-center gap-1.5 rounded-token-md border border-accent/30 bg-accent/5 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:border-accent/50 hover:bg-accent/10"
          >
            <Upload className="h-3.5 w-3.5" />
            Add or update a statement
          </button>
        )}
        <button
          type="button"
          onClick={downloadPdf}
          disabled={busyPdf || !rows.length}
          className="inline-flex items-center gap-1.5 rounded-token-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
        >
          {busyPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {busyPdf ? 'Preparing…' : 'Download PDF'}
        </button>
        <button
          type="button"
          onClick={downloadExcel}
          disabled={busy || !rows.length}
          className="inline-flex items-center gap-1.5 rounded-token-md border border-border bg-bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
          {busy ? 'Preparing…' : 'Excel'}
        </button>
        </div>
      </div>

      {/* ---------------------------------------------------------- headline */}
      {summary && (
        <Card padding="lg">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <KpiStat
              label={up ? 'Total Gain' : 'Total Loss'}
              value={`${up ? '+' : ''}${fmt(total)}`}
              color={up ? 'var(--success)' : 'var(--danger)'}
              trend={up ? 'up' : 'down'}
              sub={`FY ${fy}`}
            />
            <KpiStat
              label="Long Term"
              value={fmt(summary.equityLong.gain + summary.nonEquityLong.gain)}
              sub={
                summary.exemptionUsed > 0
                  ? `${fmt(summary.exemptionUsed)} exempt`
                  : 'Equity & other'
              }
            />
            <KpiStat
              label="Short Term"
              value={fmt(summary.equityShort.gain + summary.slab.gain)}
              sub={summary.slab.gain !== 0 ? 'Part at your slab' : 'Equity'}
            />
            <KpiStat
              label="Indicative Tax"
              value={fmt(summary.indicativeTax)}
              color="var(--accent)"
              sub="Where a fixed rate applies"
            />
          </div>

          {(summary.slab.gain !== 0 || summary.undecided.gain !== 0) && (
            <p className="mt-4 flex items-start gap-2 rounded-token-lg bg-bg-surface px-3 py-2.5 text-[11px] text-text-secondary">
              <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" />
              <span>
                {summary.slab.gain !== 0 && (
                  <>
                    <strong className="text-text-primary">{fmt(summary.slab.gain)}</strong> is taxed
                    at your own income-tax slab, so it is not included in the indicative figure.{' '}
                  </>
                )}
                {summary.undecided.gain !== 0 && (
                  <>
                    <strong className="text-text-primary">{fmt(summary.undecided.gain)}</strong> is
                    from {summary.undecided.schemes.map(displaySchemeName).join(', ')}, whose tax treatment your relationship
                    manager is confirming.
                  </>
                )}
              </span>
            </p>
          )}
        </Card>
      )}

      {/* ----------------------------------------------------- ELSS lock-in */}
      {lockIn && <ElssLockInCard lockIn={lockIn} client={client} />}

      {/* ------------------------------------------------------------- rows */}
      <Card padding="lg">
        <SectionHeader title={`Realised gains · FY ${fy}`} icon={FileText} />

        {rows.length === 0 ? (
          <EmptyState icon={TrendingUp} title="Nothing sold in this year" compact />
        ) : (
          <div className="m-table-wrap overflow-x-auto">
            <table className="m-table w-full min-w-[860px] text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-secondary">
                  <th className="pb-2 pr-3 font-semibold">Scheme</th>
                  <th className="pb-2 pr-3 font-semibold">Bought</th>
                  <th className="pb-2 pr-3 font-semibold">Sold</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Units</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Cost</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Proceeds</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Gain</th>
                  <th className="pb-2 font-semibold">Treatment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d, i) => {
                  /*
                   * One redemption becomes one row per lot it consumed — nine of
                   * them for a single sale here. Repeating the fund name on each
                   * buries the numbers, so it is printed once and the rest of the
                   * group is left blank, the way a ledger would set it.
                   */
                  const isFirstOfScheme = i === 0 || rows[i - 1].schemeId !== d.schemeId;
                  return (
                  <tr
                    key={`${d.schemeId}-${d.buyDate}-${d.sellDate}-${i}`}
                    className={isFirstOfScheme && i > 0 ? 'border-t border-border' : 'border-b border-border/50'}
                  >
                    <td data-primary className="py-2.5 pr-3">
                      <span className={`font-medium text-text-primary ${isFirstOfScheme ? '' : 'sm:hidden'}`}>
                        {displaySchemeName(d.schemeName)}
                      </span>
                    </td>
                    <td data-label="Bought" className="py-2.5 pr-3 text-text-secondary">{fmtDate(d.buyDate)}</td>
                    <td data-label="Sold" className="py-2.5 pr-3 text-text-secondary">{fmtDate(d.sellDate)}</td>
                    <td data-label="Units" className="py-2.5 pr-3 text-right tabular-nums text-text-secondary">
                      {d.units.toFixed(3)}
                    </td>
                    <td data-label="Cost" className="py-2.5 pr-3 text-right tabular-nums text-text-secondary">
                      {fmt(d.cost)}
                      {d.grandfathered && (
                        /*
                         * The cost shown is the re-based one, so it does not match
                         * what the client paid. Saying why, inline, is the
                         * difference between relief and an apparent error.
                         */
                        <span
                          className="ml-1 cursor-help text-[10px] text-accent"
                          title={`Re-based to the 31-Jan-2018 value under s.55(2)(ac). You actually paid ${fmt(d.actualCost)}; the growth before 01-Feb-2018 is exempt.`}
                        >
                          GF
                        </span>
                      )}
                    </td>
                    <td data-label="Proceeds" className="py-2.5 pr-3 text-right tabular-nums text-text-secondary">
                      {fmt(d.proceeds)}
                    </td>
                    <td
                      data-label="Gain"
                      className="py-2.5 pr-3 text-right font-semibold tabular-nums"
                      style={{ color: d.gain >= 0 ? 'var(--success)' : 'var(--danger)' }}
                    >
                      {d.gain >= 0 ? '+' : ''}
                      {fmt(d.gain)}
                    </td>
                    <td data-label="Treatment" className="py-2.5 text-text-secondary">
                      <span className="whitespace-nowrap">{treatmentLabel(d.treatment)}</span>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.some((d) => d.grandfathered) && (
          <p className="mt-3 text-[11px] text-text-faint">
            <span className="font-semibold text-accent">GF</span> — units bought before 01-Feb-2018.
            Their cost is re-based to the 31-Jan-2018 NAV, so the growth up to that date is exempt.
          </p>
        )}
      </Card>

      <Exclusions statement={statement} />

      <p className="px-1 text-[11px] text-text-faint">
        Worked out from your own Consolidated Account Statement using FIFO, as the Income-tax Act
        requires. Tax figures are indicative and exclude surcharge and cess; gains taxed at your slab
        carry no rate here because your slab is not known to us. This is not a registrar-issued
        statement — please check it against your CAS before filing.
      </p>
    </div>
  );
}

/**
 * ELSS lock-in, lot by lot.
 *
 * An ELSS unit is locked for three years from the day it was bought, and the
 * clock is per purchase — so a client paying a monthly SIP has a different
 * unlock date every month. This is the one place that shows it: what is still
 * locked, what is now free to redeem, and when the rest frees up. The figure
 * that matters for a Section 80C claim is what was invested, which is why that,
 * not the current value, leads.
 */
function ElssLockInCard({ lockIn, client }: { lockIn: ElssLockIn; client: NWClient | null }) {
  const [busy, setBusy] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);
  const showValue = lockIn.currentValue !== null;

  const downloadExcel = async () => {
    setBusy(true);
    try {
      await exportElssLockInXlsx(lockIn.lots, client);
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    setBusyPdf(true);
    try {
      await downloadElssLockInPdf(lockIn.lots, client);
    } finally {
      setBusyPdf(false);
    }
  };

  return (
    <Card padding="lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeader title="ELSS lock-in · Section 80C" icon={ShieldCheck} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadPdf}
            disabled={busyPdf}
            className="inline-flex items-center gap-1.5 rounded-token-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
          >
            {busyPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {busyPdf ? 'Preparing…' : 'Download PDF'}
          </button>
          <button
            type="button"
            onClick={downloadExcel}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-token-md border border-border bg-bg-surface px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
            {busy ? 'Preparing…' : 'Excel'}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KpiStat label="Still locked" value={fmt(lockIn.lockedInvested)} color="var(--warning)" sub="Invested, cannot redeem yet" />
        <KpiStat label="Free to redeem" value={fmt(lockIn.freeInvested)} color="var(--success)" sub="Invested, past lock-in" />
        <KpiStat
          label="Next unlocks"
          value={lockIn.nextUnlockDate ? fmtDate(lockIn.nextUnlockDate) : 'All free'}
          sub={lockIn.nextUnlockDate ? 'Soonest locked lot' : 'Nothing is locked'}
        />
      </div>

      <div className="m-table-wrap mt-4 overflow-x-auto">
        <table className="m-table w-full min-w-[640px] text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-secondary">
              <th className="pb-2 pr-3 font-semibold">Scheme</th>
              <th className="pb-2 pr-3 font-semibold">Bought</th>
              <th className="pb-2 pr-3 text-right font-semibold">Units</th>
              <th className="pb-2 pr-3 text-right font-semibold">Invested</th>
              {showValue && <th className="pb-2 pr-3 text-right font-semibold">Value</th>}
              <th className="pb-2 pr-3 font-semibold">Unlocks</th>
              <th className="pb-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {lockIn.lots.map((l, i) => {
              const isFirstOfScheme = i === 0 || lockIn.lots[i - 1].schemeName !== l.schemeName;
              return (
                <tr
                  key={`${l.schemeName}-${l.buyDate}-${i}`}
                  className={isFirstOfScheme && i > 0 ? 'border-t border-border' : 'border-b border-border/50'}
                >
                  <td data-primary className="py-2.5 pr-3">
                    <span className={`font-medium text-text-primary ${isFirstOfScheme ? '' : 'sm:hidden'}`}>
                      {displaySchemeName(l.schemeName)}
                    </span>
                  </td>
                  <td data-label="Bought" className="py-2.5 pr-3 text-text-secondary">{fmtDate(l.buyDate)}</td>
                  <td data-label="Units" className="py-2.5 pr-3 text-right tabular-nums text-text-secondary">{l.units.toFixed(3)}</td>
                  <td data-label="Invested" className="py-2.5 pr-3 text-right tabular-nums text-text-secondary">{fmt(l.invested)}</td>
                  {showValue && (
                    <td data-label="Value" className="py-2.5 pr-3 text-right tabular-nums text-text-secondary">
                      {l.currentValue === null ? '—' : fmt(l.currentValue)}
                    </td>
                  )}
                  <td data-label="Unlocks" className="py-2.5 pr-3 text-text-secondary">{fmtDate(l.unlockDate)}</td>
                  <td data-label="Status" className="py-2.5">
                    {l.locked ? (
                      <StatusPill tone="warning">
                        <Lock className="h-3 w-3" />
                        {l.daysToUnlock > 0 ? `${l.daysToUnlock} days` : 'Locked'}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="success">Free</StatusPill>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-text-faint">
        Each ELSS purchase is locked for three years from its own allotment date, so a monthly SIP
        unlocks a little each month. Worked out from the still-held units in your imported statement.
      </p>
    </Card>
  );
}

/**
 * Funds this statement could not compute, named.
 *
 * Rendered even when there are no gains at all, because "you have no gains" and
 * "we could not work out your gains on three funds" are very different messages
 * and only one of them is safe to leave unsaid.
 */
function Exclusions({ statement }: { statement: GainsStatement }) {
  if (!statement.excluded.length) return null;

  return (
    <Card padding="lg" className="border-warning/30">
      <SectionHeader title="Not included in this statement" icon={AlertTriangle} />
      <p className="mb-3 text-xs text-text-secondary">
        These funds are missing part of their purchase history, so what you paid for some units
        cannot be established — and a gain cannot be worked out from a cost we do not have.
        Requesting a statement covering all your years fixes it.
      </p>
      <ul className="space-y-2">
        {statement.excluded.map((e) => (
          <li key={e.name} className="rounded-token-lg bg-bg-surface px-3 py-2">
            <p className="text-xs font-semibold text-text-primary">{displaySchemeName(e.name)}</p>
            <p className="mt-0.5 text-[11px] text-text-secondary">{e.reason}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
