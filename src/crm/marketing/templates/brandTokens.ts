// NIYOM brand tokens for generated marketing assets.
//
// These mirror the live CRM theme (src/theme/tokens.css) so anything this module
// exports looks like the same company as the product. Values are duplicated
// rather than read from CSS on purpose: assets are rasterised at fixed export
// sizes, independent of whatever theme the admin happens to be viewing in.

import { NIYOM_LOGO_DATA_URI } from './brandLogo';

export { NIYOM_LOGO_DATA_URI };

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

  // ---------------------------------------------------------------------
  // Colourways beyond the house navy/gold.
  //
  // Four palettes from one hue family made every post look like the last
  // one — in a feed that reads as repetition rather than consistency. These
  // widen the range while keeping the same construction: a deep saturated
  // ground, one confident accent, and enough contrast that white or near-
  // white type sits cleanly on top. Brand recognition rides on the emblem
  // and the typography, which do not change.
  // ---------------------------------------------------------------------

  tealDeep: {
    id: 'tealDeep',
    bgFrom: '#062a2e', bgTo: '#0c3f45',
    heading: '#f2fbfa', body: '#b7d8d8',
    accent: '#4fd1c5', footer: '#6f9d9d',
    chipBg: 'rgba(79,209,197,0.18)', chipText: '#8fe4da',
  },
  plumRich: {
    id: 'plumRich',
    bgFrom: '#2a0f2e', bgTo: '#431a45',
    heading: '#fdf3fb', body: '#dcc0da',
    accent: '#e26fb0', footer: '#a077a0',
    chipBg: 'rgba(226,111,176,0.18)', chipText: '#f3a5cf',
  },
  forestCalm: {
    id: 'forestCalm',
    bgFrom: '#0d2818', bgTo: '#153a24',
    heading: '#f2fbf4', body: '#bcd8c4',
    accent: '#7bc96f', footer: '#7d9d85',
    chipBg: 'rgba(123,201,111,0.18)', chipText: '#a5dd9c',
  },
  sunsetWarm: {
    id: 'sunsetWarm',
    bgFrom: '#331408', bgTo: '#5a2410',
    heading: '#fff6ef', body: '#e8c6b0',
    accent: '#ff9f5a', footer: '#b0846a',
    chipBg: 'rgba(255,159,90,0.18)', chipText: '#ffc194',
  },
  indigoNight: {
    id: 'indigoNight',
    bgFrom: '#141a3d', bgTo: '#232c5e',
    heading: '#f3f4ff', body: '#c2c7ea',
    accent: '#8b93f8', footer: '#8086ad',
    chipBg: 'rgba(139,147,248,0.18)', chipText: '#b0b6fb',
  },
  sandWarm: {
    id: 'sandWarm',
    bgFrom: '#f5ede1', bgTo: '#e8dac6',
    heading: '#3a2c1c', body: '#6b5940',
    accent: '#c1663a', footer: '#9c876d',
    chipBg: 'rgba(193,102,58,0.16)', chipText: '#a9542e',
  },
  slateMint: {
    id: 'slateMint',
    bgFrom: '#f4f7f6', bgTo: '#e3ebe8',
    heading: '#16302a', body: '#41564f',
    accent: '#0f8f79', footer: '#7c918b',
    chipBg: 'rgba(15,143,121,0.14)', chipText: '#0c7a67',
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
 * Emblem edge length, in template units (multiplied by the per-format scale).
 *
 * Sized so the wordmark *inside* the emblem stays readable. At the earlier 34
 * it was legible at full export size but turned to mush once a feed scaled a
 * 1080px poster down to phone width. 72 is ~7% of the canvas edge, which is
 * the range a social footer logo needs to stay recognisable after downscaling.
 *
 * Shared with the template footer so the reserved band and the emblem can't
 * drift apart.
 */
export const LOGO_EMBLEM = 72;

/**
 * Whether a palette sits on a dark ground.
 *
 * Decides the emblem's backing treatment: the emblem is a black disc, and on
 * the dark palettes (8 of the 11) a black disc on a dark ground all but
 * disappears. Standard relative-luminance weights over bgFrom.
 */
export function isDarkPalette(palette: Palette): boolean {
  const hex = palette.bgFrom.replace('#', '');
  const n = parseInt(hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex, 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 128;
}

/**
 * Backing that lifts the emblem off a dark ground: a soft radial halo plus a
 * thin accent ring tracing the disc's edge. On light grounds the black disc
 * already carries its own contrast, so only a whisper of ring is added.
 * Coordinates are the emblem's centre.
 */
export function emblemBacking(cx: number, cy: number, radius: number, palette: Palette, uid: string): string {
  const dark = isDarkPalette(palette);
  const x = cx.toFixed(1);
  const y = cy.toFixed(1);

  const halo = dark
    ? `<defs>
         <radialGradient id="${uid}halo" cx="0.5" cy="0.5" r="0.5">
           <stop offset="55%" stop-color="${palette.accent}" stop-opacity="0.34"/>
           <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0"/>
         </radialGradient>
       </defs>
       <circle cx="${x}" cy="${y}" r="${(radius * 1.55).toFixed(1)}" fill="url(#${uid}halo)"/>`
    : '';

  return `${halo}
    <circle cx="${x}" cy="${y}" r="${(radius + 1.5).toFixed(1)}"
            fill="none" stroke="${palette.accent}" stroke-width="${(dark ? 2.4 : 1.4).toFixed(1)}"
            opacity="${dark ? 0.9 : 0.5}"/>`;
}

/**
 * Brand lockup: the real NIYOM emblem plus the site line.
 *
 * The emblem is embedded as a data URI (see brandLogo.ts for why a file path
 * cannot work here). It already contains the "NIYOM WEALTH" wordmark, so the
 * lockup deliberately does not repeat it as text — only the domain sits
 * alongside, vertically centred against the emblem.
 *
 * (x, y) is the top-left of the emblem. Returns SVG markup.
 */
export function logoLockup(x: number, y: number, scale: number, palette: Palette): string {
  const size = LOGO_EMBLEM * scale;
  const gap = 14 * scale;
  const tagSize = 15 * scale;
  return `
    <g transform="translate(${x},${y})">
      ${emblemBacking(size / 2, size / 2, size / 2, palette, `lk${Math.round(x)}`)}
      <image href="${NIYOM_LOGO_DATA_URI}" x="0" y="0"
             width="${size.toFixed(2)}" height="${size.toFixed(2)}"
             preserveAspectRatio="xMidYMid meet"/>
      <text x="${(size + gap).toFixed(2)}" y="${(size / 2 + tagSize * 0.36).toFixed(2)}"
            font-family="${FONT_SANS}" font-size="${tagSize.toFixed(2)}"
            letter-spacing="${(0.8 * scale).toFixed(2)}"
            fill="${palette.footer}">${BRAND_TAGLINE}</text>
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
