// Text fitting for rasterised templates.
//
// SVG has no auto-wrap and no shrink-to-fit, so every headline has to be
// measured and broken into <tspan> lines before it goes into the document.
// Measurement uses an offscreen canvas with the same font string the SVG will
// render with, which tracks real glyph widths far better than a characters-per-
// line estimate (finance copy mixes wide numerals with narrow lowercase).

let measureCtx: CanvasRenderingContext2D | null = null;

function ctx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const c = canvas.getContext('2d');
    if (!c) throw new Error('Canvas 2D unavailable — cannot measure text');
    measureCtx = c;
  }
  return measureCtx;
}

function measure(text: string, fontSize: number, family: string, weight: number): number {
  const c = ctx();
  c.font = `${weight} ${fontSize}px ${family}`;
  return c.measureText(text).width;
}

/** Greedy word wrap at a fixed size. Words longer than the box get their own line. */
export function wrap(
  text: string,
  maxWidth: number,
  fontSize: number,
  family: string,
  weight: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, fontSize, family, weight) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface FittedText {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  /** Total rendered height, for callers that stack blocks vertically. */
  height: number;
  /** True when the text had to be truncated to fit maxLines at minimum size. */
  truncated: boolean;
}

export interface FitOptions {
  maxWidth: number;
  maxHeight: number;
  family: string;
  weight: number;
  maxFontSize: number;
  minFontSize: number;
  lineHeightRatio?: number;
  /** Hard cap on lines regardless of available height. */
  maxLines?: number;
  step?: number;
}

/**
 * Shrink-to-fit: step the font size down until the wrapped text fits the box.
 * If it still overflows at the minimum size the last line is ellipsised, so a
 * pathological input degrades to a clipped-but-clean poster rather than text
 * spilling over the artwork.
 */
export function fitText(text: string, opts: FitOptions): FittedText {
  const {
    maxWidth, maxHeight, family, weight,
    maxFontSize, minFontSize,
    lineHeightRatio = 1.18,
    maxLines = Infinity,
    step = 2,
  } = opts;

  let best: FittedText | null = null;

  for (let size = maxFontSize; size >= minFontSize; size -= step) {
    const lines = wrap(text, maxWidth, size, family, weight);
    const lineHeight = size * lineHeightRatio;
    const height = lines.length * lineHeight;

    if (lines.length <= maxLines && height <= maxHeight) {
      return { lines, fontSize: size, lineHeight, height, truncated: false };
    }
    best = { lines, fontSize: size, lineHeight, height, truncated: true };
  }

  // Still too long at the smallest size — clip and ellipsise.
  const size = minFontSize;
  const lineHeight = size * lineHeightRatio;
  const allowed = Math.max(1, Math.min(maxLines, Math.floor(maxHeight / lineHeight)));
  const lines = (best?.lines ?? wrap(text, maxWidth, size, family, weight)).slice(0, allowed);
  if (lines.length) {
    const last = lines[lines.length - 1].replace(/[\s.,;:]+$/, '');
    lines[lines.length - 1] = `${last}…`;
  }
  return { lines, fontSize: size, lineHeight, height: lines.length * lineHeight, truncated: true };
}

/**
 * Render fitted text as <tspan> lines.
 * `y` is the baseline of the first line; `anchor` maps to text-anchor.
 */
export function tspans(
  fitted: FittedText,
  x: number,
  y: number,
  escape: (s: string) => string,
): string {
  return fitted.lines
    .map((line, i) => `<tspan x="${x}" y="${(y + i * fitted.lineHeight).toFixed(1)}">${escape(line)}</tspan>`)
    .join('');
}
