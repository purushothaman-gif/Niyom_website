// Client-shareable fund factsheet, rendered as a PNG.
//
// An employee researching a fund can hand the client a single image carrying
// the scheme's own numbers. It is a factual sheet, not marketing: every figure
// comes straight from the curated catalog row, nothing is selected or framed to
// flatter, and the regulatory lines below are not optional decoration.
//
// COMPLIANCE — read before changing anything in this file.
// This artefact shows past performance to a retail investor on behalf of an
// AMFI-registered distributor. Two lines are therefore mandatory on every
// sheet: the market-risk warning and the past-performance caveat. They are
// rendered from constants, drawn last so nothing can overlap them, and sized
// to stay legible when the image is viewed on a phone. Do not make them
// conditional, do not shrink them to win layout space, and do not add language
// that reads as advice, assurance or a recommendation to buy — a distributor
// may inform, not advise.
//
// Renders through the same SVG -> PNG rasteriser as the marketing posters, so
// font handling and the canvas-tainting rules are identical (see
// TemplateRenderer.rasterise and brandLogo for why the emblem is a data URI).

import type { CatalogFund, CatalogNavPoint } from '../../../portal/types/funds';
import {
  BRAND, FONT_SANS, NIYOM_LOGO_DATA_URI, esc,
} from '../templates/brandTokens';
import { rasterise } from '../templates/TemplateRenderer';
import { buildNavSeries, navChartSvg, type NavRange } from './navChart';

/** Mandatory on every sheet. See the compliance note above. */
export const MARKET_RISK_LINE =
  'Mutual Fund investments are subject to market risks. Read all scheme related documents carefully.';
export const PAST_PERFORMANCE_LINE =
  'Past performance is not indicative of future returns and may or may not be sustained.';

export const FACTSHEET_W = 1080;
export const FACTSHEET_H = 1620;

const INK = '#0b1a2b';
const INK_SOFT = '#4a5a6b';
const SURFACE = '#ffffff';
const LINE = '#dfe6ee';
const POSITIVE = '#1a7f5a';
const NEGATIVE = '#b4342a';

function fmtPct(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function pctColour(v: number | null): string {
  if (v === null || v === undefined || Number.isNaN(v)) return INK_SOFT;
  return v < 0 ? NEGATIVE : POSITIVE;
}

function fmtNav(v: number | null): string {
  return v === null || v === undefined ? '—' : `₹${v.toFixed(2)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtAmount(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return `₹${v.toLocaleString('en-IN')}`;
}

/** Wrap by measured width using an offscreen canvas, mirroring textFit. */
function wrap(text: string, maxWidth: number, fontSize: number, weight: number): string[] {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return [text];
  ctx.font = `${weight} ${fontSize}px ${FONT_SANS}`;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

interface Row { label: string; value: string; colour?: string; strong?: boolean }

export function composeFactsheetSvg(
  fund: CatalogFund,
  history: CatalogNavPoint[] = [],
  range: NavRange = '5Y',
): string {
  const W = FACTSHEET_W;
  const H = FACTSHEET_H;
  const M = 76;                       // page margin
  const contentW = W - M * 2;

  // --- header ---------------------------------------------------------------
  const nameSize = 54;
  const nameLines = wrap(fund.name, contentW - 40, nameSize, 800).slice(0, 3);
  const headerH = 236 + nameLines.length * (nameSize * 1.14);

  // --- returns --------------------------------------------------------------
  // Fixed order, always all six periods, blanks shown as em dash. Rendering
  // only the periods that happen to have data would let the sheet flatter a
  // fund by omission.
  const periods: { key: keyof CatalogFund['returns']; label: string }[] = [
    { key: '6M', label: '6 Months' },
    { key: '1Y', label: '1 Year' },
    { key: '3Y', label: '3 Years' },
    { key: '5Y', label: '5 Years' },
    { key: 'SI', label: 'Since Launch' },
  ];

  const retTop = headerH + 54;
  const colW = contentW / periods.length;
  const returnCells = periods.map((p, i) => {
    const v = fund.returns[p.key];
    const cx = M + colW * i + colW / 2;
    return `
      <text x="${cx.toFixed(1)}" y="${(retTop + 96).toFixed(1)}" text-anchor="middle"
            font-family="${FONT_SANS}" font-size="40" font-weight="800"
            fill="${pctColour(v)}">${esc(fmtPct(v))}</text>
      <text x="${cx.toFixed(1)}" y="${(retTop + 136).toFixed(1)}" text-anchor="middle"
            font-family="${FONT_SANS}" font-size="21" font-weight="500"
            fill="${INK_SOFT}">${esc(p.label)}</text>`;
  }).join('');

  const dividers = periods.slice(1).map((_, i) => {
    const x = M + colW * (i + 1);
    return `<line x1="${x.toFixed(1)}" y1="${(retTop + 44).toFixed(1)}"
                  x2="${x.toFixed(1)}" y2="${(retTop + 152).toFixed(1)}"
                  stroke="${LINE}" stroke-width="1.5"/>`;
  }).join('');

  // --- NAV chart ------------------------------------------------------------
  // Placed directly under the trailing returns: the numbers state what happened,
  // the curve shows how. Omitted entirely when history is unavailable rather
  // than drawn empty, and the rows below close the gap.
  const series = buildNavSeries(history, range);
  const hasChart = series.points.length >= 2;
  const chartTop = retTop + 200;
  const chartH = 292;
  const rangeLabel =
    range === 'ALL' ? 'since launch' : `last ${range.replace('Y', '')} years`;

  const chartSvg = hasChart
    ? `<g transform="translate(${M},${chartTop})">${navChartSvg(series, {
        width: contentW,
        height: chartH,
        uid: 'fs',
        line: BRAND.navy,
        fillFrom: BRAND.navy,
        axis: LINE,
        label: INK_SOFT,
        caption: `NAV MOVEMENT · ${rangeLabel.toUpperCase()}`,
        fontFamily: FONT_SANS,
      })}</g>`
    : '';

  // --- detail rows ----------------------------------------------------------
  const rows: Row[] = [
    { label: 'NAV', value: `${fmtNav(fund.nav)}  ·  ${fmtDate(fund.navDate)}`, strong: true },
    { label: 'Category', value: `${fund.category}${fund.subCategory ? ` · ${fund.subCategory}` : ''}` },
    { label: 'Risk', value: fund.risk ?? 'See scheme documents' },
    { label: 'Minimum investment', value: fmtAmount(fund.minInvestment) },
    { label: 'Launched', value: fmtDate(fund.launchDate) },
  ];

  const rowsTop = hasChart ? chartTop + chartH + 44 : retTop + 206;
  const rowH = 74;
  const rowSvg = rows.map((r, i) => {
    const y = rowsTop + i * rowH;
    return `
      <text x="${M}" y="${(y + 42).toFixed(1)}" font-family="${FONT_SANS}" font-size="25"
            font-weight="500" fill="${INK_SOFT}">${esc(r.label)}</text>
      <text x="${W - M}" y="${(y + 42).toFixed(1)}" text-anchor="end" font-family="${FONT_SANS}"
            font-size="${r.strong ? 29 : 26}" font-weight="${r.strong ? 700 : 600}"
            fill="${r.colour ?? INK}">${esc(r.value)}</text>
      ${i < rows.length - 1
        ? `<line x1="${M}" y1="${(y + rowH - 2).toFixed(1)}" x2="${W - M}" y2="${(y + rowH - 2).toFixed(1)}"
                 stroke="${LINE}" stroke-width="1.5"/>`
        : ''}`;
  }).join('');

  // --- compliance block -----------------------------------------------------
  // Drawn last and anchored to the page bottom so no amount of long content
  // above can push it off or overlap it.
  const discSize = 19;
  const riskLines = wrap(MARKET_RISK_LINE, contentW, discSize, 600);
  const pastLines = wrap(PAST_PERFORMANCE_LINE, contentW, discSize, 400);
  const discLineH = discSize * 1.4;
  const discH = (riskLines.length + pastLines.length) * discLineH + 26;
  const discTop = H - M - discH;

  const discSvg = [
    ...riskLines.map((l, i) => `<text x="${M}" y="${(discTop + 24 + i * discLineH).toFixed(1)}"
        font-family="${FONT_SANS}" font-size="${discSize}" font-weight="600"
        fill="${INK}">${esc(l)}</text>`),
    ...pastLines.map((l, i) => `<text x="${M}" y="${(discTop + 24 + (riskLines.length + i) * discLineH + 8).toFixed(1)}"
        font-family="${FONT_SANS}" font-size="${discSize}" font-weight="400"
        fill="${INK_SOFT}">${esc(l)}</text>`),
  ].join('');

  // --- brand footer ---------------------------------------------------------
  const emblem = 62;
  const brandY = discTop - 96;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="hdr" x1="0" y1="0" x2="0.7" y2="1">
        <stop offset="0%" stop-color="${BRAND.navy}"/>
        <stop offset="100%" stop-color="${BRAND.navyLift}"/>
      </linearGradient>
    </defs>

    <rect width="${W}" height="${H}" fill="${SURFACE}"/>
    <rect width="${W}" height="${headerH}" fill="url(#hdr)"/>

    <text x="${M}" y="96" font-family="${FONT_SANS}" font-size="22" font-weight="700"
          letter-spacing="3.4" fill="${BRAND.gold}">FUND FACTSHEET</text>

    ${nameLines.map((l, i) => `
      <text x="${M}" y="${(168 + i * nameSize * 1.14).toFixed(1)}" font-family="${FONT_SANS}"
            font-size="${nameSize}" font-weight="800" fill="#ffffff">${esc(l)}</text>`).join('')}

    <text x="${M}" y="${(headerH - 48).toFixed(1)}" font-family="${FONT_SANS}" font-size="26"
          font-weight="500" fill="#c9d6e4">${esc(fund.amc || '')}</text>

    <text x="${M}" y="${(retTop + 20).toFixed(1)}" font-family="${FONT_SANS}" font-size="22"
          font-weight="700" letter-spacing="2.4" fill="${INK_SOFT}">TRAILING RETURNS</text>
    <text x="${W - M}" y="${(retTop + 20).toFixed(1)}" text-anchor="end" font-family="${FONT_SANS}"
          font-size="19" font-weight="500" fill="${INK_SOFT}">Annualised beyond 1 year (CAGR)</text>
    ${dividers}
    ${returnCells}

    ${chartSvg}
    ${rowSvg}

    <line x1="${M}" y1="${(brandY - 34).toFixed(1)}" x2="${W - M}" y2="${(brandY - 34).toFixed(1)}"
          stroke="${LINE}" stroke-width="1.5"/>
    <image href="${NIYOM_LOGO_DATA_URI}" x="${M}" y="${brandY.toFixed(1)}"
           width="${emblem}" height="${emblem}" preserveAspectRatio="xMidYMid meet"/>
    <text x="${(M + emblem + 18).toFixed(1)}" y="${(brandY + 26).toFixed(1)}" font-family="${FONT_SANS}"
          font-size="24" font-weight="700" fill="${INK}">NIYOM WEALTH</text>
    <text x="${(M + emblem + 18).toFixed(1)}" y="${(brandY + 54).toFixed(1)}" font-family="${FONT_SANS}"
          font-size="20" font-weight="400" fill="${INK_SOFT}">niyomwealth.com</text>
    <text x="${W - M}" y="${(brandY + 42).toFixed(1)}" text-anchor="end" font-family="${FONT_SANS}"
          font-size="19" font-weight="500" fill="${INK_SOFT}">AMFI-registered Mutual Fund Distributor</text>

    ${discSvg}
  </svg>`;
}

export interface RenderedFactsheet {
  blob: Blob;
  previewUrl: string;
  fileName: string;
}

export async function renderFactsheet(
  fund: CatalogFund,
  history: CatalogNavPoint[] = [],
  range: NavRange = '5Y',
): Promise<RenderedFactsheet> {
  const svg = composeFactsheetSvg(fund, history, range);
  const blob = await rasterise(svg, FACTSHEET_W, FACTSHEET_H);
  const safe = fund.name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 70);
  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    fileName: `NIYOM-${safe || 'fund'}-factsheet.png`,
  };
}

export function downloadFactsheet(sheet: RenderedFactsheet): void {
  const a = document.createElement('a');
  a.href = sheet.previewUrl;
  a.download = sheet.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
