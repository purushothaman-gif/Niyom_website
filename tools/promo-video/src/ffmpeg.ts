/** Thin ffmpeg/ffprobe wrappers. Every encode in the film goes through here. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { FPS } from './brand.js';

const run = promisify(execFile);

export async function ffmpeg(args: string[]): Promise<void> {
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    maxBuffer: 1024 * 1024 * 64,
  });
}

export async function ffprobeDuration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ]);
  return Number(stdout.trim());
}

export async function ffprobeStreams(file: string): Promise<string> {
  const { stdout } = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,channels',
    '-of', 'default=noprint_wrappers=1', file,
  ]);
  return stdout.trim();
}

/**
 * Variable-rate screencast frames → a constant-rate clip at the target size.
 *
 * `-vsync cfr` is what does the real work: the playlist's per-frame durations
 * describe when each frame appeared, and this resamples that into an even 30
 * fps, holding still frames and dropping duplicates.
 */
export async function encodeScene(
  playlist: string,
  out: string,
  width: number,
  height: number,
  seconds: number,
): Promise<void> {
  await ffmpeg([
    '-f', 'concat', '-safe', '0',
    '-i', playlist,
    '-t', seconds.toFixed(3),
    '-vf', [
      // fps= must come first, and must do the job that -vsync cfr looks like it
      // would do: with -vsync the concat demuxer's final frame duration is
      // dropped and every clip lands ~1s short of its narration.
      `fps=${FPS}`,
      `scale=${width}:${height}:flags=lanczos:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x071524`,
      // A page that stops repainting stops producing frames, so a scene whose
      // last seconds are a static modal would still end early. Clone the final
      // frame out past the target; -t then trims to it exactly.
      `tpad=stop_mode=clone:stop_duration=${seconds.toFixed(3)}`,
      'format=yuv420p',
    ].join(','),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
    out,
  ]);
}

export const sceneMp4 = (dir: string, id: string) => path.join(dir, `${id}.mp4`);
