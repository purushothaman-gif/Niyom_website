// NAV movement chart, as SVG markup.
//
// One renderer serves both surfaces: the research screen embeds the markup
// directly, and the factsheet splices the same string into its document before
// rasterising. A second implementation would eventually disagree with the
// first, and a client comparing the screen an employee showed them against the
// image they were sent would be looking at two different charts.
//
// Deliberately plain: no library, no interactivity, no tooltip. It renders from
// a point array with no runtime dependencies, which is what lets it survive the
// trip through an <img> data URI where scripts never execute.
//
// Honesty rules baked in, because this is performance data going to a retail
// investor:
//   - the y-axis is labelled with real NAV values at both ends of the band, so
//     a shallow rise cannot be read as a steep one
//   - the axis is NOT zero-based (NAV series would be unreadable if it were),
//     which is exactly why the band labels are mandatory rather than optional
//   - the period actually plotted is stated on the chart

import type { CatalogNavPoint } from '../../../portal/types/funds';

export type NavRange = '1Y' | '3Y' | '5Y' | 'ALL';

export const NAV_RANGES: { id: NavRange; label: string; years: number | null }[] = [
  { id: '1Y', label: '1Y', years: 1 },
  { id: '3Y', label: '3Y', years: 3 },
  { id: '5Y', label: '5Y', years: 5 },
  { id: 'ALL', label: 'All', years: null },
];

/** mfapi returns "dd-mm-yyyy"; Date.parse does not understand it. */
export function parseNavDate(s: string): Date | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim());
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

export interface NavSeries {
  points: { t: number; nav: number }[];
  min: number;
  max: number;
  first: { t: number; nav: number } | null;
  last: { t: number; nav: number } | null;
  /** Absolute change across the plotted window, as a percentage. */
  changePct: number | null;
}

/** Normalise, sort oldest-first and clip to the requested window. */
export function buildNavSeries(history: CatalogNavPoint[], range: NavRange): NavSeries {
  const parsed = history
    .map(p => {
      const d = parseNavDate(p.date);
      return d && Number.isFinite(p.nav) ? { t: d.getTime(), nav: Number(p.nav) } : null;
    })
    .filter((p): p is { t: number; nav: number } => p !== null)
    .sort((a, b) => a.t - b.t);

  const years = NAV_RANGES.find(r => r.id === range)?.years ?? null;
  let points = parsed;
  if (years !== null && parsed.length) {
    const cutoff = parsed[parsed.length - 1].t - years * 365.25 * 24 * 3600 * 1000;
    const windowed = parsed.filter(p => p.t >= cutoff);
    // A scheme younger than the window still deserves a chart — fall back to
    // its whole life rather than rendering two points.
    points = windowed.length >= 2 ? windowed : parsed;
  }

  const navs = points.map(p => p.nav);
  const min = navs.length ? Math.min(...navs) : 0;
  const max = navs.length ? Math.max(...navs) : 0;
  const first = points[0] ?? null;
  const last = points[points.length - 1] ?? null;
  const changePct = first && last && first.nav > 0
    ? ((last.nav - first.nav) / first.nav) * 100
    : null;

  return { points, min, max, first, last, changePct };
}

export interface NavChartOptions {
  width: number;
  height: number;
  /** Unique per document — gradient ids collide otherwise. */
  uid: string;
  line: string;
  fillFrom: string;
  axis: string;
  label: string;
  /** Rendered top-left, e.g. "NAV · last 3 years". */
  caption?: string;
  fontFamily: string;
}

const fmtNav = (v: number) => `₹${v >= 1000 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(2)}`;

function fmtYear(t: number): string {
  return String(new Date(t).getFullYear());
}

/**
 * Render the series. Returns SVG markup positioned from (0,0) — the caller
 * wraps it in a <g transform> to place it.
 */
export function navChartSvg(series: NavSeries, o: NavChartOptions): string {
  const { width: w, height: h, uid } = o;
  const padL = 96;            // room for the NAV band labels
  const padR = 16;
  const padT = o.caption ? 34 : 12;
  const padB = 30;            // room for the year labels
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  if (series.points.length < 2) {
    return `<text x="0" y="${(h / 2).toFixed(1)}" font-family="${o.fontFamily}"
                  font-size="20" fill="${o.label}">NAV history unavailable for this scheme.</text>`;
  }

  const t0 = series.points[0].t;
  const t1 = series.points[series.points.length - 1].t;
  const tSpan = Math.max(1, t1 - t0);
  // Pad the value band so the line never sits flat on the frame.
  const vPad = (series.max - series.min) * 0.08 || Math.max(series.max * 0.02, 0.01);
  const vMin = series.min - vPad;
  const vMax = series.max + vPad;
  const vSpan = Math.max(1e-9, vMax - vMin);

  const x = (t: number) => padL + ((t - t0) / tSpan) * plotW;
  const y = (v: number) => padT + plotH - ((v - vMin) / vSpan) * plotH;

  const line = series.points
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.nav).toFixed(1)}`)
    .join(' ');
  const area =
    `${line} L${x(t1).toFixed(1)} ${(padT + plotH).toFixed(1)} ` +
    `L${x(t0).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  // Three gridlines with their real NAV values. Without these a reader cannot
  // tell a 3% rise from a 300% one, because the axis is not zero-based.
  const bands = [0, 0.5, 1].map(f => {
    const v = vMin + vSpan * f;
    const gy = y(v);
    return `
      <line x1="${padL}" y1="${gy.toFixed(1)}" x2="${(padL + plotW).toFixed(1)}" y2="${gy.toFixed(1)}"
            stroke="${o.axis}" stroke-width="1" stroke-dasharray="4 6"/>
      <text x="${(padL - 12).toFixed(1)}" y="${(gy + 6).toFixed(1)}" text-anchor="end"
            font-family="${o.fontFamily}" font-size="17" fill="${o.label}">${fmtNav(v)}</text>`;
  }).join('');

  const lastPt = series.points[series.points.length - 1];

  return `
    <defs>
      <linearGradient id="nav${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${o.fillFrom}" stop-opacity="0.34"/>
        <stop offset="100%" stop-color="${o.fillFrom}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${o.caption
      ? `<text x="0" y="16" font-family="${o.fontFamily}" font-size="20" font-weight="700"
               letter-spacing="1.6" fill="${o.label}">${o.caption}</text>`
      : ''}
    ${bands}
    <path d="${area}" fill="url(#nav${uid})"/>
    <path d="${line}" fill="none" stroke="${o.line}" stroke-width="3"
          stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(lastPt.t).toFixed(1)}" cy="${y(lastPt.nav).toFixed(1)}" r="5" fill="${o.line}"/>
    <text x="${padL}" y="${(padT + plotH + 22).toFixed(1)}"
          font-family="${o.fontFamily}" font-size="17" fill="${o.label}">${fmtYear(t0)}</text>
    <text x="${(padL + plotW).toFixed(1)}" y="${(padT + plotH + 22).toFixed(1)}" text-anchor="end"
          font-family="${o.fontFamily}" font-size="17" fill="${o.label}">${fmtYear(t1)}</text>`;
}
