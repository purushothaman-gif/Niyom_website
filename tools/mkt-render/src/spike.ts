// Phase 0 — renderer fidelity spike.
//
// Answers one question: can headless Chromium drive the CRM's own poster and
// video renderers and produce the artwork the studio produces? It settles
// whether renderAll/renderVideo run at all outside a user's tab, which fonts
// the host actually resolves (textFit measures glyph widths to choose line
// breaks, so a missing font changes the LAYOUT, not just the antialiasing), and
// whether MediaRecorder yields a usable file under headless Chromium.
//
// Kept after Phase 0 because it is the fastest way to check a template or
// palette change without touching the database. Nothing here talks to Supabase.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from './fixture.ts';
import { extensionFor, openSession } from './renderer.ts';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../out');

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const session = await openSession(m => console.error(`  ${m}`));
  const report: Record<string, unknown>[] = [];

  try {
    const fonts = await session.fonts();
    console.log('\n=== Font resolution ===');
    for (const f of fonts.resolved) console.log(`  ${f.available ? '✓' : '·'} ${f.family}`);
    console.log(`  sans  → ${fonts.effectiveSans}`);
    console.log(`  serif → ${fonts.effectiveSerif}`);
    console.log(`  video → ${fonts.videoMimeType ?? 'UNSUPPORTED'}`);

    for (const fx of FIXTURES) {
      console.log(`\n=== ${fx.name} (${fx.contentType}) ===`);
      const started = Date.now();
      const assets = await session.render({
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

      for (const a of assets) {
        const file = `${fx.name}__${a.variant}.${extensionFor(a.mimeType)}`;
        await writeFile(resolve(outDir, file), a.buffer);
        console.log(
          `  ${file}  ${a.width}x${a.height}  ${(a.buffer.length / 1024).toFixed(0)} KB` +
            (a.durationSeconds ? `  ${a.durationSeconds}s` : ''),
        );
        report.push({ fixture: fx.name, variant: a.variant, bytes: a.buffer.length, file });
      }
      console.log(`  rendered in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    }

    await writeFile(
      resolve(outDir, 'report.json'),
      JSON.stringify({ fonts, assets: report, renderedAt: new Date().toISOString() }, null, 2),
    );
    console.log(`\nWrote ${report.length} assets to ${outDir}`);

    // Fail loudly on the two conditions that would make the approach
    // unworkable, rather than leaving them to be noticed in a preview.
    if (!fonts.videoMimeType) throw new Error('MediaRecorder unsupported — the video path cannot run here');
    const tiny = report.filter(r => (r.bytes as number) < 8 * 1024);
    if (tiny.length) {
      throw new Error(`Suspiciously small assets (likely a blank render): ${tiny.map(r => r.file).join(', ')}`);
    }
  } finally {
    await session.close();
  }
}

main().catch(err => {
  console.error('\nSPIKE FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
