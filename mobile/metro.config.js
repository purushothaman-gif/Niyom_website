const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');
const sharedRoot = path.resolve(repoRoot, 'shared');

const config = getDefaultConfig(projectRoot);

/*
 * `shared/` lives OUTSIDE this project's root — it is the folder the website
 * and the app both import so the two can never show different numbers. Metro
 * only watches the project root by default, so it has to be named explicitly
 * or every edit there would need a cache clear to show up.
 */
/*
 * ...and `shared/` itself reaches one level further: the generated database
 * types and a couple of pure helpers (`mfPlan`, which decides whether a scheme
 * is a direct plan) live under the edge functions, because the Deno deploy has
 * to bundle them. They are plain TypeScript with no Deno imports.
 *
 * TypeScript resolves these happily, so a missing entry here does NOT show up
 * in `npm run typecheck` — only an actual bundle catches it. Run
 * `npx expo export` after touching anything shared.
 */
const edgeSharedRoot = path.resolve(repoRoot, 'supabase/functions/_shared');

config.watchFolders = [sharedRoot, edgeSharedRoot];

/*
 * ...and having named it, resolution has to be pinned back to THIS project's
 * node_modules. Without this, a `react` imported from a shared file resolves
 * relative to shared/ (which has no node_modules), walks up to the repo root
 * and finds the WEBSITE's react — two React copies in one bundle, which fails
 * at runtime with the "invalid hook call" that has no obvious cause.
 */
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

/*
 * `expo-doctor` FLAGS THE LINE BELOW. Do not "fix" it by removing it.
 *
 * With hierarchical lookup on, Metro resolves `react` by walking up from the
 * importing file first — so a file in `shared/` finds `Niyom/node_modules/react`,
 * which is the WEBSITE's React 18, before it ever consults nodeModulesPaths.
 * Two Reacts in one bundle fail at runtime with an "invalid hook call" that
 * points at nothing in particular.
 *
 * Turning hierarchical lookup off makes nodeModulesPaths the only answer, which
 * is exactly what Expo's own monorepo guide prescribes. Both the iOS and the web
 * bundles are verified to build with it, including expo-router's nested
 * dependencies — so the doctor warning here is generic, not a finding.
 */
config.resolver.disableHierarchicalLookup = true;

// `xlsx` ships a .cjs build that Metro will not pick up without this.
config.resolver.sourceExts = [...config.resolver.sourceExts, 'cjs', 'mjs'];

module.exports = config;
