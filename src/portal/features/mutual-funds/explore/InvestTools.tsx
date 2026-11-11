/**
 * The tools a fund page shows once the client has said HOW they are investing.
 * -----------------------------------------------------------------------------
 * A SIP and a lumpsum raise different questions, so they get different tools:
 *
 *   SIP      → "what did a real monthly SIP in this fund do?" — instalments
 *              bought at each month's NAV, the average price paid, and XIRR.
 *   Lumpsum  → "how much did the entry date matter?" — the spread of outcomes
 *              across every start date, and the deepest fall to sit through.
 *
 * All of it is this fund's own NAV history replayed. Nothing is a forecast.
 */
import { useMemo, useState } from 'react';
import { CalendarRange, History, TrendingDown } from 'lucide-react';
import { fmt } from '../../../../crm/utils';
import { Card } from '../../../components/Card';
import { Segmented } from '../../../components/Segmented';
import { SectionHeader } from '../../../components/SectionHeader';
import { fmtNav, fmtRet, retColor } from './catalogBits';
import {
  historyYears,
  maxDrawdown,
  monthsBetween,
  rollingReturns,
  sipBacktest,
  type NavSample,
  type Pricing,
} from './navMath';

const NOTE: Record<Pricing, string> = {
  daily:
    'Replayed on every NAV this fund has published (Regular plan), before exit load and tax. Past performance does not indicate future results.',
  sampled:
    'The daily NAV series could not be loaded, so this is replayed on sampled NAV history and the figures are approximate. Past performance does not indicate future results.',
};

/** The series the tools run on: daily when it could be fetched, else the chart's sample. */
export interface ToolSeries {
  samples: NavSample[];
  pricing: Pricing;
}

const monthYear = (t: number) => new Date(t).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

function Stat({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div className="rounded-token-md bg-bg-surface px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-wide text-text-faint">{label}</p>
      <p className="mt-0.5 text-sm font-bold tabular-nums text-text-primary" style={color ? { color } : undefined}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[10px] text-text-secondary">{hint}</p>}
    </div>
  );
}

type Span = '1' | '3' | '5' | 'max';

/* ----------------------------------- SIP ---------------------------------- */

export function SipTools({ data, amount }: { data: ToolSeries; amount: number }) {
  const { samples: series, pricing } = data;
  const years = historyYears(series);
  const spans = useMemo(() => {
    const opts: { value: Span; label: string }[] = [];
    if (years >= 0.95) opts.push({ value: '1', label: '1 year' });
    if (years >= 2.95) opts.push({ value: '3', label: '3 years' });
    if (years >= 4.95) opts.push({ value: '5', label: '5 years' });
    if (years > 5.5) opts.push({ value: 'max', label: `Since ${new Date(series[0].t).getFullYear()}` });
    return opts;
  }, [years, series]);
  const [span, setSpan] = useState<Span>('3');
  const active = spans.find((s) => s.value === span) ?? spans[spans.length - 1];

  const result = useMemo(() => {
    if (!active) return null;
    const months = active.value === 'max' ? Math.floor(years * 12) : Number(active.value) * 12;
    return sipBacktest(series, amount, months, pricing);
  }, [series, amount, active, years, pricing]);

  if (!active || !result) return null;
  const cheaper = result.avgNav < result.lastNav;
  // Where the average price paid sits between the lowest and highest NAV of the window.
  const window = series.filter((s) => s.t >= result.from);
  const lo = Math.min(...window.map((s) => s.nav));
  const hi = Math.max(...window.map((s) => s.nav));
  const pos = (v: number) => (hi > lo ? Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)) : 50);

  return (
    <Card>
      <SectionHeader title="SIP backtest" icon={History} />
      <p className="-mt-2 mb-4 text-xs leading-relaxed text-text-secondary">
        A {fmt(amount)} monthly SIP, each instalment bought at that month’s NAV — what actually happened, not an
        average rate applied.
      </p>

      {spans.length > 1 && (
        <Segmented<Span> options={spans} value={active.value} onChange={setSpan} size="sm" />
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Instalments" value={String(result.instalments)} hint={`${monthYear(result.from)} – ${monthYear(result.to)}`} />
        <Stat label="Invested" value={fmt(result.invested)} />
        <Stat
          label="Value today"
          value={fmt(Math.round(result.value))}
          hint={`${result.gainPct > 0 ? '+' : ''}${result.gainPct.toFixed(1)}% on money put in`}
        />
        <Stat
          label="XIRR"
          value={result.xirrPct === null ? '—' : fmtRet(result.xirrPct)}
          color={retColor(result.xirrPct)}
          hint="Annualised, money-weighted"
        />
      </div>

      <div className="mt-5 rounded-token-md border border-border-subtle p-4">
        <p className="text-xs font-bold text-text-primary">Rupee-cost averaging</p>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">
          Across {result.instalments} instalments the average price paid was{' '}
          <span className="font-semibold text-text-primary">{fmtNav(result.avgNav)}</span> a unit, against a NAV of{' '}
          <span className="font-semibold text-text-primary">{fmtNav(result.lastNav)}</span> today
          {cheaper
            ? ' — the SIP bought more units in the months the NAV was lower.'
            : ' — the NAV is currently below the average price paid.'}
        </p>
        <div className="relative mt-6 h-1.5 rounded-full bg-bg-surface">
          <Marker at={pos(result.avgNav)} label="Avg. paid" tone="var(--accent)" />
          <Marker at={pos(result.lastNav)} label="Today" tone={retColor(result.lastNav - result.avgNav)} below />
        </div>
        <div className="mt-6 flex justify-between text-[10px] text-text-faint">
          <span>Low {fmtNav(lo)}</span>
          <span>High {fmtNav(hi)}</span>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-text-faint">{NOTE[pricing]}</p>
    </Card>
  );
}

function Marker({ at, label, tone, below = false }: { at: number; label: string; tone: string; below?: boolean }) {
  return (
    <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${at}%` }}>
      <span className="block h-3.5 w-3.5 rounded-full border-2 border-bg-elevated" style={{ background: tone }} />
      <span
        className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-text-secondary ${
          below ? 'top-4' : 'bottom-4'
        }`}
      >
        {label}
      </span>
    </span>
  );
}

/* --------------------------------- Lumpsum -------------------------------- */

export function LumpsumTools({ data, amount }: { data: ToolSeries; amount: number }) {
  const { samples: series, pricing } = data;
  const stats = useMemo(
    () =>
      (['1', '3', '5'] as const)
        .map((y) => ({
          value: y,
          label: `${y} year${y === '1' ? '' : 's'}`,
          r: rollingReturns(series, Number(y), pricing),
        }))
        .filter((x) => x.r !== null),
    [series, pricing],
  );
  const [hold, setHold] = useState<'1' | '3' | '5'>('3');
  const active = stats.find((s) => s.value === hold) ?? stats[stats.length - 1];
  const dd = useMemo(() => maxDrawdown(series), [series]);

  if (!active && !dd) return null;
  const yrs = active ? Number(active.value) : 0;
  const grown = (pct: number) => fmt(Math.round(amount * Math.pow(1 + pct / 100, yrs)));

  return (
    <>
      {active?.r && (
        <Card>
          <SectionHeader title="Entry timing" icon={CalendarRange} />
          <p className="-mt-2 mb-4 text-xs leading-relaxed text-text-secondary">
            The same {fmt(amount)} invested on {active.r.count.toLocaleString('en-IN')} different dates in this fund’s history, each held for{' '}
            {active.label}. The spread is what the entry date alone was worth.
          </p>

          {stats.length > 1 && (
            <Segmented<'1' | '3' | '5'>
              options={stats.map((s) => ({ value: s.value, label: `Held ${s.label}` }))}
              value={active.value}
              onChange={setHold}
              size="sm"
            />
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Best entry" value={fmtRet(active.r.best)} color={retColor(active.r.best)} hint={`Became ${grown(active.r.best)}`} />
            <Stat label="Typical entry" value={fmtRet(active.r.median)} color={retColor(active.r.median)} hint={`Became ${grown(active.r.median)}`} />
            <Stat label="Worst entry" value={fmtRet(active.r.worst)} color={retColor(active.r.worst)} hint={`Became ${grown(active.r.worst)}`} />
            <Stat
              label="Ended in a loss"
              value={`${active.r.lossPct.toFixed(0)}%`}
              hint={active.r.lossPct === 0 ? 'No entry date lost money' : 'of entry dates'}
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-text-faint">
            {yrs > 1 ? 'Returns are annualised. ' : ''}
            {NOTE[pricing]}
          </p>
        </Card>
      )}

      {dd && (
        <Card>
          <SectionHeader title="Deepest fall to sit through" icon={TrendingDown} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Peak to low" value={`${dd.pct.toFixed(1)}%`} color="var(--danger)" />
            <Stat label={`${fmt(amount)} at the low`} value={fmt(Math.round(amount * (1 + dd.pct / 100)))} hint="If invested at the peak" />
            <Stat label="Fell over" value={`${monthsBetween(dd.peakT, dd.troughT)} mo`} hint={`${monthYear(dd.peakT)} – ${monthYear(dd.troughT)}`} />
            <Stat
              label="Back to the peak"
              value={dd.recoveredT ? `${monthsBetween(dd.troughT, dd.recoveredT)} mo` : 'Not yet'}
              hint={dd.recoveredT ? `By ${monthYear(dd.recoveredT)}` : 'Still below its peak'}
            />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-text-secondary">
            A lumpsum carries the whole amount through a fall like this. If that would be hard to hold through, a
            staggered entry or a SIP spreads the entry price.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-text-faint">{NOTE[pricing]}</p>
        </Card>
      )}
    </>
  );
}
