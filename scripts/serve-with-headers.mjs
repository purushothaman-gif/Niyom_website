/*
 * Serves the built dist/ with the EXACT headers from vercel.json, so the CSP can
 * be exercised against the real bundle before it is enforced in production.
 * `vite preview` will not do this -- it knows nothing about vercel.json.
 *
 * Reads the header list straight out of vercel.json rather than duplicating it,
 * so what is tested here cannot drift from what ships.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] ?? '.');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 4180);

const vercel = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
const HEADERS = (vercel.headers ?? []).flatMap((h) => h.headers ?? []);
console.log(`[serve] applying ${HEADERS.length} headers from vercel.json`);
for (const h of HEADERS) console.log(`[serve]   ${h.key}`);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
};

async function readIfFile(p) {
  try {
    const s = await stat(p);
    if (!s.isFile()) return null;
    return await readFile(p);
  } catch {
    return null;
  }
}

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  // Contain traversal: resolve and require the result to stay under DIST.
  const candidate = resolve(join(DIST, urlPath));
  let body = candidate.startsWith(DIST) ? await readIfFile(candidate) : null;
  let ext = extname(candidate);

  if (!body) {
    // SPA rewrite, mirroring the vercel.json rewrite rule.
    body = await readIfFile(join(DIST, 'index.html'));
    ext = '.html';
  }

  for (const h of HEADERS) res.setHeader(h.key, h.value);
  res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
  res.writeHead(body ? 200 : 404);
  res.end(body ?? 'not found');
}).listen(PORT, () => console.log(`[serve] http://localhost:${PORT}`));
