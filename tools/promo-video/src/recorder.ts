/**
 * Frame recorder built on the CDP screencast, not Playwright's recordVideo.
 *
 * recordVideo starts when the context opens and stops when it closes, which
 * would bake the sign-in — and every wait between scenes — into the footage,
 * leaving frame-accurate trimming as the only way out. The screencast can be
 * started and stopped around exactly the moments worth keeping, so each scene
 * lands in its own directory with its own timing, and one bad scene can be
 * re-shot without re-shooting the film.
 *
 * Frames arrive only when the page repaints, so the wall-clock gap between two
 * frames IS how long the first one was on screen. Those gaps are written into
 * an ffconcat file; ffmpeg then resamples the whole thing to constant 30 fps.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CDPSession, Page } from 'playwright';

interface Frame {
  file: string;
  /** Seconds since the recording started. */
  at: number;
}

export class Recorder {
  private cdp: CDPSession | null = null;
  private frames: Frame[] = [];
  private writes: Promise<unknown>[] = [];
  private started = 0;
  private index = 0;

  constructor(
    private readonly page: Page,
    private readonly dir: string,
    private readonly maxWidth: number,
    private readonly maxHeight: number,
  ) {}

  async start(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
    await fs.mkdir(this.dir, { recursive: true });

    this.cdp = await this.page.context().newCDPSession(this.page);
    this.frames = [];
    this.writes = [];
    this.index = 0;

    this.cdp.on('Page.screencastFrame', (frame) => {
      // Ack first and unconditionally: the browser sends at most one
      // un-acked frame, so a slow disk write here would stall the stream.
      this.cdp?.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});

      const now = frame.metadata.timestamp;
      if (!this.started) this.started = now ?? 0;
      const at = Math.max(0, (now ?? 0) - this.started);

      const file = path.join(this.dir, `f${String(this.index++).padStart(5, '0')}.jpg`);
      this.frames.push({ file, at });
      this.writes.push(fs.writeFile(file, Buffer.from(frame.data, 'base64')));
    });

    this.started = 0;
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: this.maxWidth,
      maxHeight: this.maxHeight,
      everyNthFrame: 1,
    });
  }

  /**
   * Stop, and write the ffconcat playlist. `holdTo` pads the last frame so the
   * scene runs at least as long as its narration.
   */
  async stop(holdTo: number): Promise<{ playlist: string; frames: number; seconds: number }> {
    if (!this.cdp) throw new Error('recorder was never started');
    await this.cdp.send('Page.stopScreencast').catch(() => {});
    await Promise.all(this.writes);
    await this.cdp.detach().catch(() => {});
    this.cdp = null;

    if (!this.frames.length) throw new Error(`no frames captured in ${this.dir}`);

    const last = this.frames[this.frames.length - 1].at;
    const total = Math.max(holdTo, last + 0.1);

    const lines = ['ffconcat version 1.0'];
    for (let i = 0; i < this.frames.length; i += 1) {
      const next = i + 1 < this.frames.length ? this.frames[i + 1].at : total;
      const dur = Math.max(1 / 120, next - this.frames[i].at);
      lines.push(`file '${path.basename(this.frames[i].file)}'`);
      lines.push(`duration ${dur.toFixed(4)}`);
    }
    // ffconcat drops the final entry's duration unless the file is repeated.
    lines.push(`file '${path.basename(this.frames[this.frames.length - 1].file)}'`);

    const playlist = path.join(this.dir, 'frames.ffconcat');
    await fs.writeFile(playlist, lines.join('\n'));
    return { playlist, frames: this.frames.length, seconds: total };
  }
}
