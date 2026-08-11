// Phase 0 — renderer fidelity spike.
//
// Question being answered: can headless Chromium drive the CRM's own poster and
// video renderers and produce the same artwork the studio produces?
//
// It settles three things that the rest of the automation plan is built on:
//   1. that renderAll/renderVideo run at all outside a real user's tab,
//   2. which fonts the host actually resolves — because textFit measures glyph
//      widths to choose line breaks, a missing font changes the layout, not
//      just the antialiasing,
//   3. that MediaRecorder produces a usable file under --headless=new.
//
// Nothing here talks to Supabase. Output lands in out/ for eyeballing and for
// the pixel diff against a studio render.

import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import { FIXTURES } from './fixture.ts';

const here = dirname(fileURLToPath(import.meta.url));
const harnessDist = resolve(here, '../dist-harness');
const outDir = resolve(here, '../out');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
};

/**
 * Serve the built harness over http.
 *
 * file:// is not an option: the brand ident is loaded into a <video> element
 * and Chromium refuses that cross-scheme, so the ident would silently vanish
 * from the end of every video and the failure would look like a short render
 * rather than a blocked load.
 */
function serve(root: string): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise(ok => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      ok({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function main() {
  if (!existsSync(resolve(harnessDist, 'index.html'))) {
    throw new Error('Harness not built. Run: npm run build:harness');
  }
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const { server, origin } = await serve(harnessDist);
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({
      args: [
        // The ident is a <video> that must start without a click.
        '--autoplay-policy=no-user-gesture-required',
        // MediaRecorder needs a real compositor path; SwiftShader gives one
        // without a GPU, which is what a CI runner has.
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    page.on('console', m => {
      if (m.type() === 'error') console.error('  [page error]', m.text());
    });
    page.on('pageerror', e => console.error('  [page exception]', e.message));

    // Bytes arrive chunked; assemble per variant, then write once.
    const buffers = new Map<string, string[]>();
    await page.exposeBinding(
      '__niyomSink',
      async (_src, variant: string, index: number, chunks: number, b64: string) => {
        const acc = buffers.get(variant) ?? new Array<string>(chunks).fill('');
        acc[index] = b64;
        buffers.set(variant, acc);
      },
    );

    await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__niyomRender === 'function');

    // --- font report -------------------------------------------------------
    const fonts = await page.evaluate(() => window.__niyomFontReport());
    console.log('\n=== Font resolution ===');
    for (const f of fonts.resolved) {
      console.log(`  ${f.available ? '✓' : '·'} ${f.family}`);
    }
    console.log(`  sans  → ${fonts.effectiveSans}`);
    console.log(`  serif → ${fonts.effectiveSerif}`);
    console.log(`  video → ${fonts.videoMimeType ?? 'UNSUPPORTED'}`);

    // --- render ------------------------------------------------------------
    const report: Record<string, unknown>[] = [];

    for (const fx of FIXTURES) {
      console.log(`\n=== ${fx.name} (${fx.contentType}) ===`);
      buffers.clear();
      const started = Date.now();

      const metas = await page.evaluate(spec => window.__niyomRender(spec), {
        contentId: fx.contentId,
        contentType: fx.contentType,
        category: fx.category,
        templateId: fx.templateId,
        paletteId: fx.paletteId,
        headline: fx.headline,
        body: fx.body,
        cta: fx.cta,
        slides: fx.slides,
        videoScript: fx.videoScript,
      });

      const elapsed = ((Date.now() - started) / 1000).toFixed(1);

      for (const m of metas) {
        const ext = m.mimeType.includes('mp4') ? 'mp4' : m.mimeType.includes('webm') ? 'webm' : 'png';
        const b64 = (buffers.get(m.variant) ?? []).join('');
        const buf = Buffer.from(b64, 'base64');
        if (buf.length !== m.byteLength) {
          throw new Error(`${fx.name}/${m.variant}: transferred ${buf.length}B, expected ${m.byteLength}B`);
        }
        const file = `${fx.name}__${m.variant}.${ext}`;
        await writeFile(resolve(outDir, file), buf);
        console.log(
          `  ${file}  ${m.width}x${m.height}  ${(buf.length / 1024).toFixed(0)} KB` +
            (m.durationSeconds ? `  ${m.durationSeconds}s` : ''),
        );
        report.push({ fixture: fx.name, ...m, file });
      }
      console.log(`  rendered in ${elapsed}s`);
    }

    await writeFile(
      resolve(outDir, 'report.json'),
      JSON.stringify({ fonts, assets: report, renderedAt: new Date().toISOString() }, null, 2),
    );
    console.log(`\nWrote ${report.length} assets to ${outDir}`);

    // Fail loudly on the two conditions that would make the whole approach
    // unworkable, rather than leaving them for someone to notice in a preview.
    if (!fonts.videoMimeType) throw new Error('MediaRecorder unsupported — the video path cannot run here');
    const emptyish = report.filter(r => (r.byteLength as number) < 8 * 1024);
    if (emptyish.length) {
      throw new Error(`Suspiciously small assets (likely a blank render): ${emptyish.map(r => r.file).join(', ')}`);
    }
  } finally {
    await browser?.close();
    server.close();
  }
}

main().catch(async err => {
  console.error('\nSPIKE FAILED:', err instanceof Error ? err.message : err);
  // Keep whatever was produced — a partial render is the most useful evidence.
  if (existsSync(outDir)) {
    const files = await readFile(resolve(outDir, 'report.json'), 'utf8').catch(() => null);
    if (files) console.error('Partial report retained at', outDir);
  }
  process.exit(1);
});
