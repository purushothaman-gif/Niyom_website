/**
 * Brand constants for the promo render.
 *
 * Deliberately duplicated from src/theme/tokens.css rather than imported: this
 * package is a standalone Node tool with no Vite, no PostCSS and no access to
 * the app's CSS custom properties. The values below are the dark-theme tokens
 * the portal itself ships. If tokens.css moves, move these with it.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** tools/promo-video */
export const PKG_ROOT = path.resolve(here, '..');
/** the app repo root */
export const REPO_ROOT = path.resolve(here, '../../..');
export const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
export const OUT_DIR = path.join(PKG_ROOT, 'out');

export const LOGO_PATH = path.join(PUBLIC_DIR, 'niyomlogo.png');
export const END_CARD_PATH = path.join(PUBLIC_DIR, 'niyom-end-card.mp4');

/** Dark theme — the portal's production default, and what the ident matches. */
export const BRAND = {
  base: '#071524',
  elevated: '#081B33',
  surface: '#10284D',
  raised: '#16345C',
  textPrimary: '#f4f7fc',
  textSecondary: '#9fb0c9',
  textMuted: '#7688a4',
  accent: '#C8A45D',
  accentSoft: '#d8bd86',
  accentStrong: '#b8934a',
  accentDeep: '#9a7938',
  success: '#16a34a',
} as const;

export const FONT_DISPLAY = "'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const FONT_BODY = "'Inter', 'Helvetica Neue', Helvetica, Arial, sans-serif";
export const GOOGLE_FONTS =
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap';

export const FPS = 30;

export interface AspectSpec {
  key: 'landscape' | 'vertical';
  width: number;
  height: number;
  /** Viewport the portal is driven at before it is framed into the canvas. */
  uiWidth: number;
  uiHeight: number;
  /** Device scale used when recording the UI, for crisp text after scaling. */
  uiScale: number;
}

export const ASPECTS: Record<AspectSpec['key'], AspectSpec> = {
  // 1600x900 recorded at 1.5x, downsampled to 1080p — supersampling, so small
  // UI text stays crisp instead of shimmering.
  landscape: { key: 'landscape', width: 1920, height: 1080, uiWidth: 1600, uiHeight: 900, uiScale: 1.5 },
  // The portal's own responsive layout at phone width. 432x768 at 2.5x is
  // exactly 1080x1920, so the vertical cut is never rescaled, letterboxed or
  // cropped — a 16:9 screen shrunk into 9:16 is unreadable on the phone this
  // cut is actually watched on.
  vertical: { key: 'vertical', width: 1080, height: 1920, uiWidth: 432, uiHeight: 768, uiScale: 2.5 },
};

/** Rendered over any frame showing rupee figures. Compliance, not decoration. */
export const ILLUSTRATIVE_NOTICE =
  'Illustrative figures from a sample portal. Not a representation of actual or expected earnings.';

export const DEMO_PAN = 'NIYOM1234D';
export const DEMO_PASSWORD = 'NiyomDemo@2026';
