// Install the brand fonts so Chromium resolves them as SYSTEM fonts.
//
// ## Why fontconfig and not CSS
//
// The obvious approach — a page-level @font-face — does not work here, and
// fails in the worst possible way. Posters are composed as SVG and rasterised
// by drawing that SVG into an <img>, which is an isolated document that cannot
// see the host page's styles (TemplateRenderer.ts:7-12). A page-level font
// would therefore change what textFit MEASURES while leaving what actually gets
// DRAWN on a fallback face: silently mis-wrapped text, correct-looking code.
//
// Installing at the fontconfig level makes the font real to Chromium for both
// the measuring canvas and the isolated SVG document, which is the only way the
// two agree.
//
// ## Georgia
//
// FONT_SERIF names Georgia, which is proprietary Microsoft and not
// redistributable. Gelasio is metric-compatible with it — identical advance
// widths, so line breaks match a real-Georgia machine exactly, with very
// slightly different letterforms. Aliasing it to the family name "Georgia"
// means the existing font stack resolves unchanged and no frontend code moves.

import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const modules = resolve(here, '../node_modules/@expo-google-fonts');

// The weights the templates actually use: 400/500/600/800 in the SVG
// templates, 600/700 in the canvas video path. Shipping the full family would
// be ~20 files for no benefit.
const WANTED = [
  ['inter', ['Inter_400Regular.ttf', 'Inter_500Medium.ttf', 'Inter_600SemiBold.ttf', 'Inter_700Bold.ttf', 'Inter_800ExtraBold.ttf']],
  ['gelasio', ['Gelasio_400Regular.ttf', 'Gelasio_500Medium.ttf', 'Gelasio_600SemiBold.ttf', 'Gelasio_700Bold.ttf']],
];

if (platform() !== 'linux') {
  console.log('[fonts] not Linux — skipping. macOS and Windows resolve their own system fonts.');
  process.exit(0);
}

const fontDir = join(homedir(), '.local/share/fonts');
mkdirSync(fontDir, { recursive: true });

let copied = 0;
for (const [pkg, files] of WANTED) {
  const root = join(modules, pkg);
  // The package lays each face out in its own directory, so find rather than
  // assume a flat layout.
  const dirs = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory());
  for (const want of files) {
    const dir = dirs.find(d => {
      try { return readdirSync(join(root, d.name)).includes(want); } catch { return false; }
    });
    if (!dir) {
      console.warn(`[fonts] ${want} not found in @expo-google-fonts/${pkg}`);
      continue;
    }
    copyFileSync(join(root, dir.name, want), join(fontDir, want));
    copied++;
  }
}

// Alias Georgia to Gelasio. `binding="same"` keeps the metrics treated as
// equivalent rather than as a weak preference.
const confDir = join(homedir(), '.config/fontconfig');
mkdirSync(confDir, { recursive: true });
writeFileSync(join(confDir, 'fonts.conf'), `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <!-- Georgia is not redistributable; Gelasio is metric-compatible with it. -->
  <match target="pattern">
    <test qual="any" name="family"><string>Georgia</string></test>
    <edit name="family" mode="assign" binding="same"><string>Gelasio</string></edit>
  </match>
</fontconfig>
`);

execFileSync('fc-cache', ['-f'], { stdio: 'inherit' });

const listed = execFileSync('fc-list', [], { encoding: 'utf8' });
const haveInter = listed.includes('Inter');
const haveGelasio = listed.includes('Gelasio');
console.log(`[fonts] installed ${copied} file(s); Inter=${haveInter} Gelasio=${haveGelasio}`);

if (!haveInter || !haveGelasio) {
  console.error('[fonts] fontconfig cannot see the installed fonts — rendering would mis-wrap.');
  process.exit(1);
}
