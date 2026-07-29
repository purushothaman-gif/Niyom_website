// Poster template library.
//
// Each template is a function that composes an SVG document for a given aspect
// ratio from generated copy. Layout is driven by proportional metrics rather
// than fixed pixels so one template serves 1080x1080, 1080x1350, 1080x1920 and
// 1200x628 without a bespoke layout per size.
//
// Design rules that keep output looking designed rather than generated:
//   - one dominant type element per composition (the headline), everything else
//     is deliberately quieter,
//   - a consistent margin grid tied to the short edge,
//   - restrained ornament: a single accent rule, a soft radial wash, one icon,
//   - the brand lockup and the educational disclaimer are non-negotiable
//     furniture on every asset.

import { ASPECT_VARIANTS } from '../marketingConstants';
import { AspectVariant } from '../marketingTypes';
import {
  Palette, PALETTES, FONT_SANS, FONT_SERIF, esc, logoLockup, LOGO_EMBLEM, isDarkPalette,
} from './brandTokens';
import { accentTspans, fitText, tspans } from './textFit';
import { iconForCategory, iconSvg } from './financeIcons';
import { art, artForCategory } from './financeArt';

export interface RenderInput {
  variant: AspectVariant;
  palette: Palette;
  category: string;
  headline: string;
  body: string;
  cta: string;
  /** Carousel/infographic slide, when rendering a multi-slide deck. */
  slide?: { heading: string; body: string; index: number; total: number };
  disclaimer: string;
}

export interface TemplateSpec {
  id: string;
  name: string;
  /** Templates suited to a slide deck rather than a single statement. */
  supportsSlides: boolean;
  defaultPalette: keyof typeof PALETTES;
  render: (input: RenderInput) => string;
}

// --- shared furniture ------------------------------------------------------

interface Geometry {
  w: number; h: number;
  margin: number;
  contentW: number;
  isWide: boolean;
  isTall: boolean;
  scale: number;
}

function geometry(variant: AspectVariant): Geometry {
  const { width: w, height: h } = ASPECT_VARIANTS[variant];
  const short = Math.min(w, h);
  const margin = Math.round(short * 0.085);
  return {
    w, h, margin,
    contentW: w - margin * 2,
    isWide: w / h > 1.4,
    isTall: h / w > 1.5,
    scale: short / 1080,
  };
}

/**
 * Background: gradient, corner wash, and a layer of quiet geometry.
 *
 * The geometry is the difference between "a poster" and "text on a coloured
 * rectangle". It stays under 10% opacity and well clear of the type — the job
 * is to give the eye something to land on in the empty regions, not to compete
 * with the headline. `seed` varies which arrangement appears so a feed of posts
 * does not repeat one background.
 */
function backdrop(g: Geometry, p: Palette, seed = 0): string {
  const dots: string[] = [];
  const step = 26 * g.scale;
  const cols = Math.ceil(g.w / step);
  const rows = Math.ceil(g.h / step);
  // Dot field in one corner, alternating side by seed.
  const fromRight = seed % 2 === 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = fromRight ? g.w - c * step - step * 0.5 : c * step + step * 0.5;
      const y = g.h - r * step - step * 0.5;
      // Triangular falloff so the field fades out rather than ending abruptly.
      if (r + c > 7) continue;
      const o = (0.16 * (8 - (r + c))) / 8;
      dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2.6 * g.scale).toFixed(1)}"
        fill="${p.accent}" opacity="${o.toFixed(3)}"/>`);
    }
  }

  const ringR = Math.min(g.w, g.h) * (seed % 3 === 0 ? 0.52 : 0.4);
  const ringX = seed % 2 === 0 ? g.w * 0.12 : g.w * 0.9;
  const ringY = g.h * (seed % 3 === 1 ? 0.14 : 0.86);

  return `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">
        <stop offset="0%" stop-color="${p.bgFrom}"/>
        <stop offset="100%" stop-color="${p.bgTo}"/>
      </linearGradient>
      <radialGradient id="wash" cx="0.85" cy="0.1" r="0.9">
        <stop offset="0%" stop-color="${p.accent}" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="${p.accent}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="wash2" cx="0.08" cy="0.92" r="0.85">
        <stop offset="0%" stop-color="${p.accent2}" stop-opacity="0.14"/>
        <stop offset="100%" stop-color="${p.accent2}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${g.w}" height="${g.h}" fill="url(#bg)"/>
    <rect width="${g.w}" height="${g.h}" fill="url(#wash)"/>
    <rect width="${g.w}" height="${g.h}" fill="url(#wash2)"/>
    <circle cx="${ringX.toFixed(0)}" cy="${ringY.toFixed(0)}" r="${ringR.toFixed(0)}"
            fill="none" stroke="${p.accent}" stroke-width="${(1.6 * g.scale).toFixed(1)}" opacity="0.09"/>
    <circle cx="${ringX.toFixed(0)}" cy="${ringY.toFixed(0)}" r="${(ringR * 0.66).toFixed(0)}"
            fill="none" stroke="${p.accent}" stroke-width="${(1.6 * g.scale).toFixed(1)}" opacity="0.06"/>
    ${dots.join('')}`;
}

function footer(g: Geometry, p: Palette, disclaimer: string): string {
  const y = g.h - g.margin;
  const emblem = LOGO_EMBLEM * g.scale;
  // Disclaimer sits on the emblem's optical centre line rather than the very
  // bottom edge, so the two read as one band.
  const discSize = 16 * g.scale;
  return `
    ${logoLockup(g.margin, y - emblem, g.scale, p)}
    <text x="${g.w - g.margin}" y="${(y - emblem / 2 + discSize * 0.36).toFixed(1)}" text-anchor="end"
          font-family="${FONT_SANS}" font-size="${discSize.toFixed(1)}"
          fill="${p.footer}">${esc(disclaimer)}</text>`;
}

/**
 * Category chip. Carries the small line mark for its category — a chip with an
 * icon reads as designed where a text-only pill reads as a form field, and it
 * gives the category a visual identity the reader picks up faster than a word.
 */
function eyebrow(g: Geometry, p: Palette, text: string, y: number): string {
  const size = 20 * g.scale;
  const padX = 18 * g.scale;
  const padY = 11 * g.scale;
  const mark = 22 * g.scale;
  const gap = 9 * g.scale;
  const chipH = size + padY * 2;
  // Approximate chip width from the letter-spaced caps label, plus the mark.
  const chipW = text.length * size * 0.72 + padX * 2 + mark + gap;
  return `
    <g>
      <rect x="${g.margin}" y="${y}" rx="${(chipH / 2).toFixed(1)}"
            width="${chipW.toFixed(1)}" height="${chipH.toFixed(1)}"
            fill="${p.chipBg}"/>
      ${iconSvg(iconForCategory(text), g.margin + padX, y + (chipH - mark) / 2, mark, p.chipText, 1.9)}
      <text x="${(g.margin + padX + mark + gap).toFixed(1)}" y="${(y + padY + size * 0.78).toFixed(1)}"
            font-family="${FONT_SANS}" font-size="${size.toFixed(1)}" font-weight="600"
            letter-spacing="${(1.8 * g.scale).toFixed(2)}"
            fill="${p.chipText}">${esc(text.toUpperCase())}</text>
    </g>`;
}

/**
 * Closing call to action, under a short accent rule.
 *
 * Set at a real reading size rather than as a caption. At 22 it sat closer to
 * the disclaimer than to the body copy, which put the one line asking the
 * reader to do something at the bottom of the visual hierarchy.
 */
function ctaLine(g: Geometry, p: Palette, cta: string, y: number, x = g.margin): string {
  if (!cta) return '';
  const size = 29 * g.scale;
  return `
    <g>
      <rect x="${x.toFixed(1)}" y="${y}" width="${(64 * g.scale).toFixed(1)}" height="${(4 * g.scale).toFixed(1)}"
            rx="${(2 * g.scale).toFixed(1)}" fill="${p.accent}"/>
      <text x="${x.toFixed(1)}" y="${(y + 44 * g.scale).toFixed(1)}"
            font-family="${FONT_SANS}" font-size="${size.toFixed(1)}" font-weight="600"
            fill="${p.heading}">${esc(cta)}</text>
    </g>`;
}

function wrapDoc(g: Geometry, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.w}" height="${g.h}" viewBox="0 0 ${g.w} ${g.h}">${inner}</svg>`;
}

/** Inner padding between a content panel's edge and the type inside it. */
const PANEL_PAD = 46;

/**
 * Rounded surface the message sits on, with a solid accent tab down its left
 * edge.
 *
 * This is the structural difference between our output and the fintech
 * marketing it is being measured against: those posts almost always seat the
 * message on a card with a definite edge, rather than floating type over a
 * gradient. The panel gives figure/ground separation, the tab gives a hard
 * colour anchor, and letting the illustration overlap the panel's corner
 * produces depth that a single flat layer cannot.
 *
 * Deliberately low-contrast — it should read as a surface, not as a box drawn
 * around the text.
 */
function contentPanel(
  g: Geometry, p: Palette, x: number, y: number, w: number, h: number, uid: string,
): string {
  const r = 34 * g.scale;
  const tabW = 7 * g.scale;
  const dark = isDarkPalette(p);
  return `
    <defs>
      <!-- White at low alpha on dark grounds lifts the surface; at higher alpha
           on light grounds it reads as a paper card. One colour, two roles. -->
      <linearGradient id="pan${uid}" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="${dark ? 0.07 : 0.62}"/>
        <stop offset="100%" stop-color="#ffffff" stop-opacity="${dark ? 0.02 : 0.28}"/>
      </linearGradient>
    </defs>
    <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"
          rx="${r.toFixed(1)}" fill="url(#pan${uid})"
          stroke="${p.accent}" stroke-opacity="${dark ? 0.22 : 0.18}"
          stroke-width="${(1.6 * g.scale).toFixed(1)}"/>
    <path d="M${(x + r * 0.5).toFixed(1)} ${(y + r * 0.7).toFixed(1)}
             L${(x + r * 0.5).toFixed(1)} ${(y + h - r * 0.7).toFixed(1)}"
          stroke="${p.accent}" stroke-width="${tabW.toFixed(1)}" stroke-linecap="round"/>`;
}

// Vertical space the brand footer occupies: the emblem plus breathing room
// above it, so a centred content stack never crowds the logo.
const FOOTER_BAND = LOGO_EMBLEM + 34;
const CTA_BLOCK = 86;

/**
 * Vertical offset that centres a content stack in the space between the eyebrow
 * and the footer band.
 *
 * Without this the copy top-aligns while the brand lockup stays pinned to the
 * bottom, which leaves a dead void through the middle of the taller formats
 * (1080x1350, 1080x1920) and of short carousel slides. The bias is 0.40 rather
 * than 0.50 for optical centring — a block sitting on the exact mathematical
 * centre reads as slightly low.
 */
function centreOffset(g: Geometry, contentTop: number, blockHeight: number): number {
  const available = g.h - g.margin - FOOTER_BAND * g.scale - contentTop;
  return Math.max(0, (available - blockHeight) * 0.4);
}

// --- templates -------------------------------------------------------------

/** Bold Statement — one oversized headline. The workhorse. */
const boldStatement: TemplateSpec = {
  id: 'bold_statement',
  name: 'Bold Statement',
  supportsSlides: true,
  defaultPalette: 'midnightGold',
  render: input => {
    const g = geometry(input.variant);
    const p = input.palette;
    const heading = input.slide ? input.slide.heading : input.headline;
    const bodyText = input.slide ? input.slide.body : input.body;

    const topY = g.margin;
    const chipH = 42 * g.scale;
    const headTop = topY + chipH + 46 * g.scale;

    // Reserve room for body + CTA + footer, then let the headline own the rest.
    const footerH = FOOTER_BAND * g.scale;
    const ctaH = input.cta ? 70 * g.scale : 0;
    // Generous: the body column is narrow (the illustration owns the right of
    // this band), so the same word count needs more lines than a full-width
    // column would. Too tight here and fitText falls through to ellipsising
    // mid-sentence, which loses content the reader needed.
    const bodyH = bodyText ? (g.isWide ? 130 : 264) * g.scale : 0;
    const headMax = g.h - headTop - bodyH - ctaH - footerH - g.margin;

    const head = fitText(heading, {
      // Panel-inner width, not full content width — the type is inset now.
      maxWidth: (g.contentW - PANEL_PAD * 2 * g.scale) * (g.isWide ? 0.7 : 0.98),
      maxHeight: headMax,
      family: FONT_SANS, weight: 800,
      maxFontSize: (g.isWide ? 74 : g.isTall ? 104 : 92) * g.scale,
      minFontSize: 34 * g.scale,
      lineHeightRatio: 1.1,
      maxLines: g.isWide ? 3 : 5,
    });

    const body = bodyText
      ? fitText(bodyText, {
          // Narrower than the headline on purpose: the art occupies the right
          // of this band, and body copy running under it was unreadable.
          maxWidth: (g.contentW - PANEL_PAD * 2 * g.scale) * (g.isWide ? 0.58 : 0.54),
          maxHeight: bodyH,
          family: FONT_SANS, weight: 400,
          maxFontSize: 40 * g.scale, minFontSize: 21 * g.scale,
          lineHeightRatio: 1.36, maxLines: g.isWide ? 3 : 7,
        })
      : null;

    // Stack headline -> body -> CTA as one block and centre it vertically, so
    // the composition fills the frame instead of hugging the top edge.
    const gapHeadBody = 34 * g.scale;
    const gapBodyCta = 44 * g.scale;
    const blockH = head.height
      + (body ? gapHeadBody + body.height : 0)
      + (input.cta ? gapBodyCta + CTA_BLOCK * g.scale : 0);
    const stackTop = headTop + centreOffset(g, headTop, blockH);

    const headBaseline = stackTop + head.fontSize * 0.86;
    const bodyTop = stackTop + head.height + gapHeadBody;
    const ctaY = bodyTop + (body ? body.height : 0) + gapBodyCta;

    // A real composition rather than a line icon. Sized to read as artwork and
    // parked bottom-right, clear of the left-aligned type stack and above the
    // footer band.
    const artFn = artForCategory(input.category, input.headline);
    const artSize = (g.isWide ? 300 : 400) * g.scale;
    // Anchored to the bottom-right corner rather than centred in the gap: a
    // composition floating mid-frame reads as an afterthought, one sitting
    // into the corner reads as part of the layout. It is allowed to run
    // slightly past the margin so it feels placed rather than boxed.
    const artX = g.w - g.margin - artSize * 0.98;
    const artY = g.h - g.margin - FOOTER_BAND * g.scale - artSize * 0.98;
    const artMark = art(artFn, artX, artY, artSize, p, `bs${g.w}${g.h}`, 0.95);
    // A soft disc of the support hue gives the illustration a seat — art on a
    // shape reads as composed; art floating on the gradient reads as pasted.
    const seatR = artSize * 0.54;
    const seat = `
      <defs>
        <radialGradient id="seat${g.w}" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stop-color="${p.accent2}" stop-opacity="0.2"/>
          <stop offset="78%" stop-color="${p.accent2}" stop-opacity="0.1"/>
          <stop offset="100%" stop-color="${p.accent2}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="${(artX + artSize * 0.5).toFixed(1)}" cy="${(artY + artSize * 0.52).toFixed(1)}"
              r="${seatR.toFixed(1)}" fill="url(#seat${g.w})"/>`;

    const slideBadge = input.slide
      ? `<text x="${g.w - g.margin}" y="${(g.h - g.margin - 46 * g.scale).toFixed(1)}" text-anchor="end"
               font-family="${FONT_SANS}" font-size="${(18 * g.scale).toFixed(1)}" font-weight="600"
               fill="${p.footer}">${input.slide.index}/${input.slide.total}</text>`
      : '';

    // Panel behind the message. Spans the full content width so the
    // illustration overlaps its lower-right corner rather than sitting beside
    // it — that overlap is what gives the composition depth.
    const pad = PANEL_PAD * g.scale;
    const panelX = g.margin;
    const panelY = stackTop - pad;
    const panelW = g.contentW;
    const panelH = blockH + pad * 2;
    const textX = panelX + pad + 14 * g.scale;

    return wrapDoc(g, `
      ${backdrop(g, p, input.headline.length)}
      ${contentPanel(g, p, panelX, panelY, panelW, panelH, `bs${g.w}${g.h}`)}
      ${seat}
      ${artMark}
      ${eyebrow(g, p, input.category, topY)}
      <text font-family="${FONT_SANS}" font-size="${head.fontSize.toFixed(1)}" font-weight="800"
            fill="${p.heading}" letter-spacing="${(-0.5 * g.scale).toFixed(2)}">
        ${accentTspans(head, textX, headBaseline, esc, p.accent)}
      </text>
      ${body ? `<text font-family="${FONT_SANS}" font-size="${body.fontSize.toFixed(1)}" font-weight="400" fill="${p.body}">
        ${tspans(body, textX, bodyTop + body.fontSize * 0.8, esc)}
      </text>` : ''}
      ${ctaLine(g, p, input.cta, ctaY, textX)}
      ${slideBadge}
      ${footer(g, p, input.disclaimer)}
    `);
  },
};

/** Stat Highlight — pulls a leading number out of the headline as the hero. */
const statHighlight: TemplateSpec = {
  id: 'stat_highlight',
  name: 'Stat Highlight',
  supportsSlides: false,
  defaultPalette: 'goldOnNavyBold',
  render: input => {
    const g = geometry(input.variant);
    const p = input.palette;

    // Pull a number/percentage out of the headline to feature; fall back to
    // treating the first two words as the hero if there is no figure.
    const statMatch = input.headline.match(/(₹?\s?\d[\d,.]*\s?(%|x|X|crore|lakh|years?|yrs?)?)/);
    const stat = (statMatch?.[0] ?? input.headline.split(/\s+/).slice(0, 2).join(' ')).trim();
    const rest = statMatch
      ? input.headline.replace(statMatch[0], '').replace(/\s+/g, ' ').trim()
      : input.headline.split(/\s+/).slice(2).join(' ');

    const topY = g.margin;
    const statTop = topY + 42 * g.scale + 54 * g.scale;

    const statFit = fitText(stat, {
      maxWidth: g.contentW,
      maxHeight: (g.isWide ? 170 : 260) * g.scale,
      family: FONT_SANS, weight: 800,
      maxFontSize: (g.isWide ? 150 : 210) * g.scale,
      minFontSize: 60 * g.scale, lineHeightRatio: 1.02, maxLines: 1,
    });

    const restFit = fitText(rest || input.body, {
      maxWidth: g.contentW * (g.isWide ? 0.7 : 1),
      maxHeight: (g.isWide ? 110 : 230) * g.scale,
      family: FONT_SANS, weight: 600,
      maxFontSize: (g.isWide ? 40 : 52) * g.scale,
      minFontSize: 24 * g.scale, lineHeightRatio: 1.18, maxLines: g.isWide ? 2 : 4,
    });

    const bodyFit = !g.isWide && input.body && rest
      ? fitText(input.body, {
          maxWidth: g.contentW * 0.94, maxHeight: 130 * g.scale,
          family: FONT_SANS, weight: 400,
          maxFontSize: 27 * g.scale, minFontSize: 18 * g.scale,
          lineHeightRatio: 1.4, maxLines: 3,
        })
      : null;

    const gapStatRest = 24 * g.scale;
    const gapRestBody = 26 * g.scale;
    const gapBodyCta = 44 * g.scale;
    const blockH = statFit.height + gapStatRest + restFit.height
      + (bodyFit ? gapRestBody + bodyFit.height : 0)
      + (input.cta ? gapBodyCta + CTA_BLOCK * g.scale : 0);
    const stackTop = statTop + centreOffset(g, statTop, blockH);

    const statBaseline = stackTop + statFit.fontSize * 0.84;
    const restTopY = stackTop + statFit.height + gapStatRest;
    const bodyTop = restTopY + restFit.height + gapRestBody;
    const ctaY = bodyTop + (bodyFit ? bodyFit.height : 0) + gapBodyCta;

    return wrapDoc(g, `
      ${backdrop(g, p)}
      ${eyebrow(g, p, input.category, topY)}
      <text font-family="${FONT_SANS}" font-size="${statFit.fontSize.toFixed(1)}" font-weight="800"
            fill="${p.accent}" letter-spacing="${(-2 * g.scale).toFixed(2)}">
        ${tspans(statFit, g.margin, statBaseline, esc)}
      </text>
      <text font-family="${FONT_SANS}" font-size="${restFit.fontSize.toFixed(1)}" font-weight="600" fill="${p.heading}">
        ${tspans(restFit, g.margin, restTopY + restFit.fontSize * 0.84, esc)}
      </text>
      ${bodyFit ? `<text font-family="${FONT_SANS}" font-size="${bodyFit.fontSize.toFixed(1)}" font-weight="400" fill="${p.body}">
        ${tspans(bodyFit, g.margin, bodyTop + bodyFit.fontSize * 0.8, esc)}
      </text>` : ''}
      ${ctaLine(g, p, input.cta, ctaY)}
      ${footer(g, p, input.disclaimer)}
    `);
  },
};

/** Editorial Quote — serif, generous whitespace. For quotes and "did you know". */
const editorialQuote: TemplateSpec = {
  id: 'editorial_quote',
  name: 'Editorial Quote',
  supportsSlides: false,
  defaultPalette: 'creamGold',
  render: input => {
    const g = geometry(input.variant);
    const p = input.palette;

    const markSize = 150 * g.scale;
    const topY = g.margin;
    const quoteTop = topY + 42 * g.scale + markSize * 0.52;

    const quote = fitText(input.headline, {
      maxWidth: g.contentW * (g.isWide ? 0.78 : 0.96),
      maxHeight: (g.isWide ? 200 : 520) * g.scale,
      family: FONT_SERIF, weight: 400,
      maxFontSize: (g.isWide ? 58 : 76) * g.scale,
      minFontSize: 30 * g.scale, lineHeightRatio: 1.26,
      maxLines: g.isWide ? 3 : 6,
    });

    const bodyFit = input.body
      ? fitText(input.body, {
          maxWidth: g.contentW * 0.9,
          maxHeight: (g.isWide ? 80 : 170) * g.scale,
          family: FONT_SANS, weight: 400,
          maxFontSize: 26 * g.scale, minFontSize: 18 * g.scale,
          lineHeightRatio: 1.42, maxLines: g.isWide ? 2 : 4,
        })
      : null;

    const gapQuoteBody = 34 * g.scale;
    const gapBodyCta = 44 * g.scale;
    const blockH = quote.height
      + (bodyFit ? gapQuoteBody + bodyFit.height : 0)
      + (input.cta ? gapBodyCta + CTA_BLOCK * g.scale : 0);
    const stackTop = quoteTop + centreOffset(g, quoteTop, blockH);

    const bodyTop = stackTop + quote.height + gapQuoteBody;
    const ctaY = bodyTop + (bodyFit ? bodyFit.height : 0) + gapBodyCta;

    return wrapDoc(g, `
      ${backdrop(g, p)}
      ${eyebrow(g, p, input.category, topY)}
      <text x="${g.margin - 6 * g.scale}" y="${(stackTop + markSize * 0.12).toFixed(1)}"
            font-family="${FONT_SERIF}" font-size="${markSize.toFixed(1)}"
            fill="${p.accent}" opacity="0.32">&#8220;</text>
      <text font-family="${FONT_SERIF}" font-size="${quote.fontSize.toFixed(1)}" fill="${p.heading}">
        ${tspans(quote, g.margin, stackTop + quote.fontSize * 0.86, esc)}
      </text>
      ${bodyFit ? `<text font-family="${FONT_SANS}" font-size="${bodyFit.fontSize.toFixed(1)}" fill="${p.body}">
        ${tspans(bodyFit, g.margin, bodyTop + bodyFit.fontSize * 0.8, esc)}
      </text>` : ''}
      ${ctaLine(g, p, input.cta, ctaY)}
      ${footer(g, p, input.disclaimer)}
    `);
  },
};

/** Checklist — body split into ticked points. For tips, myths, checklists. */
const checklist: TemplateSpec = {
  id: 'checklist',
  name: 'Listicle / Checklist',
  supportsSlides: true,
  defaultPalette: 'porcelainInk',
  render: input => {
    const g = geometry(input.variant);
    const p = input.palette;
    const heading = input.slide ? input.slide.heading : input.headline;
    const source = input.slide ? input.slide.body : input.body;

    // Split the body into discrete points: explicit bullets/newlines first,
    // else sentences.
    const points = source
      .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])|\s*[•·]\s*/)
      .map(s => s.replace(/^[-–—•\d.)\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, g.isWide ? 3 : 5);

    const topY = g.margin;
    const headTop = topY + 42 * g.scale + 44 * g.scale;

    const head = fitText(heading, {
      maxWidth: g.contentW * (g.isWide ? 0.62 : 0.95),
      maxHeight: (g.isWide ? 130 : 250) * g.scale,
      family: FONT_SANS, weight: 800,
      maxFontSize: (g.isWide ? 56 : 72) * g.scale,
      minFontSize: 30 * g.scale, lineHeightRatio: 1.12,
      maxLines: g.isWide ? 2 : 3,
    });

    const gapHeadList = 40 * g.scale;
    const gapListCta = 40 * g.scale;
    const footerH = FOOTER_BAND * g.scale;
    const ctaH = input.cta ? CTA_BLOCK * g.scale : 0;

    // Rows share whatever space is going, but never stretch past a comfortable
    // maximum — a three-item list should look like a list, not three items
    // marooned in a tall column.
    const listSpace = g.h - (headTop + head.height + gapHeadList) - footerH - ctaH - g.margin;
    const rowH = points.length ? Math.min(listSpace / points.length, 118 * g.scale) : 0;
    const tickSize = 30 * g.scale;

    const blockH = head.height + gapHeadList + rowH * points.length
      + (input.cta ? gapListCta + ctaH : 0);
    const stackTop = headTop + centreOffset(g, headTop, blockH);
    const listTop = stackTop + head.height + gapHeadList;

    const rows = points.map((point, i) => {
      const y = listTop + i * rowH;
      const textFit = fitText(point, {
        maxWidth: g.contentW - tickSize - 26 * g.scale,
        maxHeight: rowH - 14 * g.scale,
        family: FONT_SANS, weight: 500,
        maxFontSize: 29 * g.scale, minFontSize: 17 * g.scale,
        lineHeightRatio: 1.32, maxLines: 2,
      });
      return `
        <g>
          <circle cx="${(g.margin + tickSize / 2).toFixed(1)}" cy="${(y + tickSize / 2).toFixed(1)}"
                  r="${(tickSize / 2).toFixed(1)}" fill="${p.chipBg}"/>
          <path d="M${(g.margin + tickSize * 0.28).toFixed(1)} ${(y + tickSize * 0.52).toFixed(1)}
                   l${(tickSize * 0.16).toFixed(1)} ${(tickSize * 0.17).toFixed(1)}
                   l${(tickSize * 0.29).toFixed(1)} ${(-tickSize * 0.33).toFixed(1)}"
                fill="none" stroke="${p.accent}" stroke-width="${(2.6 * g.scale).toFixed(1)}"
                stroke-linecap="round" stroke-linejoin="round"/>
          <text font-family="${FONT_SANS}" font-size="${textFit.fontSize.toFixed(1)}" font-weight="500" fill="${p.body}">
            ${tspans(textFit, g.margin + tickSize + 22 * g.scale, y + textFit.fontSize * 0.9, esc)}
          </text>
        </g>`;
    }).join('');

    const ctaY = listTop + rowH * points.length + gapListCta;
    const slideBadge = input.slide
      ? `<text x="${g.w - g.margin}" y="${(g.h - g.margin - 46 * g.scale).toFixed(1)}" text-anchor="end"
               font-family="${FONT_SANS}" font-size="${(18 * g.scale).toFixed(1)}" font-weight="600"
               fill="${p.footer}">${input.slide.index}/${input.slide.total}</text>`
      : '';

    return wrapDoc(g, `
      ${backdrop(g, p)}
      ${eyebrow(g, p, input.category, topY)}
      <text font-family="${FONT_SANS}" font-size="${head.fontSize.toFixed(1)}" font-weight="800"
            fill="${p.heading}" letter-spacing="${(-0.4 * g.scale).toFixed(2)}">
        ${tspans(head, g.margin, stackTop + head.fontSize * 0.86, esc)}
      </text>
      ${rows}
      ${ctaLine(g, p, input.cta, ctaY)}
      ${slideBadge}
      ${footer(g, p, input.disclaimer)}
    `);
  },
};

export const TEMPLATES: TemplateSpec[] = [boldStatement, statHighlight, editorialQuote, checklist];

export function getTemplate(id: string): TemplateSpec {
  return TEMPLATES.find(t => t.id === id) ?? boldStatement;
}

/** Sensible default template for a category + content type. */
export function suggestTemplate(category: string, contentType: string): TemplateSpec {
  if (contentType === 'carousel' || contentType === 'infographic') return checklist;
  if (/Quote|Did You Know|Myth|Fact/i.test(category)) return editorialQuote;
  if (/Checklist|Template|Guide|Mistake|FAQ|Quiz/i.test(category)) return checklist;
  if (/Compounding|Inflation|Return|Comparison/i.test(category)) return statHighlight;
  return boldStatement;
}
