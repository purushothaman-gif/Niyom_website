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
import { Palette, PALETTES, FONT_SANS, FONT_SERIF, esc, logoLockup } from './brandTokens';
import { fitText, tspans } from './textFit';
import { iconForCategory, iconSvg } from './financeIcons';

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

function backdrop(g: Geometry, p: Palette): string {
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
    </defs>
    <rect width="${g.w}" height="${g.h}" fill="url(#bg)"/>
    <rect width="${g.w}" height="${g.h}" fill="url(#wash)"/>`;
}

function footer(g: Geometry, p: Palette, disclaimer: string): string {
  const y = g.h - g.margin;
  const logoScale = g.scale * 1.05;
  return `
    ${logoLockup(g.margin, y - 34 * logoScale, logoScale, p)}
    <text x="${g.w - g.margin}" y="${y - 6 * g.scale}" text-anchor="end"
          font-family="${FONT_SANS}" font-size="${(16 * g.scale).toFixed(1)}"
          fill="${p.footer}">${esc(disclaimer)}</text>`;
}

function eyebrow(g: Geometry, p: Palette, text: string, y: number): string {
  const size = 20 * g.scale;
  const padX = 18 * g.scale;
  const padY = 11 * g.scale;
  // Approximate chip width from the letter-spaced caps label.
  const chipW = text.length * size * 0.72 + padX * 2;
  return `
    <g>
      <rect x="${g.margin}" y="${y}" rx="${(size * 0.9).toFixed(1)}"
            width="${chipW.toFixed(1)}" height="${(size + padY * 2).toFixed(1)}"
            fill="${p.chipBg}"/>
      <text x="${g.margin + padX}" y="${(y + padY + size * 0.78).toFixed(1)}"
            font-family="${FONT_SANS}" font-size="${size.toFixed(1)}" font-weight="600"
            letter-spacing="${(1.8 * g.scale).toFixed(2)}"
            fill="${p.chipText}">${esc(text.toUpperCase())}</text>
    </g>`;
}

function ctaLine(g: Geometry, p: Palette, cta: string, y: number): string {
  if (!cta) return '';
  const size = 22 * g.scale;
  return `
    <g>
      <rect x="${g.margin}" y="${y}" width="${(52 * g.scale).toFixed(1)}" height="${(3 * g.scale).toFixed(1)}"
            fill="${p.accent}"/>
      <text x="${g.margin}" y="${(y + 34 * g.scale).toFixed(1)}"
            font-family="${FONT_SANS}" font-size="${size.toFixed(1)}" font-weight="500"
            fill="${p.body}">${esc(cta)}</text>
    </g>`;
}

function wrapDoc(g: Geometry, inner: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${g.w}" height="${g.h}" viewBox="0 0 ${g.w} ${g.h}">${inner}</svg>`;
}

const FOOTER_BAND = 96;
const CTA_BLOCK = 70;

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
    const footerH = 96 * g.scale;
    const ctaH = input.cta ? 70 * g.scale : 0;
    const bodyH = bodyText ? (g.isWide ? 96 : 150) * g.scale : 0;
    const headMax = g.h - headTop - bodyH - ctaH - footerH - g.margin;

    const head = fitText(heading, {
      maxWidth: g.contentW * (g.isWide ? 0.72 : 1),
      maxHeight: headMax,
      family: FONT_SANS, weight: 800,
      maxFontSize: (g.isWide ? 74 : g.isTall ? 104 : 92) * g.scale,
      minFontSize: 34 * g.scale,
      lineHeightRatio: 1.1,
      maxLines: g.isWide ? 3 : 5,
    });

    const body = bodyText
      ? fitText(bodyText, {
          maxWidth: g.contentW * (g.isWide ? 0.66 : 0.94),
          maxHeight: bodyH,
          family: FONT_SANS, weight: 400,
          maxFontSize: 30 * g.scale, minFontSize: 19 * g.scale,
          lineHeightRatio: 1.4, maxLines: g.isWide ? 2 : 4,
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

    const icon = iconForCategory(input.category);
    const iconSize = 108 * g.scale;
    const iconMark = g.isWide
      ? iconSvg(icon, g.w - g.margin - iconSize, g.margin + 20 * g.scale, iconSize, p.accent, 1.5)
      : iconSvg(icon, g.w - g.margin - iconSize, g.margin - 4 * g.scale, iconSize, p.accent, 1.5);

    const slideBadge = input.slide
      ? `<text x="${g.w - g.margin}" y="${(g.h - g.margin - 46 * g.scale).toFixed(1)}" text-anchor="end"
               font-family="${FONT_SANS}" font-size="${(18 * g.scale).toFixed(1)}" font-weight="600"
               fill="${p.footer}">${input.slide.index}/${input.slide.total}</text>`
      : '';

    return wrapDoc(g, `
      ${backdrop(g, p)}
      ${iconMark}
      ${eyebrow(g, p, input.category, topY)}
      <text font-family="${FONT_SANS}" font-size="${head.fontSize.toFixed(1)}" font-weight="800"
            fill="${p.heading}" letter-spacing="${(-0.5 * g.scale).toFixed(2)}">
        ${tspans(head, g.margin, headBaseline, esc)}
      </text>
      ${body ? `<text font-family="${FONT_SANS}" font-size="${body.fontSize.toFixed(1)}" font-weight="400" fill="${p.body}">
        ${tspans(body, g.margin, bodyTop + body.fontSize * 0.8, esc)}
      </text>` : ''}
      ${ctaLine(g, p, input.cta, ctaY)}
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
