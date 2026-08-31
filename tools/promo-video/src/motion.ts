/**
 * Title and end cards, plus the throwaway HTTP server that serves them.
 *
 * They are served over http rather than pushed in with setContent because a
 * document with no real origin cannot pull the Google Fonts stylesheet, and a
 * silent fallback to Helvetica in the two most brand-forward frames of the film
 * is exactly the failure that is easiest to miss and worst to ship.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { BRAND, FONT_BODY, FONT_DISPLAY, GOOGLE_FONTS, LOGO_PATH } from './brand.js';
import { type Film, type Scene } from './film.js';
import { getFilm } from './films/index.js';

export interface MotionServer {
  origin: string;
  cardUrl: (filmKey: string, sceneId: string, width: number, height: number) => string;
  close: () => Promise<void>;
}

export async function startMotionServer(): Promise<MotionServer> {
  const logo = await fs.readFile(LOGO_PATH);
  let origin = '';

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/logo.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(logo);
      return;
    }

    if (url.pathname === '/card') {
      const film = getFilm(url.searchParams.get('film') ?? undefined);
      const scene = film.scenes.find((sc) => sc.id === url.searchParams.get('scene'));
      const width = Number(url.searchParams.get('w'));
      const height = Number(url.searchParams.get('h'));
      if (!scene || !width || !height) {
        res.writeHead(400).end('bad card request');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(motionHtml(film, scene, { width, height }, origin));
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    cardUrl: (filmKey, sceneId, width, height) =>
      `${origin}/card?film=${encodeURIComponent(filmKey)}&scene=${encodeURIComponent(sceneId)}&w=${width}&h=${height}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/**
 * A card. Entrance animations are CSS so the screencast picks them up as real
 * repaints; nothing here is timed in JS.
 */
export function motionHtml(
  film: Film,
  scene: Scene,
  spec: { width: number; height: number },
  origin: string,
): string {
  const vertical = spec.height > spec.width;
  const scale = vertical ? spec.width / 1080 : spec.width / 1920;
  const px = (n: number) => `${(n * scale).toFixed(2)}px`;
  const isCta = scene.id === 'cta';

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${GOOGLE_FONTS}">
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  body {
    background:
      radial-gradient(120% 90% at 12% 0%, ${BRAND.surface} 0%, ${BRAND.elevated} 42%, ${BRAND.base} 100%);
    color: ${BRAND.textPrimary};
    font-family: ${FONT_BODY};
    display: flex; align-items: center; justify-content: center;
  }
  /* A slow gold sweep so the card is never a still frame. */
  .sheen {
    position: absolute; inset: -30%;
    background: radial-gradient(closest-side, rgba(200,164,93,0.16), rgba(200,164,93,0) 70%);
    width: ${px(1100)}; height: ${px(1100)};
    animation: drift 14s ease-in-out infinite alternate;
    filter: blur(${px(10)});
  }
  @keyframes drift {
    from { transform: translate(${px(-160)}, ${px(-120)}); }
    to   { transform: translate(${px(180)}, ${px(140)}); }
  }
  .rule {
    height: ${px(2)}; width: 0; background: linear-gradient(90deg, ${BRAND.accent}, ${BRAND.accentDeep});
    animation: grow 900ms cubic-bezier(0.22,0.61,0.36,1) 220ms forwards;
  }
  @keyframes grow { to { width: ${px(vertical ? 300 : 360)}; } }
  .wrap {
    position: relative; z-index: 2; width: 100%;
    padding: 0 ${px(vertical ? 96 : 200)};
    display: flex; flex-direction: column; gap: ${px(vertical ? 30 : 26)};
    align-items: ${vertical ? 'center' : 'flex-start'};
    text-align: ${vertical ? 'center' : 'left'};
  }
  .rise { opacity: 0; transform: translateY(${px(26)}); animation: rise 850ms cubic-bezier(0.22,0.61,0.36,1) forwards; }
  @keyframes rise { to { opacity: 1; transform: none; } }
  .lockup { display: flex; align-items: center; gap: ${px(18)}; }
  .lockup img { height: ${px(vertical ? 84 : 76)}; width: auto; display: block; }
  .brand { font-family: ${FONT_DISPLAY}; font-weight: 700; letter-spacing: ${px(0.4)};
           font-size: ${px(vertical ? 32 : 30)}; color: ${BRAND.accentSoft}; line-height: 1.15; }
  .brand span { display: block; font-family: ${FONT_BODY}; font-weight: 400;
                font-size: ${px(vertical ? 22 : 20)}; color: ${BRAND.textSecondary}; letter-spacing: ${px(1.2)}; }
  .eyebrow { font-size: ${px(vertical ? 22 : 21)}; letter-spacing: ${px(4.5)}; text-transform: uppercase;
             color: ${BRAND.accent}; font-weight: 600; }
  h1 { font-family: ${FONT_DISPLAY}; font-weight: 700; margin: 0; line-height: 1.02;
       letter-spacing: ${px(-1.6)}; font-size: ${px(vertical ? 104 : 132)};
       background: linear-gradient(100deg, ${BRAND.textPrimary} 20%, ${BRAND.accentSoft} 95%);
       -webkit-background-clip: text; background-clip: text; color: transparent; }
  p.sub { margin: 0; font-size: ${px(vertical ? 38 : 40)}; line-height: 1.35; color: ${BRAND.textSecondary};
          max-width: ${px(vertical ? 880 : 1180)}; font-weight: 400; }
  p.sub.url { color: ${BRAND.accentSoft}; font-weight: 600; letter-spacing: ${px(0.4)}; }
  .d1 { animation-delay: 80ms; }  .d2 { animation-delay: 260ms; }
  .d3 { animation-delay: 440ms; } .d4 { animation-delay: 620ms; }
</style>
</head>
<body>
  <div class="sheen"></div>
  <div class="wrap">
    <div class="lockup rise d1">
      <img src="${origin}/logo.png" alt="">
      <div class="brand">Niyom Wealth<span>DISTRIBUTION LLP</span></div>
    </div>
    <div class="eyebrow rise d2">${isCta ? 'Join us' : film.eyebrow}</div>
    <h1 class="rise d2">${scene.title ?? ''}</h1>
    <div class="rule"></div>
    <p class="sub ${isCta ? 'url' : ''} rise d3">${scene.subtitle ?? ''}</p>
  </div>
</body>
</html>`;
}
