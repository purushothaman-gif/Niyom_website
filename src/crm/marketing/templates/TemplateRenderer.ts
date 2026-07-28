// SVG -> PNG rasterisation pipeline.
//
// Composition happens in SVG (easy to lay out, resolution independent), then a
// single draw to a canvas at exact export dimensions produces the PNG that gets
// uploaded.
//
// Two constraints shape this file, both learned the hard way:
//   1. An SVG loaded into an <img> is an isolated document — it cannot fetch
//      anything. External fonts and images silently do not load. So templates
//      use OS-resident font stacks and an inline vector logo (see brandTokens).
//   2. Drawing an image that came from another origin taints the canvas and
//      makes toBlob() throw. Everything is inlined, so the canvas stays clean.

import { ASPECT_VARIANTS, DISCLAIMER_TEXT } from '../marketingConstants';
import { AspectVariant, MktDraft } from '../marketingTypes';
import { PALETTES, Palette } from './brandTokens';
import { getTemplate, RenderInput } from './templateSpecs';

export interface RenderRequest {
  draft: Pick<MktDraft, 'headline' | 'body' | 'cta'> & { slides?: MktDraft['slides'] };
  category: string;
  templateId: string;
  paletteId: string;
  variant: AspectVariant;
  /** 1-based slide to render; omit for the single-composition asset. */
  slideIndex?: number;
}

export interface RenderedAsset {
  variant: string;
  blob: Blob;
  width: number;
  height: number;
  /** Object URL for preview. Caller must revoke it when done. */
  previewUrl: string;
}

export function paletteFor(id: string): Palette {
  return PALETTES[id] ?? PALETTES.midnightGold;
}

/** Compose the SVG document for one asset. Exported for preview + tests. */
export function composeSvg(req: RenderRequest): string {
  const template = getTemplate(req.templateId);
  const palette = paletteFor(req.paletteId);

  const slides = req.draft.slides ?? null;
  const slide =
    req.slideIndex && slides && slides[req.slideIndex - 1]
      ? {
          heading: slides[req.slideIndex - 1].heading,
          body: slides[req.slideIndex - 1].body,
          index: req.slideIndex,
          total: slides.length,
        }
      : undefined;

  const input: RenderInput = {
    variant: req.variant,
    palette,
    category: req.category,
    headline: req.draft.headline,
    body: req.draft.body,
    // Only the final slide carries the CTA — repeating it on every slide reads
    // as a template, not a designed deck.
    cta: slide && slide.index !== slide.total ? '' : req.draft.cta,
    slide,
    disclaimer: DISCLAIMER_TEXT,
  };

  return template.render(input);
}

/** Rasterise an SVG string to a PNG blob at the given pixel size. */
async function rasterise(svg: string, width: number, height: number): Promise<Blob> {
  // encodeURIComponent (not btoa) so non-Latin copy survives the trip.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const img = new Image();
  img.decoding = 'sync';

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to rasterise template SVG'));
    img.src = url;
  });

  // decode() settles layout/glyph work before we draw; without it Safari can
  // paint a partially-laid-out document.
  if (typeof img.decode === 'function') {
    try { await img.decode(); } catch { /* already loaded — onload is enough */ }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable — cannot render poster');

  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Poster export failed (toBlob returned null)');
  return blob;
}

/** Render one asset. */
export async function renderAsset(req: RenderRequest): Promise<RenderedAsset> {
  const { width, height } = ASPECT_VARIANTS[req.variant];
  const svg = composeSvg(req);
  const blob = await rasterise(svg, width, height);
  return {
    variant: req.slideIndex
      ? `carousel_${String(req.slideIndex).padStart(2, '0')}`
      : req.variant,
    blob,
    width,
    height,
    previewUrl: URL.createObjectURL(blob),
  };
}

/**
 * Render every asset for a piece of content: one PNG per requested aspect
 * ratio, or one PNG per slide when the draft is a deck.
 */
export async function renderAll(
  base: Omit<RenderRequest, 'variant' | 'slideIndex'>,
  variants: AspectVariant[],
  slideCount?: number,
): Promise<RenderedAsset[]> {
  const out: RenderedAsset[] = [];

  if (slideCount && slideCount > 0) {
    // Decks render at a single ratio, one asset per slide.
    const variant = variants[0] ?? 'portrait';
    for (let i = 1; i <= slideCount; i++) {
      out.push(await renderAsset({ ...base, variant, slideIndex: i }));
    }
    return out;
  }

  for (const variant of variants) {
    out.push(await renderAsset({ ...base, variant }));
  }
  return out;
}

/** Free preview object URLs. */
export function releaseAssets(assets: RenderedAsset[]): void {
  for (const a of assets) URL.revokeObjectURL(a.previewUrl);
}
