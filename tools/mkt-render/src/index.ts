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
import { isContentGone } from './classifyError.ts';

/* Every rendered asset is also written here and uploaded as a workflow
 * artifact. That is what makes it possible to eyeball a morning's output, and
 * to pixel-compare the worker against a studio render without a database. */
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../out');

/*
 * The project URL is not a secret — it is hardcoded in the cron migrations too,
 * with a comment saying exactly that. Defaulting it here removes a whole class
 * of setup failure: it was previously supplied as a GitHub *variable*, which
 * lives on a different settings tab from secrets, and a workflow that has the
 * secret but not the variable fails in the worker's first line for a reason the
 * name does not make obvious. The env var still overrides, for pointing a local
 * run at a branch project.
 */
const DEFAULT_SUPABASE_URL = 'https://jlmwazuwjnhoqqloyeoj.supabase.co';

const SUPABASE_URL = (process.env.SUPABASE_URL?.trim() || DEFAULT_SUPABASE_URL).replace(/\/$/, '');
const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
const SECRET = process.env.MKT_RENDER_SECRET?.trim() ?? '';
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

/*
 * GitHub workflow annotations.
 *
 * This exists because of a two-and-a-half week outage that nobody could
 * diagnose. The job log is the obvious place to look, but the logs API needs a
 * token, so from outside the repo the only visible facts were "step: Render"
 * and "exit code 1" — identical for a missing secret, a browser that would not
 * start, and a font that did not resolve. Fifty-eight runs failed that way.
 *
 * The check-runs ANNOTATIONS API is readable without a token, so anything
 * emitted as a workflow command survives into a place a diagnosis can actually
 * reach. A scheduled job that fails invisibly is barely better than one that
 * does not run.
 */
const inActions = process.env.GITHUB_ACTIONS === 'true';
const oneLine = (s: string) => s.replace(/\r?\n/g, '%0A');
const annotate = (level: 'notice' | 'warning' | 'error', title: string, msg: string) => {
  if (inActions) console.log(`::${level} title=${title}::${oneLine(msg)}`);
};

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
  /*
   * Say what is configured before doing anything. The first CI run failed in
   * this pre-flight and the step name ("Render") gave no hint which of several
   * inputs was missing; one line of context turns that into a five-second
   * diagnosis. The secret is reported only as present/absent and by length.
   */
  const preflight =
    `target=${SUPABASE_URL} secret=${SECRET ? `present(${SECRET.length} chars)` : 'MISSING'} ` +
    `run_date=${RUN_DATE ?? 'today'} dry_run=${DRY_RUN}`;
  log(preflight);
  annotate('notice', 'render preflight', preflight);

  if (!SECRET) {
    throw new Error(
      'MKT_RENDER_SECRET is not set. Add it as a repository SECRET (Settings → ' +
      'Secrets and variables → Actions → Secrets), matching the MKT_RENDER_SECRET ' +
      'Supabase function secret.',
    );
  }

  const session = await openSession(m => log(m));
  let failures = 0;
  /* Slots whose content became unavailable (expired / swept / deleted) between
   * generation and render. That is irrecoverable data lifecycle, not a render
   * bug, so it is recorded (the CRM Auto-Schedule monitor shows the lost slot)
   * but does NOT fail the CI job — otherwise a render gap after downtime turns
   * every catch-up run red. */
  let skipped = 0;
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

    /*
      A wrong font is a WARNING, not a failure. This gate used to throw, and
      that was the wrong trade.

      textFit measures glyph widths on the same host that draws them, so a
      fallback face produces a self-consistent layout: the wrapping matches the
      font actually used. What is lost is typeface fidelity — posters in
      Liberation Sans rather than Inter — not correctness. Blocking every piece
      of content indefinitely to protect the typeface is worse than shipping in
      the wrong one, especially since the alternative on offer was nothing at
      all for two and a half weeks.

      It stays loud: an annotation on every affected run, so "we are rendering
      in the wrong font" can never be mistaken for normal.
    */
    if (fonts.effectiveSans !== 'Inter') {
      const message =
        `Rendering in "${fonts.effectiveSans}" instead of Inter — the vendored fonts did not ` +
        `resolve in Chromium. Layout is self-consistent but the typeface is not the intended ` +
        `one. Check the "Install brand fonts" step and fontconfig on the runner.`;
      log(`WARNING: ${message}`);
      annotate('warning', 'font fallback', message);
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
        const message = err instanceof Error ? err.message : String(err);
        // Content that expired / was swept / was deleted before this slot could
        // be rendered is irrecoverable, not a render failure — record it but do
        // not fail the CI job (a render gap after downtime would otherwise turn
        // every catch-up run red). Genuine render errors still count and fail.
        const contentGone = isContentGone(message);
        if (contentGone) {
          skipped++;
          console.warn(`[render] ${label} SKIPPED — content unavailable: ${message}`);
        } else {
          failures++;
          console.error(`[render] ${label} FAILED: ${message}`);
        }
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

  if (skipped) {
    // Recorded (visible in the CRM monitor) but deliberately not a CI failure.
    log(`${skipped} slot(s) skipped — content had expired/was removed before render`);
  }
  if (failures) {
    // Non-zero exit so GitHub surfaces it. Slots that succeeded are already
    // finalised; this only reports that the day is incomplete.
    throw new Error(`${failures} of ${claimedCount} slot(s) failed to render`);
  }
  log('done');
}

main().catch(err => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error('[render] FATAL:', message);
  annotate('error', 'render failed', message.slice(0, 900));
  process.exit(1);
});
