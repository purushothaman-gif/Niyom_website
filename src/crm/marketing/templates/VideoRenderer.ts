// Animated video rendering, in the browser.
//
// Builds a short educational video from the same brand system as the posters:
// each scene of the generated script becomes an animated card (background wash,
// eyebrow, animated headline, brand footer), drawn to a canvas and captured
// with MediaRecorder.
//
// Constraints worth knowing before changing anything here:
//   * Codec support is split. Chromium records WebM (VP9/VP8); Safari records
//     MP4/H.264. We feature-detect and record the first supported type, then
//     store the real MIME on the asset row so downloads get the right extension.
//   * requestAnimationFrame is throttled in background tabs, which would stall
//     capture and produce a truncated video. The caller must keep the tab
//     focused; onProgress exists so the UI can say so and show progress.
//   * Everything is drawn with canvas primitives and OS-resident fonts. No
//     external image or webfont is loaded, so the canvas is never tainted.

import { ASPECT_VARIANTS } from '../marketingConstants';
import { AspectVariant, VideoScene } from '../marketingTypes';
import { FONT_SANS, Palette, NIYOM_LOGO_DATA_URI } from './brandTokens';
import { art, artForCategory } from './financeArt';
import { paletteFor } from './TemplateRenderer';
import { iconForCategory, IconDef } from './financeIcons';

const FPS = 30;

export interface VideoRenderRequest {
  scenes: VideoScene[];
  category: string;
  headline: string;
  cta: string;
  paletteId: string;
  variant: AspectVariant;
  disclaimer: string;
  onProgress?: (fraction: number) => void;
}

export interface RenderedVideo {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  durationSeconds: number;
  previewUrl: string;
}

/** Ordered by preference: MP4 where available, then WebM. */
const CANDIDATE_TYPES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function supportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return CANDIDATE_TYPES.find(t => MediaRecorder.isTypeSupported(t)) ?? null;
}

export function isVideoSupported(): boolean {
  return supportedMimeType() !== null && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

// --- easings ---------------------------------------------------------------

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// --- brand emblem ----------------------------------------------------------

// Canvas drawImage needs a decoded bitmap, and every frame is drawn
// synchronously, so the emblem is decoded once up front and cached. It comes
// from a data URI, so drawing it never taints the canvas.
let logoImage: HTMLImageElement | null = null;
let logoLoad: Promise<HTMLImageElement | null> | null = null;

export function loadBrandLogo(): Promise<HTMLImageElement | null> {
  if (logoImage) return Promise.resolve(logoImage);
  if (logoLoad) return logoLoad;

  logoLoad = new Promise(resolve => {
    const img = new Image();
    img.onload = () => { logoImage = img; resolve(img); };
    // A missing emblem must not abort a render — the chrome falls back to the
    // wordmark alone.
    img.onerror = () => resolve(null);
    img.src = NIYOM_LOGO_DATA_URI;
  });
  return logoLoad;
}

/** 0 -> 1 over the first `d` of the scene, 1 -> 0 over the last `d`. */
function fade(t: number, d = 0.16): number {
  if (t < d) return easeOutCubic(t / d);
  if (t > 1 - d) return easeOutCubic(clamp01((1 - t) / d));
  return 1;
}

// --- drawing ---------------------------------------------------------------

function wrapLines(
  ctx: CanvasRenderingContext2D, text: string, maxWidth: number,
): string[] {
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

/**
 * Background: gradient, a drifting accent wash, and a field of slow particles.
 *
 * The particles are the cheapest way to stop a talking-head-free video reading
 * as a static slide with text swapped on it. They are deterministic (seeded off
 * their own index) so the motion is smooth and identical on every render rather
 * than shimmering randomly frame to frame.
 */
const PARTICLE_COUNT = 26;

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, p: Palette, t: number) {
  const g = ctx.createLinearGradient(0, 0, w * 0.6, h);
  g.addColorStop(0, p.bgFrom);
  g.addColorStop(1, p.bgTo);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Slow drifting accent wash so a static card still feels alive.
  const cx = w * (0.85 + Math.sin(t * Math.PI * 2) * 0.05);
  const cy = h * (0.12 + Math.cos(t * Math.PI * 2) * 0.04);
  const radial = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.85);
  radial.addColorStop(0, hexToRgba(p.accent, 0.2));
  radial.addColorStop(1, hexToRgba(p.accent, 0));
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, w, h);

  const scale = Math.min(w, h) / 1080;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    // Cheap deterministic scatter — no RNG, so frames stay reproducible.
    const sx = ((i * 73) % 100) / 100;
    const sy = ((i * 149) % 100) / 100;
    const speed = 0.35 + ((i * 37) % 60) / 100;
    const size = (2 + ((i * 17) % 5)) * scale;
    // Drift upward and wrap, with a gentle lateral sway.
    const y = (sy - t * speed * 0.6 + 1) % 1;
    const x = sx + Math.sin((t * 2 + i) * Math.PI) * 0.012;
    const o = 0.05 + ((i * 29) % 10) / 100;
    ctx.beginPath();
    ctx.arc(x * w, y * h, size, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(p.accent, o);
    ctx.fill();
  }
}

/**
 * Rasterise an illustration to a bitmap the canvas can draw.
 *
 * The compositions are SVG, and canvas cannot draw SVG markup directly — it
 * needs a decoded image. Rendered once before recording starts, because every
 * frame afterwards is drawn synchronously. Same data-URI route as the posters,
 * so the canvas is never tainted.
 */
export function rasterizeArt(
  fn: Parameters<typeof art>[0], palette: Palette, px: number,
): Promise<HTMLImageElement | null> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">`
    + art(fn, 0, 0, px, palette, 'vid') + '</svg>';
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    // Art is decoration — a failure must not abort the render.
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function drawIcon(
  ctx: CanvasRenderingContext2D, icon: IconDef,
  x: number, y: number, size: number, color: string, alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(icon.d));
  ctx.fillStyle = color;
  for (const d of icon.dots ?? []) {
    ctx.beginPath();
    ctx.arc(d.cx, d.cy, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawChrome(
  ctx: CanvasRenderingContext2D, w: number, h: number, p: Palette,
  category: string, disclaimer: string, scale: number,
) {
  const margin = Math.round(Math.min(w, h) * 0.085);

  // Category chip
  const chipFont = 20 * scale;
  ctx.font = `600 ${chipFont}px ${FONT_SANS}`;
  const label = category.toUpperCase();
  const chipW = ctx.measureText(label).width + 36 * scale;
  const chipH = chipFont + 22 * scale;
  ctx.fillStyle = p.chipBg;
  roundRect(ctx, margin, margin, chipW, chipH, chipH / 2);
  ctx.fill();
  ctx.fillStyle = p.chipText;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, margin + 18 * scale, margin + chipH / 2);

  // Brand lockup — the real emblem, matching the poster templates. The emblem
  // carries the wordmark, so only the domain sits beside it.
  const baseY = h - margin;
  const emblem = 34 * scale;
  ctx.textBaseline = 'alphabetic';

  if (logoImage) {
    ctx.drawImage(logoImage, margin, baseY - emblem, emblem, emblem);
  } else {
    // Emblem not decoded yet — keep the brand present rather than blank.
    ctx.fillStyle = p.heading;
    ctx.font = `700 ${13 * scale}px ${FONT_SANS}`;
    ctx.fillText('NIYOM WEALTH', margin, baseY - emblem * 0.35);
  }

  ctx.fillStyle = p.footer;
  ctx.font = `${11 * scale}px ${FONT_SANS}`;
  ctx.fillText(
    'niyomwealth.com',
    margin + (logoImage ? emblem + 11 * scale : 0),
    baseY - emblem / 2 + 4 * scale,
  );

  // Disclaimer — required furniture on every asset.
  ctx.font = `${16 * scale}px ${FONT_SANS}`;
  ctx.fillStyle = p.footer;
  ctx.textAlign = 'right';
  ctx.fillText(disclaimer, w - margin, baseY - 6 * scale);
  ctx.textAlign = 'left';
}

function roundRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw one frame of one scene. `t` is 0..1 progress through that scene. */
function drawScene(
  ctx: CanvasRenderingContext2D, w: number, h: number, p: Palette,
  scene: VideoScene, index: number, total: number,
  category: string, disclaimer: string, t: number,
  artImage: HTMLImageElement | null,
) {
  const scale = Math.min(w, h) / 1080;
  const margin = Math.round(Math.min(w, h) * 0.085);
  const contentW = w - margin * 2;

  drawBackground(ctx, w, h, p, (index + t) / Math.max(total, 1));
  drawChrome(ctx, w, h, p, category, disclaimer, scale);

  const alpha = fade(t);

  // The illustration animates in ahead of the copy and holds with a slow float,
  // so the eye has something moving to settle on while the line is read.
  if (artImage) {
    const artPx = Math.min(w, h) * 0.42;
    const enter = easeOutCubic(clamp01(t / 0.3));
    const float = Math.sin(t * Math.PI * 2) * 6 * scale;
    const ax = w - margin - artPx * 0.96;
    const ay = h * 0.17 + float;
    ctx.save();
    ctx.globalAlpha = alpha * enter * 0.95;
    // Scale about the composition's own centre so it grows in place.
    ctx.translate(ax + artPx / 2, ay + artPx / 2);
    ctx.scale(0.86 + enter * 0.14, 0.86 + enter * 0.14);
    ctx.drawImage(artImage, -artPx / 2, -artPx / 2, artPx, artPx);
    ctx.restore();
  }

  // Scene text — shrink to fit, same discipline as the poster templates.
  let fontSize = 78 * scale;
  let lines: string[] = [];
  for (; fontSize >= 32 * scale; fontSize -= 3 * scale) {
    ctx.font = `800 ${fontSize}px ${FONT_SANS}`;
    lines = wrapLines(ctx, scene.text, contentW);
    if (lines.length <= 4) break;
  }
  ctx.font = `800 ${fontSize}px ${FONT_SANS}`;

  const lineHeight = fontSize * 1.16;
  const blockH = lines.length * lineHeight;
  // Text sits below the artwork rather than centred through it.
  const startY = h * (artImage ? 0.62 : 0.5) - (artImage ? 0 : blockH / 2) + fontSize * 0.34;

  // Lines reveal in sequence instead of the block fading as one piece — the
  // single biggest reason the old output read as "the same words again".
  ctx.save();
  ctx.fillStyle = p.heading;
  lines.forEach((line, i) => {
    const lineDelay = i * 0.1;
    const lp = easeOutCubic(clamp01((t - lineDelay) / 0.26));
    if (lp <= 0) return;
    ctx.globalAlpha = alpha * lp;
    ctx.fillText(line, margin + (1 - lp) * 34 * scale, startY + i * lineHeight);
  });
  ctx.restore();

  // Progress rule across the bottom of the text block.
  const ruleY = startY + blockH + 26 * scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = hexToRgba(p.accent, 0.25);
  ctx.fillRect(margin, ruleY, contentW, 3 * scale);
  ctx.fillStyle = p.accent;
  ctx.fillRect(margin, ruleY, contentW * ((index + t) / Math.max(total, 1)), 3 * scale);
  ctx.restore();

  const icon = iconForCategory(category);
  drawIcon(ctx, icon, w - margin - 100 * scale, margin + 6 * scale, 100 * scale, p.accent, alpha * 0.85);
}

/** Closing card: the education-only CTA plus the brand lockup. */
function drawOutro(
  ctx: CanvasRenderingContext2D, w: number, h: number, p: Palette,
  cta: string, category: string, disclaimer: string, t: number,
) {
  const scale = Math.min(w, h) / 1080;
  const margin = Math.round(Math.min(w, h) * 0.085);
  const contentW = w - margin * 2;

  drawBackground(ctx, w, h, p, 1);
  drawChrome(ctx, w, h, p, category, disclaimer, scale);

  const alpha = fade(t, 0.2);
  ctx.save();
  ctx.globalAlpha = alpha;

  let fontSize = 64 * scale;
  let lines: string[] = [];
  for (; fontSize >= 30 * scale; fontSize -= 3 * scale) {
    ctx.font = `700 ${fontSize}px ${FONT_SANS}`;
    lines = wrapLines(ctx, cta, contentW);
    if (lines.length <= 3) break;
  }
  ctx.font = `700 ${fontSize}px ${FONT_SANS}`;

  const lineHeight = fontSize * 1.2;
  const startY = (h - lines.length * lineHeight) / 2 + fontSize * 0.34;

  ctx.fillStyle = p.accent;
  ctx.fillRect(margin, startY - fontSize - 30 * scale, 62 * scale, 4 * scale);

  ctx.fillStyle = p.heading;
  lines.forEach((line, i) => ctx.fillText(line, margin, startY + i * lineHeight));
  ctx.restore();
}

/**
 * Draw a single frame as a PNG, without recording anything.
 *
 * Used for the poster/thumbnail frame shown before a video is recorded, and it
 * makes the drawing code inspectable independently of MediaRecorder and of
 * requestAnimationFrame (which browsers pause in background tabs).
 *
 * `position` is 0..1 across the whole piece, including the closing CTA card.
 */
export async function renderVideoFrame(
  req: Omit<VideoRenderRequest, 'onProgress'>,
  position = 0.5,
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const [, artImage] = await Promise.all([
    loadBrandLogo(),
    rasterizeArt(artForCategory(req.category, req.headline), paletteFor(req.paletteId), 520),
  ]);
  const { width, height } = ASPECT_VARIANTS[req.variant];
  const palette = paletteFor(req.paletteId);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable — cannot render video frame');

  const hasOutro = !!req.cta;
  const units = req.scenes.length + (hasOutro ? 1 : 0);
  const at = clamp01(position) * units;
  const idx = Math.min(Math.floor(at), units - 1);
  const local = at - idx;

  if (idx < req.scenes.length) {
    drawScene(ctx, width, height, palette, req.scenes[idx], idx, units,
      req.category, req.disclaimer, local, artImage);
  } else {
    drawOutro(ctx, width, height, palette, req.cta, req.category, req.disclaimer, local);
  }

  return { canvas, width, height };
}

/**
 * Render the script to a video file.
 *
 * Resolves once the recorder has flushed every chunk. Rejects if the browser
 * cannot record, if the script is empty, or if capture produces nothing.
 */
export async function renderVideo(req: VideoRenderRequest): Promise<RenderedVideo> {
  const mimeType = supportedMimeType();
  if (!mimeType) {
    throw new Error('This browser cannot record video. Chrome, Edge or Safari are supported.');
  }
  if (!req.scenes.length) throw new Error('There is no video script to render.');

  const { width, height } = ASPECT_VARIANTS[req.variant];
  const palette = paletteFor(req.paletteId);

  // Decode the emblem and rasterise the illustration before the first frame —
  // every frame after this is drawn synchronously and cannot wait for either.
  const [, artImage] = await Promise.all([
    loadBrandLogo(),
    rasterizeArt(artForCategory(req.category, req.headline), palette, 520),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable — cannot render video');

  // Paint frame zero before capture starts so the first frame is never blank.
  drawScene(ctx, width, height, palette, req.scenes[0], 0, req.scenes.length + 1,
    req.category, req.disclaimer, 0, artImage);

  const stream = canvas.captureStream(FPS);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  const OUTRO_MS = 2200;
  const sceneMs = req.scenes.map(s => Math.max(1200, (s.duration_seconds || 3) * 1000));
  const totalMs = sceneMs.reduce((a, b) => a + b, 0) + (req.cta ? OUTRO_MS : 0);

  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      if (!blob.size) reject(new Error('Recording produced an empty file. Keep this tab in the foreground and try again.'));
      else resolve(blob);
    };
    recorder.onerror = () => reject(new Error('Recording failed.'));
  });

  recorder.start();
  const startedAt = performance.now();

  await new Promise<void>(resolve => {
    const tick = () => {
      const elapsed = performance.now() - startedAt;

      if (elapsed >= totalMs) { resolve(); return; }
      req.onProgress?.(clamp01(elapsed / totalMs));

      // Locate the current scene.
      let acc = 0;
      let idx = -1;
      for (let i = 0; i < sceneMs.length; i++) {
        if (elapsed < acc + sceneMs[i]) { idx = i; break; }
        acc += sceneMs[i];
      }

      if (idx >= 0) {
        drawScene(ctx, width, height, palette, req.scenes[idx], idx,
          req.scenes.length + (req.cta ? 1 : 0), req.category, req.disclaimer,
          (elapsed - acc) / sceneMs[idx], artImage);
      } else if (req.cta) {
        drawOutro(ctx, width, height, palette, req.cta, req.category, req.disclaimer,
          clamp01((elapsed - acc) / OUTRO_MS));
      }

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  recorder.stop();
  stream.getTracks().forEach(t => t.stop());

  const blob = await finished;
  req.onProgress?.(1);

  return {
    blob,
    mimeType,
    width,
    height,
    durationSeconds: Math.round(totalMs / 1000),
    previewUrl: URL.createObjectURL(blob),
  };
}
