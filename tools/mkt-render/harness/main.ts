// Render harness — the browser half of the automated content worker.
//
// This file deliberately contains NO drawing logic. It imports the CRM's real
// renderers and calls them exactly as ContentStudio does, so a poster produced
// by the nightly worker and a poster produced by an admin clicking "Render
// artwork" come out of the same code path. Every time drawing logic has been
// reimplemented for a headless environment in this industry, the two copies
// have drifted; the whole point of running a real browser in CI is to not have
// a second copy.
//
// Node drives it through window.__niyomRender and collects bytes through the
// window.__niyomSink binding Playwright installs.

import { renderAll } from '../../../src/crm/marketing/templates/TemplateRenderer';
import { renderVideo, supportedMimeType } from '../../../src/crm/marketing/templates/VideoRenderer';
import {
  CONTENT_TYPES,
  DISCLAIMER_TEXT,
  VARIANTS_FOR_TYPE,
} from '../../../src/crm/marketing/marketingConstants';
import { FONT_SANS, FONT_SERIF } from '../../../src/crm/marketing/templates/brandTokens';
import type {
  AspectVariant,
  ContentSlide,
  ContentType,
  VideoScene,
} from '../../../src/crm/marketing/marketingTypes';

/** What Node asks for: one piece of content, already planned and generated. */
export interface RenderSpec {
  contentId: string;
  contentType: ContentType;
  category: string;
  templateId: string;
  paletteId: string;
  headline: string;
  body: string;
  cta: string;
  slides: ContentSlide[] | null;
  videoScript: VideoScene[] | null;
}

/** What Node gets back. The bytes travel separately, through the sink. */
export interface RenderedMeta {
  variant: string;
  kind: 'image' | 'video';
  mimeType: string;
  width: number;
  height: number;
  durationSeconds: number | null;
  byteLength: number;
}

export interface FontReport {
  /** Each family named in FONT_SANS / FONT_SERIF, and whether it resolved. */
  resolved: { family: string; available: boolean }[];
  /** The first available family in each stack — what actually gets drawn. */
  effectiveSans: string;
  effectiveSerif: string;
  videoMimeType: string | null;
}

declare global {
  interface Window {
    __niyomRender: (spec: RenderSpec) => Promise<RenderedMeta[]>;
    __niyomFontReport: () => FontReport;
    /** Installed by Playwright via exposeBinding. */
    __niyomSink: (variant: string, chunkIndex: number, chunks: number, b64: string) => Promise<void>;
  }
}

const log = (msg: string) => {
  const el = document.getElementById('log');
  if (el) el.textContent = `${el.textContent}\n${msg}`.trim();
};

// ---------------------------------------------------------------------------
// Font resolution
//
// This matters more than it looks. textFit.ts measures glyph widths on a canvas
// to decide line breaks and shrink-to-fit sizes, so the fonts available to the
// browser change what the SVG *says*, not merely how it is antialiased. A CI
// runner missing Inter does not produce a slightly different poster, it
// produces a differently-wrapped one.
// ---------------------------------------------------------------------------

function familiesOf(stack: string): string[] {
  return stack.split(',').map(f => f.trim().replace(/^['"]|['"]$/g, ''));
}

/**
 * Detect a real font by measuring against the three generic fallbacks.
 *
 * A missing family silently resolves to the generic, so a family is present iff
 * it measures differently from at least one generic — with a probe string of
 * mixed-width glyphs, since finance copy mixes wide numerals with narrow
 * lowercase and a naive probe misses near-metric-compatible substitutions.
 */
function fontAvailable(family: string): boolean {
  const generics = ['monospace', 'serif', 'sans-serif'];
  if (generics.includes(family)) return true;

  const probe = 'MMMWWWiii11100OO ₹1,23,456 compounding';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const widthWith = (f: string) => {
    ctx.font = `600 72px ${f}`;
    return ctx.measureText(probe).width;
  };

  return generics.some(g => widthWith(`"${family}", ${g}`) !== widthWith(g));
}

function firstAvailable(stack: string): string {
  return familiesOf(stack).find(fontAvailable) ?? '(generic fallback)';
}

window.__niyomFontReport = () => {
  const families = [...new Set([...familiesOf(FONT_SANS), ...familiesOf(FONT_SERIF)])];
  return {
    resolved: families.map(family => ({ family, available: fontAvailable(family) })),
    effectiveSans: firstAvailable(FONT_SANS),
    effectiveSerif: firstAvailable(FONT_SERIF),
    videoMimeType: supportedMimeType(),
  };
};

// ---------------------------------------------------------------------------
// Byte transfer
//
// page.evaluate serialises through JSON, so binaries have to go out as base64.
// A 60s 1080x1920 MP4 can reach 30 MB, which is ~40 MB of base64 — enough to
// make a single return value unwieldy. Chunking through an exposed binding
// keeps every message small and lets Node stream straight to disk.
// ---------------------------------------------------------------------------

const CHUNK = 512 * 1024;

async function ship(variant: string, blob: Blob): Promise<number> {
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // Build base64 in slices: String.fromCharCode(...bigArray) blows the argument
  // limit somewhere north of 100k elements.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  const b64 = btoa(binary);

  const chunks = Math.max(1, Math.ceil(b64.length / CHUNK));
  for (let i = 0; i < chunks; i++) {
    await window.__niyomSink(variant, i, chunks, b64.slice(i * CHUNK, (i + 1) * CHUNK));
  }
  return bytes.length;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

window.__niyomRender = async (spec: RenderSpec): Promise<RenderedMeta[]> => {
  const typeMeta = CONTENT_TYPES.find(t => t.id === spec.contentType);
  if (!typeMeta) throw new Error(`Unknown content type: ${spec.contentType}`);

  const variants = VARIANTS_FOR_TYPE[spec.contentType] as AspectVariant[];
  const out: RenderedMeta[] = [];

  if (typeMeta.video) {
    if (!spec.videoScript?.length) throw new Error('Video content type with no video_script');
    log(`video: ${spec.videoScript.length} scenes`);

    const video = await renderVideo({
      scenes: spec.videoScript,
      category: spec.category,
      headline: spec.headline,
      cta: spec.cta,
      paletteId: spec.paletteId,
      variant: variants[0],
      disclaimer: DISCLAIMER_TEXT,
      onProgress: f => log(`  ${Math.round(f * 100)}%`),
    });

    out.push({
      variant: 'video',
      kind: 'video',
      mimeType: video.mimeType,
      width: video.width,
      height: video.height,
      durationSeconds: Math.round(video.durationSeconds),
      byteLength: await ship('video', video.blob),
    });
    URL.revokeObjectURL(video.previewUrl);
    return out;
  }

  // Decks render one PNG per slide at a single ratio; everything else renders
  // one PNG per ratio. renderAll already encodes that rule — do not second
  // guess it here, or auto content stops matching studio content.
  const slideCount = typeMeta.slides ? (spec.slides?.length ?? 0) : undefined;
  log(`images: ${spec.contentType} ${slideCount ? `${slideCount} slides` : variants.join(', ')}`);

  const assets = await renderAll(
    {
      draft: {
        headline: spec.headline,
        body: spec.body,
        cta: spec.cta,
        slides: spec.slides ?? undefined,
      },
      category: spec.category,
      templateId: spec.templateId,
      paletteId: spec.paletteId,
    },
    variants,
    slideCount,
  );

  for (const a of assets) {
    out.push({
      variant: a.variant,
      kind: 'image',
      mimeType: 'image/png',
      width: a.width,
      height: a.height,
      durationSeconds: null,
      byteLength: await ship(a.variant, a.blob),
    });
    URL.revokeObjectURL(a.previewUrl);
  }
  return out;
};

log('harness ready');
