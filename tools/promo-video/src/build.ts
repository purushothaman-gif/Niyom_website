/**
 * Assembly: scene clips + captions + narration + the brand ident → one mp4.
 *
 * Cuts are hard, not cross-faded, and that is deliberate. Each scene's
 * narration is padded with silence to exactly its own scene's length, so
 * picture and voice are locked by construction; a cross-fade would slide every
 * scene earlier by the transition length and put the two out of step. A short
 * fade-up at the head of each clip does the softening instead.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ASPECTS, END_CARD_PATH, FPS, OUT_DIR, type AspectSpec,
} from './brand.js';
import { scenesFor } from './narration.js';
import { loadVoice, type VoClip } from './voice.js';
import { ffmpeg, ffprobeDuration, ffprobeStreams } from './ffmpeg.js';
import { renderCaptions } from './captions.js';

/** Seconds of silence before the narration starts inside each scene. */
const VO_LEAD = 0.25;
/** How long the picture fades up at the head of each cut. */
const CUT_FADE = 0.22;

const IDENT_CUTS = (process.env.PROMO_IDENT ?? 'landscape').split(',').map((s) => s.trim());

async function captionScene(
  clip: string, caption: string | undefined, out: string, seconds: number,
): Promise<void> {
  const fadeOutAt = Math.max(0.1, seconds - 0.65);
  if (!caption) {
    await ffmpeg([
      '-i', clip,
      '-vf', `fade=t=in:st=0:d=${CUT_FADE},format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', String(FPS),
      '-an', out,
    ]);
    return;
  }
  await ffmpeg([
    '-i', clip,
    '-loop', '1', '-i', caption,
    '-filter_complex', [
      `[1:v]format=rgba,fade=t=in:st=0.30:d=0.40:alpha=1,fade=t=out:st=${fadeOutAt.toFixed(2)}:d=0.40:alpha=1[cap]`,
      `[0:v][cap]overlay=0:0:shortest=1[v]`,
      `[v]fade=t=in:st=0:d=${CUT_FADE},format=yuv420p[vout]`,
    ].join(';'),
    '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', String(FPS),
    '-an', out,
  ]);
}

/** The scene's narration, offset by the lead-in and padded to the scene length. */
async function sceneAudio(vo: VoClip | undefined, seconds: number, out: string): Promise<void> {
  if (!vo) {
    await ffmpeg([
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      '-t', seconds.toFixed(3), '-c:a', 'pcm_s16le', out,
    ]);
    return;
  }
  await ffmpeg([
    '-i', vo.file,
    '-af', [
      `adelay=${Math.round(VO_LEAD * 1000)}:all=1`,
      'apad',
      `atrim=0:${seconds.toFixed(3)}`,
      'asetpts=N/SR/TB',
      // A touch of headroom so the voice sits at a consistent level.
      'loudnorm=I=-16:TP=-1.5:LRA=11',
    ].join(','),
    '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', out,
  ]);
}

/** The ident, conformed to this cut's canvas. Black pads read as no pad at all. */
async function identClip(spec: AspectSpec, out: string): Promise<number> {
  await ffmpeg([
    '-i', END_CARD_PATH,
    '-vf', [
      `fps=${FPS}`,
      `scale=${spec.width}:${spec.height}:flags=lanczos:force_original_aspect_ratio=decrease`,
      `pad=${spec.width}:${spec.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
      'format=yuv420p',
    ].join(','),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-an', out,
  ]);
  return ffprobeDuration(out);
}

export async function buildCut(cut: AspectSpec['key']): Promise<string> {
  const spec = ASPECTS[cut];
  const scenes = scenesFor(cut);
  const vo = await loadVoice();

  const cutDir = path.join(OUT_DIR, cut);
  const workDir = path.join(cutDir, 'work');
  await fs.mkdir(workDir, { recursive: true });

  console.log('  rendering captions…');
  const captions = await renderCaptions(scenes, spec, path.join(workDir, 'captions'));

  const pieces: string[] = [];
  const audios: string[] = [];

  for (const scene of scenes) {
    const clip = path.join(cutDir, `${scene.id}.mp4`);
    const seconds = await ffprobeDuration(clip);

    const vClip = path.join(workDir, `v-${scene.id}.mp4`);
    const aClip = path.join(workDir, `a-${scene.id}.wav`);
    await captionScene(clip, captions[scene.id], vClip, seconds);
    await sceneAudio(vo.find((c) => c.id === scene.id), seconds, aClip);

    pieces.push(vClip);
    audios.push(aClip);
    console.log(`  ${scene.id.padEnd(14)} ${seconds.toFixed(2)}s`);
  }

  if (IDENT_CUTS.includes(cut)) {
    const ident = path.join(workDir, 'ident.mp4');
    const identSeconds = await identClip(spec, ident);
    const identAudio = path.join(workDir, 'a-ident.wav');
    await sceneAudio(undefined, identSeconds, identAudio);
    pieces.push(ident);
    audios.push(identAudio);
    console.log(`  ${'ident'.padEnd(14)} ${identSeconds.toFixed(2)}s`);
  }

  // --- concat -------------------------------------------------------------
  const vList = path.join(workDir, 'video.txt');
  const aList = path.join(workDir, 'audio.txt');
  await fs.writeFile(vList, pieces.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  await fs.writeFile(aList, audios.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));

  const vCat = path.join(workDir, 'video.mp4');
  const aCat = path.join(workDir, 'audio.wav');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', vList, '-c', 'copy', vCat]);
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', aList, '-c', 'copy', aCat]);

  const total = await ffprobeDuration(vCat);
  const out = path.join(OUT_DIR, `niyom-partner-portal-${cut === 'landscape' ? '16x9-1080p' : '9x16-1080p'}.mp4`);

  await ffmpeg([
    '-i', vCat, '-i', aCat,
    '-filter_complex', [
      `[0:v]fade=t=in:st=0:d=0.5,fade=t=out:st=${(total - 0.7).toFixed(2)}:d=0.7,format=yuv420p[v]`,
      `[1:a]afade=t=in:st=0:d=0.3,afade=t=out:st=${(total - 0.7).toFixed(2)}:d=0.7[a]`,
    ].join(';'),
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart',
    '-t', total.toFixed(3),
    out,
  ]);

  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2] as AspectSpec['key'] | undefined;
  const cuts: AspectSpec['key'][] = only ? [only] : ['landscape', 'vertical'];
  for (const cut of cuts) {
    console.log(`\nAssembling ${cut}:`);
    const file = await buildCut(cut);
    console.log(`\n  → ${file}`);
    console.log(`    ${(await ffprobeDuration(file)).toFixed(2)}s`);
    console.log(await ffprobeStreams(file).then((s) => s.split('\n').map((l) => `    ${l}`).join('\n')));
  }
}
