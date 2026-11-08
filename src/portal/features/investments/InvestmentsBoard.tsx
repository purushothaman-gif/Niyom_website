/**
 * InvestmentsBoard
 * -----------------------------------------------------------------------------
 * The multi-asset portfolio view shared by the client Wealth Portal and the
 * Partner Portal: a summary hero (current / invested / 1D / total returns /
 * XIRR), asset tabs (All · Mutual Funds · Bonds · Unlisted Shares), a sortable
 * holdings table whose columns adapt to the asset, an allocation ring, and a
 * detail pane for the selected holding.
 *
 * Pure presentation over InvestmentRow — no data access here.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, Info, Loader2, Wallet } from 'lucide-react';
import { inr, inrCompact } from '../../../lib/money';
import { DonutChart } from '../../components/DonutChart';
import {
  ASSET_META,
  summarise,
  type AssetKey,
  type InvestmentRow,
  type InvestmentSummary,
} from '../../../../shared/portal/investments/model';
import { ChangeCell, price, shortDay, signedInr, signedPct, toneOf, units } from './format';
import { HoldingDetail } from './HoldingDetail';

type Tab = 'all' | AssetKey;

interface Column {
  key: string;
  label: string;
  /** Hidden below md on the table; the mobile card shows its own summary. */
  sortValue: (r: InvestmentRow) => number | string;
  render: (r: InvestmentRow, total: number) => ReactNode;
  align?: 'left' | 'right';
  width?: string;
}

const nameCol = (label: string, showAsset: boolean): Column => ({
  key: 'name',
  label,
  align: 'left',
  sortValue: (r) => r.name.toLowerCase(),
  render: (r) => (
    <div className="min-w-0">
      <p className="line-clamp-2 text-sm font-semibold leading-snug text-text-primary">{r.name}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {showAsset && <AssetChip asset={r.asset} />}
        {r.sub && <span className="truncate text-[11px] text-text-secondary">{r.sub}</span>}
        {r.distributor === 'other' && (
          <span className="rounded border border-border px-1.5 py-px text-[10px] font-medium text-text-secondary" title="Held with another distributor (from your CAS)">
            Other ARN
          </span>
        )}
        {r.source === 'registrar' && (
          <span className="rounded border border-border px-1.5 py-px text-[10px] font-medium text-text-secondary">
            Registrar
          </span>
        )}
      </div>
    </div>
  ),
});

const dayCol: Column = {
  key: 'day',
  label: '1D change',
  sortValue: (r) => r.dayChangePct ?? -Infinity,
  render: (r) => <ChangeCell amount={r.dayChange} percent={r.dayChangePct} />,
};

const returnsCol: Column = {
  key: 'returns',
  label: 'Returns',
  sortValue: (r) => r.gainPct ?? -Infinity,
  render: (r) => <ChangeCell amount={r.gain} percent={r.gainPct} />,
};

const valueCol: Column = {
  key: 'value',
  label: 'Current (Invested)',
  sortValue: (r) => r.value,
  render: (r) => (
    <span className="block text-right">
      <span className="block text-sm font-bold tabular-nums text-text-primary">{inr(r.value)}</span>
      <span className="block text-xs tabular-nums text-text-secondary">
        {r.invested == null ? '—' : inr(r.invested)}
      </span>
    </span>
  ),
};

function columnsFor(tab: Tab, rows: InvestmentRow[]): Column[] {
  switch (tab) {
    case 'mutual_fund':
      return [
        nameCol('Fund name', false),
        {
          key: 'r3y',
          label: 'Fund 3Y',
          sortValue: (r) => r.fundReturn3y ?? -Infinity,
          render: (r) => (
            <span className="block text-right">
              <span className={`block text-sm font-semibold tabular-nums ${toneOf(r.fundReturn3y)}`}>
                {signedPct(r.fundReturn3y, 1)}
              </span>
              <span className="block text-xs tabular-nums text-text-secondary">
                1Y {signedPct(r.fundReturn1y, 1)}
              </span>
            </span>
          ),
        },
        dayCol,
        returnsCol,
        valueCol,
      ];
    case 'bond': {
      const hasCoupon = rows.some((r) => r.coupon != null);
      return [
        nameCol('Bond', false),
        hasCoupon
          ? {
              key: 'coupon',
              label: 'Coupon',
              sortValue: (r) => r.coupon ?? -Infinity,
              render: (r) => (
                <span className="block text-right">
                  <span className="block text-sm font-semibold tabular-nums text-text-primary">
                    {r.coupon != null ? `${r.coupon}%` : '—'}
                  </span>
                  <span className="block text-xs text-text-secondary">{r.payoutFrequency ?? ''}</span>
                </span>
              ),
            }
          : qtyCol('Units'),
        hasCoupon
          ? {
              key: 'maturity',
              label: 'Maturity',
              sortValue: (r) => r.maturity ?? '',
              render: (r) => (
                <span className="block text-right">
                  <span className="block text-sm font-semibold tabular-nums text-text-primary">
                    {shortDay(r.maturity)}
                  </span>
                  <span className="block text-xs text-text-secondary">
                    {r.nextPayout ? `Next ${shortDay(r.nextPayout)}` : ''}
                  </span>
                </span>
              ),
            }
          : priceCol,
        returnsCol,
        valueCol,
      ];
    }
    case 'unlisted_share':
      return [nameCol('Company', false), qtyCol('Quantity'), priceCol, returnsCol, valueCol];
    default:
      return [
        nameCol('Holding', true),
        {
          key: 'weight',
          label: 'Weight',
          sortValue: (r) => r.value,
          render: (r, total) => {
            const w = total > 0 ? (r.value / total) * 100 : 0;
            return (
              <span className="block text-right">
                <span className="block text-sm font-semibold tabular-nums text-text-primary">{w.toFixed(1)}%</span>
                <span className="mt-1 ml-auto block h-1 w-16 overflow-hidden rounded-full bg-bg-surface">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.min(100, w)}%`, background: ASSET_META[r.asset].color }}
                  />
                </span>
              </span>
            );
          },
        },
        dayCol,
        returnsCol,
        valueCol,
      ];
  }
}

function qtyCol(label: string): Column {
  return {
    key: 'qty',
    label,
    sortValue: (r) => r.units ?? -Infinity,
    render: (r) => (
      <span className="block text-right">
        <span className="block text-sm font-semibold tabular-nums text-text-primary">{units(r.units)}</span>
        <span className="block text-xs tabular-nums text-text-secondary">
          {r.avgPrice != null ? `Avg ${price(r.avgPrice)}` : ''}
        </span>
      </span>
    ),
  };
}

const priceCol: Column = {
  key: 'price',
  label: 'Price',
  sortValue: (r) => r.price ?? -Infinity,
  render: (r) => (
    <span className="block text-right text-sm font-semibold tabular-nums text-text-primary">{price(r.price)}</span>
  ),
};

function AssetChip({ asset }: { asset: AssetKey }) {
  const m = ASSET_META[asset];
  return (
    <span
      className="rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wide"
      style={{ background: `${m.color}1f`, color: m.color }}
    >
      {m.short}
    </span>
  );
}

/* ------------------------------------------------------------------------- */

export interface InvestmentsBoardProps {
  rows: InvestmentRow[];
  /** Mutual-fund enrichment still in flight. */
  enriching?: boolean;
  title?: string;
  /** Portfolio XIRR across ALL holdings; shown on the All tab only. */
  xirrPercent?: number | null;
  /** Share of the portfolio the XIRR covers (0–100). */
  xirrCoveragePct?: number | null;
  /** 'under_1y': XIRR not annualised yet. */
  xirrNote?: 'under_1y' | null;
  /** Lock the board to one asset (e.g. the Mutual Funds page). */
  lockedAsset?: AssetKey;
  /** Header-right content, e.g. an "Invest more" button. */
  actions?: ReactNode;
  /** Truncate the table and offer a link to the full view. */
  maxRows?: number;
  onViewAll?: () => void;
  /** No side column: table + inline detail. For drill-downs. */
  compact?: boolean;
  /** Extra action inside the detail pane, per holding. */
  detailAction?: (row: InvestmentRow) => ReactNode;
  /** Note under the table, e.g. data source/freshness. */
  footnote?: ReactNode;
  emptyState?: ReactNode;
}

export function InvestmentsBoard({
  rows,
  enriching = false,
  title = 'Your investments',
  xirrPercent,
  xirrCoveragePct = null,
  xirrNote = null,
  lockedAsset,
  actions,
  maxRows,
  onViewAll,
  compact = false,
  detailAction,
  footnote,
  emptyState,
}: InvestmentsBoardProps) {
  const [tab, setTab] = useState<Tab>(lockedAsset ?? 'all');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'value', dir: 'desc' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (lockedAsset) setTab(lockedAsset);
  }, [lockedAsset]);

  const allSummary = useMemo(() => summarise(rows), [rows]);
  const tabRows = useMemo(() => (tab === 'all' ? rows : rows.filter((r) => r.asset === tab)), [rows, tab]);
  const summary = useMemo(() => (tab === 'all' ? allSummary : summarise(tabRows)), [tab, allSummary, tabRows]);
  const columns = useMemo(() => columnsFor(tab, tabRows), [tab, tabRows]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? valueCol;
    const list = [...tabRows].sort((a, b) => {
      const va = col.sortValue(a);
      const vb = col.sortValue(b);
      const cmp = typeof va === 'string' ? va.localeCompare(String(vb)) : (va as number) - (vb as number);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [tabRows, columns, sort]);

  const visible = maxRows ? sorted.slice(0, maxRows) : sorted;
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'all', label: 'All', count: rows.length },
    ...allSummary.slices.map((s) => ({ key: s.asset as Tab, label: s.label, count: s.count })),
  ];

  const onSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));

  const mask = (s: string) => (hidden ? '₹ • • • •' : s);

  if (!rows.length) {
    return (
      <section className="rounded-token-xl border border-border bg-bg-elevated shadow-token-card">
        {emptyState ?? (
          <div className="px-6 py-14 text-center">
            <Wallet className="mx-auto h-8 w-8 text-text-faint" />
            <p className="mt-3 font-display text-base font-bold text-text-primary">No investments yet</p>
            <p className="mt-1 text-sm text-text-secondary">Holdings appear here as soon as they settle.</p>
          </div>
        )}
      </section>
    );
  }

  return (
    <div className={compact ? 'space-y-4' : 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]'}>
      {/* ---------------- Main column ---------------- */}
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold tracking-tight text-text-primary">
            {title} <span className="text-text-faint">({summary.count})</span>
          </h2>
          <div className="flex items-center gap-2">
            {enriching && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-text-faint">
                <Loader2 className="h-3 w-3 animate-spin" /> Updating prices
              </span>
            )}
            <button
              type="button"
              onClick={() => setHidden((h) => !h)}
              aria-label={hidden ? 'Show amounts' : 'Hide amounts'}
              className="rounded-full border border-border bg-bg-surface p-2 text-text-secondary transition-colors hover:text-text-primary"
            >
              {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            {actions}
          </div>
        </div>

        <SummaryHero summary={summary} xirr={tab === 'all' ? xirrPercent : undefined} xirrCoverage={xirrCoveragePct} xirrNote={xirrNote} mask={mask} />

        {!lockedAsset && tabs.length > 2 && (
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {tabs.map((t) => {
              const on = t.key === tab;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key);
                    setSort({ key: 'value', dir: 'desc' });
                  }}
                  className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors ${
                    on
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-bg-surface text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {t.label} <span className={on ? 'text-accent/70' : 'text-text-faint'}>{t.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Desktop table */}
        <div className="hidden overflow-hidden rounded-token-xl border border-border bg-bg-elevated shadow-token-card md:block">
          <table className="w-full table-fixed">
            <colgroup>
              <col />
              {columns.slice(1).map((c) => (
                <col key={c.key} className={c.key === "value" ? "w-[19%]" : "w-[15%]"} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-border-subtle bg-bg-surface/60">
                {columns.map((c, i) => {
                  const active = sort.key === c.key;
                  return (
                    <th
                      key={c.key}
                      className={`whitespace-nowrap px-4 py-3 text-xs font-semibold text-text-secondary ${
                        i === 0 ? 'pl-5 text-left' : 'text-right'
                      } ${i === columns.length - 1 ? 'pr-5' : ''}`}
                    >
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        className={`inline-flex items-center gap-1 hover:text-text-primary ${active ? 'text-accent' : ''}`}
                      >
                        {c.label}
                        {active ? (
                          sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
                        ) : (
                          <span className="inline-flex flex-col opacity-40">
                            <ArrowUp className="-mb-1 h-2.5 w-2.5" />
                            <ArrowDown className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const on = r.id === selectedId;
                return (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedId(on ? null : r.id)}
                    className={`cursor-pointer border-b border-border-subtle transition-colors last:border-0 ${
                      on ? 'bg-accent/[0.07]' : 'hover:bg-hover'
                    }`}
                  >
                    {columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={`px-4 py-4 align-middle ${i === 0 ? 'pl-5' : ''} ${
                          i === columns.length - 1 ? 'pr-5' : ''
                        } ${hidden && i > 0 ? 'blur-sm select-none' : ''}`}
                      >
                        {c.render(r, summary.current)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {compact && selected && (
            <div className="border-t border-border-subtle">
              <HoldingDetail row={selected} onClose={() => setSelectedId(null)} action={detailAction?.(selected)} />
            </div>
          )}
        </div>

        {/* Mobile cards */}
        <div className="space-y-2.5 md:hidden">
          {visible.map((r) => (
            <MobileCard
              key={r.id}
              row={r}
              hidden={hidden}
              showAsset={tab === 'all'}
              onOpen={() => setSelectedId(r.id)}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-xs text-text-faint">
            Showing {visible.length} of {tabRows.length}
          </p>
          {onViewAll && maxRows && tabRows.length > 0 && (
            <button
              type="button"
              onClick={onViewAll}
              className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-soft"
            >
              View full portfolio <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {summary.unknownCostCount > 0 && (
          <p className="flex items-start gap-2 rounded-token-lg border border-border-subtle bg-bg-surface px-3.5 py-2.5 text-[11px] leading-relaxed text-text-secondary">
            <Info className="mt-px h-3.5 w-3.5 shrink-0 text-text-faint" />
            <span>
              {summary.unknownCostCount} registrar-fed fund{summary.unknownCostCount > 1 ? 's' : ''} show value and
              daily movement but not returns — the registrar reports holdings without purchase cost.
              {summary.costCoveragePct > 0 &&
                ` Invested and returns above cover ${summary.costCoveragePct.toFixed(0)}% of the portfolio by value.`}
            </span>
          </p>
        )}
        {footnote}
      </div>

      {/* ---------------- Side column ---------------- */}
      {!compact && (
        <aside className="space-y-5">
          <AllocationPanel summary={allSummary} hidden={hidden} />
          <div className="hidden overflow-hidden rounded-token-xl border border-border bg-bg-elevated shadow-token-card lg:block">
            <HoldingDetail
              row={selected}
              onClose={selected ? () => setSelectedId(null) : undefined}
              action={selected ? detailAction?.(selected) : undefined}
            />
          </div>
        </aside>
      )}

      {/* Detail sheet on small screens (and in compact mode on mobile). */}
      {selected && (
        <div className={`fixed inset-0 z-50 flex items-end bg-black/50 ${compact ? 'md:hidden' : 'lg:hidden'}`} onClick={() => setSelectedId(null)}>
          <div
            className="max-h-[85vh] w-full overflow-y-auto rounded-t-token-xl border-t border-border bg-bg-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <HoldingDetail row={selected} onClose={() => setSelectedId(null)} action={detailAction?.(selected)} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------- */

function SummaryHero({
  summary,
  xirr,
  xirrCoverage = null,
  xirrNote = null,
  mask,
}: {
  summary: InvestmentSummary;
  xirr?: number | null;
  xirrCoverage?: number | null;
  xirrNote?: 'under_1y' | null;
  mask: (s: string) => string;
}) {
  const returnsKnown = summary.returnsPct != null;
  const showXirr = xirr !== undefined;
  return (
    <section className="relative overflow-hidden rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card sm:p-6">
      <span
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-[0.07]"
        style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }}
      />
      <p className="text-xs font-medium text-text-secondary">Current value</p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums tracking-tight text-text-primary sm:text-4xl">
        {mask(inr(summary.current))}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-dashed border-border pt-5 sm:grid-cols-4">
        <Stat label="Invested value" value={returnsKnown ? mask(inr(summary.invested)) : '—'} />
        <Stat
          label="1D returns"
          value={summary.dayChange == null ? '—' : mask(signedInr(summary.dayChange))}
          sub={summary.dayChange == null ? undefined : signedPct(summary.dayChangePct)}
          tone={summary.dayChange}
        />
        <Stat
          label="Total returns"
          value={returnsKnown ? mask(signedInr(summary.returns)) : '—'}
          sub={returnsKnown ? signedPct(summary.returnsPct) : 'Awaiting cost data'}
          tone={returnsKnown ? summary.returns : null}
        />
        {showXirr ? (
          <Stat label="XIRR" value={xirr == null ? '—' : signedPct(xirr)} tone={xirr} sub={xirr == null ? (xirrNote === 'under_1y' ? 'Shown after 1 year' : 'Needs more history') : xirrCoverage != null && xirrCoverage < 99.5 ? `Covers ${Math.round(xirrCoverage)}% of value` : 'Annualised'} />
        ) : (
          <Stat label="Holdings" value={String(summary.count)} sub={summary.slices.length > 1 ? `${summary.slices.length} asset classes` : undefined} />
        )}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: number | null;
}) {
  const cls = tone === undefined ? 'text-text-primary' : tone == null ? 'text-text-primary' : toneOf(tone);
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className={`mt-1 truncate text-base font-bold tabular-nums ${cls}`}>{value}</p>
      {sub && <p className={`text-[11px] tabular-nums ${tone != null ? toneOf(tone) : 'text-text-faint'}`}>{sub}</p>}
    </div>
  );
}

function AllocationPanel({ summary, hidden }: { summary: InvestmentSummary; hidden: boolean }) {
  return (
    <section className="rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card">
      <h3 className="font-display text-sm font-bold text-text-primary">Asset allocation</h3>
      <div className="mt-4 flex justify-center">
        <DonutChart
          size={170}
          thickness={18}
          segments={summary.slices.map((s) => ({ label: s.label, value: s.value, color: s.color }))}
          centerLabel={hidden ? '••••' : inrCompact(summary.current)}
          centerSub="TOTAL"
        />
      </div>
      <ul className="mt-5 space-y-3">
        {summary.slices.map((s) => (
          <li key={s.asset}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
                <span className="truncate text-text-primary">{s.label}</span>
                <span className="text-[11px] text-text-faint">{s.count}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-text-primary">{s.percent.toFixed(1)}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg-surface">
              <div className="h-full rounded-full" style={{ width: `${s.percent}%`, background: s.color }} />
            </div>
            <p className="mt-1 text-right text-[11px] tabular-nums text-text-secondary">
              {hidden ? '••••' : inr(s.value)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MobileCard({
  row: r,
  hidden,
  showAsset,
  onOpen,
}: {
  row: InvestmentRow;
  hidden: boolean;
  showAsset: boolean;
  onOpen: () => void;
}) {
  const secondary =
    r.asset === 'bond' && r.coupon != null
      ? `${r.coupon}% · matures ${shortDay(r.maturity)}`
      : r.asset === 'mutual_fund' && r.fundReturn3y != null
        ? `Fund 3Y ${signedPct(r.fundReturn3y, 1)}`
        : r.units != null
          ? `${units(r.units)} units`
          : '';
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-token-xl border border-border bg-bg-elevated p-4 text-left shadow-token-card active:bg-hover"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-text-primary">{r.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {showAsset && <AssetChip asset={r.asset} />}
            <span className="truncate text-[11px] text-text-secondary">{r.sub ?? secondary}</span>
          </div>
        </div>
        <div className={`shrink-0 text-right ${hidden ? 'blur-sm' : ''}`}>
          <p className="text-sm font-bold tabular-nums text-text-primary">{inr(r.value)}</p>
          <p className="text-[11px] tabular-nums text-text-secondary">{r.invested == null ? '—' : inr(r.invested)}</p>
        </div>
      </div>
      <div className={`mt-3 flex items-center justify-between border-t border-border-subtle pt-2.5 text-[11px] ${hidden ? 'blur-sm' : ''}`}>
        <span className="text-text-secondary">
          1D{' '}
          <span className={`font-semibold tabular-nums ${toneOf(r.dayChange)}`}>
            {r.dayChange == null ? '—' : `${signedInr(r.dayChange)} (${signedPct(r.dayChangePct)})`}
          </span>
        </span>
        <span className="text-text-secondary">
          Returns{' '}
          <span className={`font-semibold tabular-nums ${toneOf(r.gain)}`}>
            {r.gain == null ? '—' : `${signedInr(r.gain)} (${signedPct(r.gainPct)})`}
          </span>
        </span>
      </div>
    </button>
  );
}
