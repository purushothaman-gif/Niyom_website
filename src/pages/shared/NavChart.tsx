import { useMemo, useState } from 'react';
import type { MfNavPoint } from './mfSource';

/**
 * Hand-rolled SVG NAV line/area chart with range toggles. No charting library
 * (the codebase renders charts as raw SVG — see crm/leads/LeadCharts.tsx). The
 * y-axis is scaled to the visible min/max so day-to-day variation is legible
 * rather than flattened against zero.
 */

type RangeKey = '1M' | '6M' | '1Y' | '3Y' | 'MAX';
const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '1M', label: '1M', days: 31 },
  { key: '6M', label: '6M', days: 183 },
  { key: '1Y', label: '1Y', days: 366 },
  { key: '3Y', label: '3Y', days: 1096 },
  { key: 'MAX', label: 'Max', days: null },
];

/** Parse mfapi.in "dd-mm-yyyy" into epoch ms. */
function parse(d: string): number {
  const [dd, mm, yy] = d.split('-').map(Number);
  return new Date(yy, mm - 1, dd).getTime();
}

const fmtNav = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });

interface NavChartProps {
  points: MfNavPoint[];
  /** Optional fixed height in px (default 200). */
  height?: number;
}

export function NavChart({ points, height = 200 }: NavChartProps) {
  const [range, setRange] = useState<RangeKey>('1Y');

  const sorted = useMemo(
    () => [...points].sort((a, b) => parse(a.date) - parse(b.date)),
    [points],
  );

  const visible = useMemo(() => {
    const cfg = RANGES.find((r) => r.key === range);
    if (!cfg?.days || sorted.length === 0) return sorted;
    const cutoff = parse(sorted[sorted.length - 1].date) - cfg.days * 24 * 3600 * 1000;
    const filtered = sorted.filter((p) => parse(p.date) >= cutoff);
    return filtered.length >= 2 ? filtered : sorted;
  }, [sorted, range]);

  const geom = useMemo(() => {
    if (visible.length < 2) return null;
    const W = 640, H = 200, P = 6;
    const navs = visible.map((p) => p.nav);
    const min = Math.min(...navs);
    const max = Math.max(...navs);
    const span = max - min || 1;
    const step = (W - P * 2) / (visible.length - 1);
    const pts = visible.map((p, i) => {
      const x = P + i * step;
      const y = P + (1 - (p.nav - min) / span) * (H - P * 2);
      return [x, y] as const;
    });
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - P} L${pts[0][0].toFixed(1)},${H - P} Z`;
    const up = visible[visible.length - 1].nav >= visible[0].nav;
    return { W, H, line, area, min, max, up };
  }, [visible]);

  // Green when the range gained, red when it lost — matches the returns palette.
  const color = geom?.up ? 'var(--success-soft-rgb)' : 'var(--danger-soft-rgb)';

  return (
    <div>
      <div className="flex items-center justify-end gap-1 mb-2">
        {RANGES.map((r) => {
          const selected = r.key === range;
          return (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className="press text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors"
              style={
                selected
                  ? { background: 'rgb(var(--accent-soft-rgb))', color: 'var(--text-on-accent)' }
                  : { background: 'var(--bg-raised)', color: 'var(--text-secondary)' }
              }
              aria-pressed={selected}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {geom ? (
        <>
          <svg
            width="100%"
            viewBox={`0 0 ${geom.W} ${geom.H}`}
            preserveAspectRatio="none"
            style={{ height }}
            role="img"
            aria-label="NAV history chart"
          >
            <path d={geom.area} fill={`rgba(${color},0.12)`} />
            <path
              d={geom.line}
              fill="none"
              stroke={`rgb(${color})`}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="flex justify-between mt-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
            <span>{fmtDay(parse(visible[0].date))}</span>
            <span>Low ₹{fmtNav(geom.min)} · High ₹{fmtNav(geom.max)}</span>
            <span>{fmtDay(parse(visible[visible.length - 1].date))}</span>
          </div>
        </>
      ) : (
        <div
          className="rounded-xl p-8 text-center text-sm"
          style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)', height }}
        >
          Not enough NAV history for this range.
        </div>
      )}
    </div>
  );
}
