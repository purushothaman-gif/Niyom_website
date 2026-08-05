import { defineConfig } from 'vitest/config';

/**
 * Test config, kept separate from vite.config.ts.
 *
 * The app build carries manualChunks and a dynamic-import layout that matter
 * for what ships to a browser and mean nothing to a test run; loading them here
 * only creates a way for a build tweak to break the tests, or the reverse.
 *
 * Node environment on purpose: everything under test is pure domain logic —
 * source selection, cash-flow signs, XIRR, classification, staleness. None of
 * it touches the DOM, and none of it should need to.
 */
export default defineConfig({
  test: {
    environment: 'node',
    /*
     * The proxy is a separate npm project but the same repo, and its CAS parser
     * carries the most consequential logic we have — a misread there becomes a
     * wrong number on a client's screen. It had no tests until one of those
     * misreads reached production.
     */
    /*
     * The edge functions are Deno at runtime, but `_shared/mfReturns.ts` is
     * plain TypeScript with no Deno imports and it decides the return figures
     * shown on every fund card — it earned coverage the same way the CAS parser
     * did, by being wrong in production.
     */
    include: [
      'src/**/*.test.ts',
      'server/bse-proxy/src/**/*.test.ts',
      /*
       * Recursive on purpose. This was `_shared/*.test.ts` — top level only —
       * which is a trap rather than an oversight: moving the CAS parser's ~120
       * tests into `_shared/cas/` would not have failed, it would have stopped
       * running them, and the suite would have gone green while covering
       * nothing. Check the test COUNT after moving files, not just the colour.
       */
      'supabase/functions/_shared/**/*.test.ts',
    ],
    // Explicit imports of describe/it/expect rather than globals, so the test
    // files typecheck under the app's existing tsconfig with no extra `types`
    // entry and no ambient declarations.
    globals: false,
  },
});
