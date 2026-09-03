/**
 * Narration. macOS `say` writes AIFF, ffmpeg converts to AAC, ffprobe measures
 * it — and the measured length is what every scene's duration is derived from.
 *
 * Voice is overridable: `PROMO_VOICE="Ava (Premium)" npm run voice` picks up a
 * downloaded Enhanced/Premium voice, which sounds markedly better than the
 * bundled ones. Rishi is the default because the audience is Indian and it
 * pronounces the brand, the rupee amounts and "PAN" correctly.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT_DIR } from './brand.js';
import { type Film } from './film.js';
import { getFilm } from './films/index.js';

const run = promisify(execFile);

export const VOICE = process.env.PROMO_VOICE ?? 'Rishi';
export const RATE = Number(process.env.PROMO_RATE ?? 168);

export const voDir = (film: Film) => path.join(OUT_DIR, film.key, 'vo');
export const voManifest = (film: Film) => path.join(voDir(film), 'manifest.json');

export interface VoClip {
  id: string;
  file: string;
  seconds: number;
}

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  const n = Number(stdout.trim());
  if (!Number.isFinite(n)) throw new Error(`ffprobe gave no duration for ${file}`);
  return n;
}

export async function generateVoice(film: Film): Promise<VoClip[]> {
  const dir = voDir(film);
  await fs.mkdir(dir, { recursive: true });
  const clips: VoClip[] = [];

  for (const scene of film.scenes) {
    const aiff = path.join(dir, `${scene.id}.aiff`);
    const m4a = path.join(dir, `${scene.id}.m4a`);

    await run('say', ['-v', VOICE, '-r', String(RATE), '-o', aiff, scene.sayText ?? scene.vo]);
    await run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', aiff,
      // 48k stereo AAC so every clip concatenates without a resample step.
      '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k',
      m4a,
    ]);
    await fs.rm(aiff, { force: true });

    const seconds = await probeDuration(m4a);
    clips.push({ id: scene.id, file: m4a, seconds });
    console.log(`  ${scene.id.padEnd(14)} ${seconds.toFixed(2)}s`);
  }

  await fs.writeFile(voManifest(film), JSON.stringify({ voice: VOICE, rate: RATE, clips }, null, 2));
  return clips;
}

export async function loadVoice(film: Film): Promise<VoClip[]> {
  const raw = JSON.parse(await fs.readFile(voManifest(film), 'utf8')) as { clips: VoClip[] };
  return raw.clips;
}

/** How long a scene's picture runs: its narration plus a tail so cuts breathe. */
export function sceneSeconds(id: string, clips: VoClip[], tail = 0.6): number {
  const clip = clips.find((c) => c.id === id);
  if (!clip) throw new Error(`no narration recorded for scene "${id}"`);
  return clip.seconds + tail;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const film = getFilm(process.argv[2]);
  console.log(`Narrating "${film.key}" with "${VOICE}" at ${RATE} wpm:`);
  const clips = await generateVoice(film);
  const total = clips.reduce((a, c) => a + c.seconds, 0);
  console.log(`\nTotal narration ${total.toFixed(1)}s across ${clips.length} scenes.`);
}
