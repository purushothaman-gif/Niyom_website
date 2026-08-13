// Automated daily content — the render worker.
//
// Runs in GitHub Actions each morning. Claims the day's generated slots, draws
// the artwork in a real Chromium using the CRM's own renderers, uploads it, and
// hands each slot back for finalisation.
//
// It holds ONE credential: MKT_RENDER_SECRET, which opens exactly four verbs on
// mkt-auto-render-io. It has no database access, no service-role key, and no
// way to read anything outside the batch it is rendering. Uploads go straight
// to per-object signed URLs, so content bytes never pass back through the edge
// function either.
//
// Failure is per-slot. One broken video does not cost the day its two posters.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionFor, openSession, type RenderedAsset, type RenderSpec } from './renderer.ts';

/* Every rendered asset is also written here and uploaded as a workflow
 * artifact. That is what makes it possible to eyeball a morning's output, and
 * to pixel-compare the worker against a studio render without a database. */
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../out');

const FUNCTIONS_URL = process.env.SUPABASE_URL
  ? `${process.env.SUPABASE_URL.replace(/\/$/, '')}/functions/v1`
  : '';
const SECRET = process.env.MKT_RENDER_SECRET ?? '';
const RUN_DATE = process.env.RUN_DATE?.trim() || undefined;
const DRY_RUN = process.env.DRY_RUN === 'true';

interface ClaimItem {
  slot_id: string;
  slot_no: number;
  content_id: string;
  content_no: string;
  content_type: string;
  category: string;
  headline: string;
  body: string;
  cta: string;
  template_id: string;
  palette_id: string;
  slides: { heading: string; body: string }[] | null;
  video_script: { scene: string; text: string; duration_seconds: number }[] | null;
}

const log = (msg: string) => console.log(`[render] ${msg}`);

async function io<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${FUNCTIONS_URL}/mkt-auto-render-io`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mkt-render-secret': SECRET },
    body: JSON.stringify({ action, ...payload }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${action} failed (${res.status}): ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
}

/** PUT one asset to its signed URL. */
async function upload(signedUrl: string, asset: RenderedAsset): Promise<void> {
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': asset.mimeType, 'x-upsert': 'true' },
    /*
     * A zero-copy view, cast past a genuine lib collision.
     *
     * This package must load the DOM lib (Playwright's page.evaluate callbacks
     * reference `window`), which means TS resolves `fetch` to the DOM's
     * signature while the code runs on Node's. The DOM's BodyInit does not
     * admit a Uint8Array<ArrayBufferLike>; Node's undici accepts it happily.
     * The view avoids copying several MB per video, and the cast is the
     * narrowest way to say "this is Node's fetch, not the browser's".
     */
    body: new Uint8Array(
      asset.buffer.buffer, asset.buffer.byteOffset, asset.buffer.byteLength,
    ) as unknown as BodyInit,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Upload of ${asset.variant} failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

function specFor(item: ClaimItem): RenderSpec {
  return {
    contentId: item.content_id,
    contentType: item.content_type,
    category: item.category,
    templateId: item.template_id,
    paletteId: item.palette_id,
    headline: item.headline,
    body: item.body,
    cta: item.cta,
    slides: item.slides,
    videoScript: item.video_script,
  };
}

async function main() {
  if (!FUNCTIONS_URL) throw new Error('SUPABASE_URL is not set');
  if (!SECRET) throw new Error('MKT_RENDER_SECRET is not set');

  const session = await openSession(m => log(m));
  let failures = 0;
  /* Slots claimed but not yet finalised. Anything left here when the run ends
   * has to be handed back, or it sits in 'rendering' forever and no later run
   * will pick it up — a claim is a lock, and a lock needs an owner that always
   * releases it. */
  const outstanding = new Map<string, string>();
  let claimedCount = 0;

  try {
    /*
     * Fonts are checked BEFORE claiming anything.
     *
     * textFit measures glyph widths to choose line breaks, so a missing Inter
     * produces differently-wrapped posters rather than merely different-looking
     * ones — worth failing the run over. But an earlier version checked this
     * after claiming, so the throw stranded three slots mid-flight. Whatever
     * can fail for the whole run must fail before the first lock is taken.
     */
    const fonts = await session.fonts();
    log(`fonts: sans → ${fonts.effectiveSans}, serif → ${fonts.effectiveSerif}, video → ${fonts.videoMimeType}`);

    if (fonts.effectiveSans !== 'Inter') {
      const message =
        `Expected Inter to resolve, got "${fonts.effectiveSans}". The vendored fonts are not ` +
        `installed, so line breaks would not match the intended layout.`;
      // Escape hatch for running the worker on a developer machine, which has
      // its own fonts. Never set in the workflow: CI output has to be the
      // intended typeface, not whatever the runner happens to have.
      if (process.env.ALLOW_FONT_FALLBACK !== 'true') throw new Error(message);
      log(`WARNING: ${message} Continuing because ALLOW_FONT_FALLBACK is set.`);
    }

    const claim = await io<{ run_date: string; items: ClaimItem[] }>('claim', {
      run_date: RUN_DATE,
    });

    log(`run date ${claim.run_date}: claimed ${claim.items.length} slot(s)`);
    if (!claim.items.length) {
      log('nothing to render');
      return;
    }
    claimedCount = claim.items.length;
    for (const i of claim.items) outstanding.set(i.slot_id, i.content_no);

    for (const item of claim.items) {
      const label = `${item.content_no} (${item.content_type}, slot ${item.slot_no})`;
      try {
        log(`rendering ${label}…`);
        const started = Date.now();
        const assets = await session.render(specFor(item));
        log(`  ${assets.length} asset(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`);

        await mkdir(outDir, { recursive: true });
        for (const a of assets) {
          await writeFile(
            resolve(outDir, `${item.content_no}__${a.variant}.${extensionFor(a.mimeType)}`),
            a.buffer,
          );
        }

        if (DRY_RUN) {
          for (const a of assets) log(`  [dry run] ${a.variant} ${a.width}x${a.height} ${(a.buffer.length / 1024).toFixed(0)}KB`);
          await io('fail', { slot_id: item.slot_id, error: 'dry run — released without rendering' });
          outstanding.delete(item.slot_id);
          continue;
        }

        const { urls } = await io<{ urls: { variant: string; path: string; signed_url: string }[] }>(
          'upload-urls',
          {
            content_id: item.content_id,
            variants: assets.map(a => ({ variant: a.variant, ext: extensionFor(a.mimeType) })),
          },
        );
        const urlFor = new Map(urls.map(u => [u.variant, u]));

        const manifest = [];
        for (const a of assets) {
          const target = urlFor.get(a.variant);
          if (!target) throw new Error(`No upload URL issued for ${a.variant}`);
          await upload(target.signed_url, a);
          manifest.push({
            variant: a.variant,
            kind: a.kind,
            storage_path: target.path,
            width: a.width,
            height: a.height,
            duration_seconds: a.durationSeconds,
            file_size: a.buffer.length,
            mime_type: a.mimeType,
          });
        }

        const result = await io<{ state: string; approved: boolean; flags: unknown[]; auto_approve_enabled: boolean }>(
          'finalize',
          { slot_id: item.slot_id, content_id: item.content_id, assets: manifest },
        );

        outstanding.delete(item.slot_id);
        log(
          `  ${label} → ${result.state}` +
          (result.flags.length ? ` (${result.flags.length} lint issue(s), left for an admin)` : '') +
          (result.state === 'rendered' && !result.auto_approve_enabled
            ? ' — auto-approval is off, so this stays a draft'
            : ''),
        );
      } catch (err) {
        failures++;
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[render] ${label} FAILED: ${message}`);
        if (!DRY_RUN) {
          await io('fail', { slot_id: item.slot_id, error: message }).catch(e =>
            console.error(`[render] could not record failure: ${e}`),
          );
        }
        outstanding.delete(item.slot_id);
      }
    }
  } finally {
    // Hand back anything still held — a crash, a timeout, or a throw between
    // the claim and the finalize. mkt_auto_render_failed returns the slot to a
    // claimable state until its attempt budget is spent, so the next run
    // retries rather than the day silently losing a post.
    for (const [slotId, contentNo] of outstanding) {
      log(`releasing unfinished ${contentNo}`);
      await io('fail', { slot_id: slotId, error: 'worker exited before finalising' })
        .catch(e => console.error(`[render] could not release ${contentNo}: ${e}`));
    }
    await session.close();
  }

  if (failures) {
    // Non-zero exit so GitHub surfaces it. Slots that succeeded are already
    // finalised; this only reports that the day is incomplete.
    throw new Error(`${failures} of ${claimedCount} slot(s) failed to render`);
  }
  log('done');
}

main().catch(err => {
  console.error('[render] FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
