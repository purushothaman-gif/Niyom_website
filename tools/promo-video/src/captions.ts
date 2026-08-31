/**
 * Caption overlays, rendered in Chromium rather than with ffmpeg's drawtext.
 *
 * drawtext would need a font file and would give us Helvetica by default; the
 * film's captions have to be set in the same Space Grotesk and Inter as the
 * product they are describing. So each caption is a transparent PNG screenshot
 * at full frame size, composited by ffmpeg as a straight overlay.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { BRAND, FONT_BODY, FONT_DISPLAY, GOOGLE_FONTS, ILLUSTRATIVE_NOTICE, type AspectSpec } from './brand.js';
import type { Scene } from './film.js';

function captionHtml(scene: Scene, spec: AspectSpec, cssW: number): string {
  const vertical = spec.key === 'vertical';
  const scale = cssW / (vertical ? 1080 : 1920);
  const px = (n: number) => `${(n * scale).toFixed(2)}px`;

  return `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${GOOGLE_FONTS}">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  body { font-family: ${FONT_BODY}; }
  .scrim {
    position: fixed; left: 0; right: 0; bottom: 0; height: ${px(vertical ? 460 : 300)};
    background: linear-gradient(to top, rgba(7,21,36,0.94) 0%, rgba(7,21,36,0.78) 42%, rgba(7,21,36,0) 100%);
  }
  .cap {
    position: fixed; left: ${px(vertical ? 70 : 110)}; right: ${px(vertical ? 70 : 110)};
    bottom: ${px(vertical ? 250 : 104)};
    display: flex; align-items: center; gap: ${px(22)};
    justify-content: ${vertical ? 'center' : 'flex-start'};
  }
  .bar { width: ${px(6)}; align-self: stretch; border-radius: ${px(3)};
         background: linear-gradient(180deg, ${BRAND.accentSoft}, ${BRAND.accentStrong}); }
  .text { font-family: ${FONT_DISPLAY}; font-weight: 600; color: ${BRAND.textPrimary};
          font-size: ${px(vertical ? 54 : 50)}; line-height: 1.22; letter-spacing: ${px(-0.4)};
          text-shadow: 0 ${px(2)} ${px(18)} rgba(0,0,0,0.65);
          text-align: ${vertical ? 'center' : 'left'}; }
  .notice {
    position: fixed; left: 0; right: 0; bottom: ${px(vertical ? 150 : 40)};
    text-align: center; color: ${BRAND.textSecondary};
    font-size: ${px(vertical ? 26 : 24)}; letter-spacing: ${px(0.2)}; font-weight: 500;
    padding: 0 ${px(80)};
  }
</style></head>
<body>
  <div class="scrim"></div>
  <div class="cap">${vertical ? '' : '<div class="bar"></div>'}<div class="text">${scene.caption}</div></div>
  ${scene.illustrative ? `<div class="notice">${ILLUSTRATIVE_NOTICE}</div>` : ''}
</body></html>`;
}

/** One transparent PNG per scene that has a caption. Returns id → file path. */
export async function renderCaptions(
  scenes: Scene[], spec: AspectSpec, dir: string,
): Promise<Record<string, string>> {
  await fs.mkdir(dir, { recursive: true });
  const cssW = Math.round(spec.width / spec.uiScale);
  const cssH = Math.round(spec.height / spec.uiScale);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: cssW, height: cssH },
    deviceScaleFactor: spec.uiScale,
  });
  const page = await ctx.newPage();

  const out: Record<string, string> = {};
  for (const scene of scenes) {
    if (!scene.caption) continue;
    await page.setContent(captionHtml(scene, spec, cssW), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(120);
    const file = path.join(dir, `${scene.id}.png`);
    await page.screenshot({ path: file, omitBackground: true });
    out[scene.id] = file;
  }

  await browser.close();
  return out;
}
