// Driving the harness: launch Chromium, render one piece, collect the bytes.
//
// Shared by the worker and the fidelity spike so there is one definition of
// "how this project renders headlessly". The browser is expensive to start
// (~1s) and cheap to reuse, so a session wraps N renders rather than one.

import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const harnessDist = resolve(here, '../dist-harness');

export interface RenderSpec {
  contentId: string;
  contentType: string;
  category: string;
  templateId: string;
  paletteId: string;
  headline: string;
  body: string;
  cta: string;
  slides: { heading: string; body: string }[] | null;
  videoScript: { scene: string; text: string; duration_seconds: number }[] | null;
}

export interface RenderedAsset {
  variant: string;
  kind: 'image' | 'video';
  mimeType: string;
  width: number;
  height: number;
  durationSeconds: number | null;
  buffer: Buffer;
}

export interface FontReport {
  resolved: { family: string; available: boolean }[];
  effectiveSans: string;
  effectiveSerif: string;
  videoMimeType: string | null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
};

/**
 * Serve the built harness over http.
 *
 * file:// is not an option: the brand ident loads into a <video> element and
 * Chromium refuses that cross-scheme, so the ident would silently vanish from
 * the end of every video and look like a short render rather than a blocked
 * load.
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

export interface Session {
  render(spec: RenderSpec): Promise<RenderedAsset[]>;
  fonts(): Promise<FontReport>;
  close(): Promise<void>;
}

export async function openSession(onLog?: (msg: string) => void): Promise<Session> {
  if (!existsSync(resolve(harnessDist, 'index.html'))) {
    throw new Error('Harness not built. Run: npm run build:harness');
  }

  const { server, origin } = await serve(harnessDist);
  const browser: Browser = await chromium.launch({
    args: [
      // The brand ident is a <video> that must start without a click.
      '--autoplay-policy=no-user-gesture-required',
      // MediaRecorder needs a real compositor path; SwiftShader provides one
      // without a GPU, which is what a CI runner has.
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });

  const page: Page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => onLog?.(`page exception: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') onLog?.(`page error: ${m.text()}`); });

  // Bytes arrive chunked; assemble per variant.
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

  return {
    async fonts() {
      return await page.evaluate(() => window.__niyomFontReport());
    },

    async render(spec) {
      buffers.clear();
      const metas = await page.evaluate(s => window.__niyomRender(s), spec as never);

      return metas.map(m => {
        const b64 = (buffers.get(m.variant) ?? []).join('');
        const buffer = Buffer.from(b64, 'base64');
        if (buffer.length !== m.byteLength) {
          throw new Error(
            `${spec.contentId}/${m.variant}: transferred ${buffer.length}B, expected ${m.byteLength}B`,
          );
        }
        return {
          variant: m.variant,
          kind: m.kind,
          mimeType: m.mimeType,
          width: m.width,
          height: m.height,
          durationSeconds: m.durationSeconds,
          buffer,
        };
      });
    },

    async close() {
      await browser.close().catch(() => undefined);
      server.close();
    },
  };
}

/** The file extension storage should use for an asset. */
export function extensionFor(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('webm')) return 'webm';
  return 'png';
}
