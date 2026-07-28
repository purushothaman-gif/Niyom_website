// NIYOM brand tokens for generated marketing assets.
//
// These mirror the live CRM theme (src/theme/tokens.css) so anything this module
// exports looks like the same company as the product. Values are duplicated
// rather than read from CSS on purpose: assets are rasterised at fixed export
// sizes, independent of whatever theme the admin happens to be viewing in.

export const BRAND = {
  gold:      '#c8a45d',
  goldSoft:  '#d8bd86',
  goldDeep:  '#b8934a',
  goldDeeper:'#9a7938',
  navy:      '#071524',
  navyLift:  '#0e2337',
  ink:       '#1b2430',
  porcelain: '#f6f8fc',
  cream:     '#f3ece0',
  white:     '#ffffff',
  muted:     '#8ea0b5',
} as const;

export interface Palette {
  id: string;
  /** Two-stop background gradient. */
  bgFrom: string;
  bgTo: string;
  /** Foreground text. */
  heading: string;
  body: string;
  /** Accent used for the eyebrow, rules and icon strokes. */
  accent: string;
  /** Colour of the footer/disclaimer line. */
  footer: string;
  /** Fill behind the logo lockup + category chip. */
  chipBg: string;
  chipText: string;
}

export const PALETTES: Record<string, Palette> = {
  // Flagship: deep navy with gold. Reads as premium, prints well on feeds.
  midnightGold: {
    id: 'midnightGold',
    bgFrom: BRAND.navy, bgTo: BRAND.navyLift,
    heading: BRAND.white, body: '#c9d6e4',
    accent: BRAND.gold, footer: '#7f93a9',
    chipBg: 'rgba(200,164,93,0.16)', chipText: BRAND.goldSoft,
  },
  // Light counterpart for variety in a feed — same family, inverted.
  porcelainInk: {
    id: 'porcelainInk',
    bgFrom: BRAND.porcelain, bgTo: '#e9eef6',
    heading: BRAND.ink, body: '#41505f',
    accent: BRAND.goldDeep, footer: '#7b8794',
    chipBg: 'rgba(184,147,74,0.14)', chipText: BRAND.goldDeeper,
  },
  // Warm editorial tone for quotes / "did you know" formats.
  creamGold: {
    id: 'creamGold',
    bgFrom: BRAND.cream, bgTo: '#e7dbc7',
    heading: '#2b2418', body: '#4f4536',
    accent: BRAND.goldDeeper, footer: '#8a7c66',
    chipBg: 'rgba(154,121,56,0.16)', chipText: '#6d551f',
  },
  // High-contrast gold-forward panel for single-stat highlights.
  goldOnNavyBold: {
    id: 'goldOnNavyBold',
    bgFrom: '#04101c', bgTo: '#123049',
    heading: BRAND.goldSoft, body: '#d5e2ee',
    accent: BRAND.gold, footer: '#7f93a9',
    chipBg: 'rgba(216,189,134,0.18)', chipText: BRAND.goldSoft,
  },
};

/**
 * Font stack for rasterised assets.
 *
 * IMPORTANT: an SVG rasterised through an <img> element cannot fetch external
 * resources — no webfont referenced by URL will load, and the browser silently
 * falls back instead of erroring. So we only ever name fonts that ship with the
 * host OS. Inter/Helvetica/Segoe/Roboto covers macOS, Windows, Android and most
 * Linux; Georgia covers the serif accent everywhere.
 *
 * If a bespoke brand face is ever required, it must be embedded as a base64
 * @font-face inside the SVG <defs>, not linked.
 */
export const FONT_SANS =
  "Inter, 'Helvetica Neue', Helvetica, 'Segoe UI', Roboto, Arial, sans-serif";
export const FONT_SERIF = "Georgia, 'Times New Roman', serif";

export const BRAND_NAME = 'NIYOM WEALTH';
export const BRAND_TAGLINE = 'niyomwealth.com';

/**
 * Logo as an inline vector so it never taints the canvas.
 *
 * Loading /niyomlogo.png into the SVG would either fail (relative URL inside a
 * data-URI document) or taint the canvas and make toBlob() throw. A drawn mark
 * sidesteps both. Returns SVG markup positioned at (x, y).
 */
export function logoLockup(x: number, y: number, scale: number, palette: Palette): string {
  const s = (n: number) => (n * scale).toFixed(2);
  return `
    <g transform="translate(${x},${y})">
      <path d="M0 ${s(30)} L0 ${s(4)} L${s(6)} ${s(4)} L${s(20)} ${s(22)} L${s(20)} ${s(4)} L${s(26)} ${s(4)} L${s(26)} ${s(30)} L${s(20)} ${s(30)} L${s(6)} ${s(12)} L${s(6)} ${s(30)} Z"
            fill="${palette.accent}"/>
      <text x="${s(36)}" y="${s(18)}" font-family="${FONT_SANS}" font-size="${s(15)}"
            font-weight="700" letter-spacing="${s(1.6)}" fill="${palette.heading}">${BRAND_NAME}</text>
      <text x="${s(36)}" y="${s(29)}" font-family="${FONT_SANS}" font-size="${s(10)}"
            letter-spacing="${s(0.8)}" fill="${palette.footer}">${BRAND_TAGLINE}</text>
    </g>`;
}

/** XML-escape user/AI text before it goes into SVG markup. */
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
