import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

/**
 * Emit the brand ident next to the harness bundle.
 *
 * `VideoRenderer.END_CARD_SRC` is the absolute path '/niyom-end-card.mp4', so
 * the file has to sit at the served root. Pointing Vite's `publicDir` at the
 * app's own public/ would work but copies 8.4 MB of unrelated marketing assets
 * on every build; this emits the one file that is actually referenced.
 */
function brandIdent(): Plugin {
  return {
    name: 'niyom-brand-ident',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'niyom-end-card.mp4',
        source: readFileSync(resolve(repoRoot, 'public/niyom-end-card.mp4')),
      });
    },
  };
}

/**
 * The harness is deliberately a *build*, not a dev server: CI renders against
 * the same bundling the app ships with, so a Vite-only transform quirk cannot
 * make worker output diverge from studio output.
 */
export default defineConfig({
  root: resolve(here, 'harness'),

  /*
   * Stop Vite searching UPWARDS for a PostCSS config.
   *
   * The harness has none of its own and uses no Tailwind, so the search walked
   * out of this sub-project and found the WEBSITE's `postcss.config.js` at the
   * repo root — which loads `tailwindcss` and `autoprefixer`. That resolves on
   * a dev machine, where the root `node_modules` is present, and fails in CI,
   * where the workflow runs `npm ci` only inside tools/mkt-render:
   *
   *     [vite:css] Failed to load PostCSS config …
   *     Loading PostCSS Plugin failed: Cannot find module 'tailwindcss'
   *
   * An empty inline config is the fix rather than adding tailwindcss here: the
   * harness genuinely does not use it, and a dependency added only to satisfy a
   * config it never wanted is the kind of thing nobody dares remove later.
   */
  css: { postcss: {} },
  publicDir: false,
  plugins: [brandIdent()],
  build: {
    outDir: resolve(here, 'dist-harness'),
    emptyOutDir: true,
    // Chromium loads this from a local static server, not a CDN. Inlining
    // keeps it to a single request and removes any chance of a chunk 404
    // silently producing a blank render.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: { inlineDynamicImports: true, entryFileNames: 'harness.js' },
    },
  },
});
