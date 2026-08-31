/**
 * Films every scene of a cut.
 *
 * One browser context per aspect ratio, signed in once. The screencast is
 * started and stopped around each scene, so the sign-in (when it is not itself
 * a scene), the waits and the navigation between scenes never reach the film.
 * Each scene is encoded to its own mp4 as soon as it is shot and its frames are
 * deleted, because a landscape scene is roughly a gigabyte of JPEG.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { ASPECTS, BRAND, DEMO_PAN, DEMO_PASSWORD, OUT_DIR, type AspectSpec } from './brand.js';
import { scenesFor, type Scene } from './narration.js';
import { loadVoice, sceneSeconds } from './voice.js';
import { CURSOR_INIT, Pointer } from './cursor.js';
import { ACTS } from './acts.js';
import { Recorder } from './recorder.js';
import { encodeScene, ffprobeDuration, sceneMp4 } from './ffmpeg.js';
import { startMotionServer, type MotionServer } from './motion.js';

const BASE = process.env.PROMO_BASE_URL ?? 'http://localhost:5173';

export interface ShotScene {
  id: string;
  file: string;
  seconds: number;
}

async function newContext(browser: Browser, spec: AspectSpec): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: spec.uiWidth, height: spec.uiHeight },
    deviceScaleFactor: spec.uiScale,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  // The portal honours a saved theme over the OS hint, and the dark palette is
  // the one the brand ident and the title cards are built against.
  await ctx.addInitScript(() => {
    try { localStorage.setItem('niyom-theme', 'dark'); } catch { /* ignore */ }
  });
  await ctx.addInitScript(() => {
    // Kill the caret blink: at 30 fps it strobes.
    const s = document.createElement('style');
    s.textContent = '*, *::before, *::after { caret-color: transparent !important; }';
    (document.head ?? document.documentElement).appendChild(s);
  });
  await ctx.addInitScript(CURSOR_INIT(BRAND.accent, BRAND.accentSoft));
  return ctx;
}

/**
 * Idempotent: the demo session lives in the context, so after the opening title
 * card /partner-login already renders the portal rather than the form.
 */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${BASE}/partner-login`, { waitUntil: 'networkidle' });
  if (await page.getByRole('button', { name: 'Sign Out' }).count()) {
    await page.waitForTimeout(500);
    return;
  }
  await page.getByPlaceholder('ABCDE1234F').fill(DEMO_PAN);
  await page.getByPlaceholder('Your password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForSelector('text=Welcome,', { timeout: 20000 });
  await page.waitForTimeout(1200);
}

async function shootMotion(
  page: Page, scene: Scene, spec: AspectSpec, motion: MotionServer,
  recDir: string, outFile: string, hold: number,
): Promise<void> {
  // Lay the card out in CSS pixels and let the context's device scale factor do
  // the supersampling, exactly as the portal footage is captured — a card laid
  // out at full pixel size would render a 2700x4800 page for the vertical cut.
  const cssW = Math.round(spec.width / spec.uiScale);
  const cssH = Math.round(spec.height / spec.uiScale);
  await page.setViewportSize({ width: cssW, height: cssH });
  await page.goto(motion.cardUrl(scene.id, cssW, cssH), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  // Park the page one frame before the animations are meant to be seen.
  await page.waitForTimeout(120);

  const rec = new Recorder(page, recDir, spec.width, spec.height);
  await rec.start();
  // Replay the entrance now that the recorder is attached.
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('.rise, .rule').forEach((el) => {
      const a = el.style.animation;
      el.style.animation = 'none';
      void el.offsetHeight;
      el.style.animation = a;
    });
  });
  await page.waitForTimeout(Math.round(hold * 1000));
  const { playlist, seconds } = await rec.stop(hold);
  await encodeScene(playlist, outFile, spec.width, spec.height, seconds);
}

async function shootUi(
  page: Page, scene: Scene, spec: AspectSpec,
  recDir: string, outFile: string, hold: number, mobile: boolean,
): Promise<number> {
  const pointer = new Pointer(page);
  // Every scene opens at the top of its page. Without this a scene inherits the
  // previous one's scroll position and starts mid-content.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }));
  await page.waitForTimeout(220);
  const rec = new Recorder(page, recDir, spec.uiWidth * spec.uiScale, spec.uiHeight * spec.uiScale);
  await rec.start();
  const began = Date.now();

  const act = ACTS[scene.id];
  if (!act) throw new Error(`scene "${scene.id}" has no act`);
  await act({ page, p: pointer, mobile });

  const elapsed = (Date.now() - began) / 1000;
  if (elapsed < hold) await page.waitForTimeout(Math.round((hold - elapsed) * 1000));

  const { playlist, seconds } = await rec.stop(hold);
  await encodeScene(playlist, outFile, spec.width, spec.height, seconds);
  return seconds;
}

export async function captureCut(cut: AspectSpec['key']): Promise<ShotScene[]> {
  const spec = ASPECTS[cut];
  // PROMO_ONLY=bonds,payouts re-shoots just those scenes, leaving the rest of
  // the cut's mp4s in place for the assembly step.
  const only = (process.env.PROMO_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const scenes = scenesFor(cut).filter((s) => !only.length || only.includes(s.id));
  const clips = await loadVoice();

  const cutDir = path.join(OUT_DIR, cut);
  const framesRoot = path.join(OUT_DIR, '.frames', cut);
  await fs.mkdir(cutDir, { recursive: true });
  await fs.mkdir(framesRoot, { recursive: true });

  const motion = await startMotionServer();
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
  const ctx = await newContext(browser, spec);
  const page = await ctx.newPage();
  const mobile = cut === 'vertical';

  const shot: ShotScene[] = [];
  const opensOnLogin = scenes.some((s) => s.id === 'login');

  if (opensOnLogin) {
    await page.goto(`${BASE}/partner-login`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
  } else {
    await signIn(page);
  }

  for (const scene of scenes) {
    const hold = sceneSeconds(scene.id, clips, scene.tail ?? 0.6);
    const recDir = path.join(framesRoot, scene.id);
    const outFile = sceneMp4(cutDir, scene.id);
    const t0 = Date.now();

    if (scene.kind === 'motion') {
      await shootMotion(page, scene, spec, motion, recDir, outFile, hold);
      // Motion scenes resize the viewport; put the portal back afterwards.
      await page.setViewportSize({ width: spec.uiWidth, height: spec.uiHeight });
      if (scene.id !== 'cta') {
        if (opensOnLogin) await page.goto(`${BASE}/partner-login`, { waitUntil: 'networkidle' });
        else await signIn(page);
        await page.waitForTimeout(700);
      }
    } else {
      await shootUi(page, scene, spec, recDir, outFile, hold, mobile);
    }

    const seconds = await ffprobeDuration(outFile);
    shot.push({ id: scene.id, file: outFile, seconds });
    console.log(
      `  ${scene.id.padEnd(14)} ${seconds.toFixed(2)}s  (narration ${(hold - (scene.tail ?? 0.6)).toFixed(2)}s, shot in ${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
    if (!process.env.PROMO_KEEP_FRAMES) await fs.rm(recDir, { recursive: true, force: true });
  }

  await ctx.close();
  await browser.close();
  await motion.close();
  if (!only.length) {
    await fs.writeFile(path.join(cutDir, 'scenes.json'), JSON.stringify(shot, null, 2));
  }
  return shot;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2] as AspectSpec['key'] | undefined;
  const cuts: AspectSpec['key'][] = only ? [only] : ['landscape', 'vertical'];
  for (const cut of cuts) {
    console.log(`\nFilming ${cut}:`);
    await captureCut(cut);
  }
}
