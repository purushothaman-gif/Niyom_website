/**
 * Does unpdf extract the SAME TEXT as pdfjs-dist?
 *
 * This is the gate on moving CAS parsing off the droplet. `pdfjs-dist` cannot
 * run in a Supabase Edge Function at all — a static import kills the worker at
 * boot, before any PDF is touched — so the migration has to swap it for
 * `unpdf`, a repackaging of pdfjs with the Node and DOM dependencies stripped.
 *
 * Everything downstream of extraction stays exactly as it is: parse.ts,
 * detailed.ts, import.ts and their ~120 tests. So the ONLY question the
 * migration raises is whether the parser receives the same characters. If the
 * two extractors agree byte-for-byte, the move is provably neutral for any
 * statement that works today — including ones we have never seen.
 *
 * ## Why this is a test and not a throwaway script
 *
 * The spike proved one statement: CAMS, detailed, 34 schemes. It said nothing
 * about KFintech's PDFs, about summary statements (a different code path), or
 * about anything larger. Keeping this runnable means any future statement can
 * be checked with one command rather than an argument from analogy.
 *
 * And the two are further apart than "unpdf is just pdfjs" suggests:
 *
 *   droplet   pdfjs-dist 6.2.108
 *   unpdf     pdfjs       4.6.82   (bundled inside unpdf@0.12.1)
 *
 * Two MAJOR versions. That they agree byte-for-byte on a real 35-page encrypted
 * statement is an empirical finding, not something the packaging guarantees —
 * pdfjs has changed text-item behaviour across majors before. Which is exactly
 * why this stays in the suite instead of being deleted once it went green.
 *
 * ## Running it
 *
 * Real statements are somebody's entire financial life and are never committed,
 * so the fixtures come from the environment and the suite skips without them:
 *
 *   CAS_FIXTURES="/path/one.pdf::password1,/path/two.pdf::password2" npx vitest run extractorEquivalence
 *
 * Skipping is deliberate: a developer without a client's CAS should still get a
 * green suite, and CI has no business holding one.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getDocumentProxy } from 'unpdf';
import { extractCasText } from './extract.js';

/** `path::password` pairs, comma separated. */
function fixtures(): { path: string; password: string }[] {
  const raw = process.env.CAS_FIXTURES?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => {
      const [path, password = ''] = entry.split('::');
      return { path: path.trim(), password };
    })
    .filter((f) => f.path && existsSync(f.path));
}

/**
 * The candidate extractor — what extract.ts becomes after the migration.
 *
 * The line-rebuilding loop is character-for-character the droplet's. Only the
 * document handle differs, which is the whole point: if this produces different
 * text, it is unpdf's doing and not a change in our logic.
 */
async function extractViaUnpdf(pdf: Buffer, password: string): Promise<string> {
  const LINE_TOLERANCE = 2;
  const doc = await getDocumentProxy(new Uint8Array(pdf), { password });

  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    for (const item of content.items as { str: string; transform: number[] }[]) {
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > LINE_TOLERANCE) out += '\n';
      out += item.str;
      lastY = y;
    }
    out += '\n';
  }
  return out;
}

/** Where two strings first diverge, with context — a diff you can act on. */
function firstDifference(a: string, b: string): string | null {
  if (a === b) return null;
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i++;
  const from = Math.max(0, i - 60);
  return [
    `diverges at character ${i} of ${a.length}/${b.length}`,
    `pdfjs: ${JSON.stringify(a.slice(from, i + 60))}`,
    `unpdf: ${JSON.stringify(b.slice(from, i + 60))}`,
  ].join('\n');
}

const found = fixtures();

describe.skipIf(found.length === 0)('unpdf extracts the same text as pdfjs-dist', () => {
  for (const { path, password } of found) {
    const name = path.split('/').pop();

    it(`matches byte-for-byte: ${name}`, async () => {
      const pdf = readFileSync(path);
      const [viaPdfjs, viaUnpdf] = await Promise.all([
        extractCasText(pdf, password),
        extractViaUnpdf(pdf, password),
      ]);

      // Reported before the assertion so a failure shows WHERE, not just that.
      const diff = firstDifference(viaPdfjs, viaUnpdf);
      if (diff) console.error(`\n${name}\n${diff}\n`);

      expect(viaUnpdf.length).toBe(viaPdfjs.length);
      expect(viaUnpdf).toBe(viaPdfjs);
    }, 120_000);

    it(`rejects a wrong password the same way: ${name}`, async () => {
      /*
       * Not a detail. A wrong password is the single most common failure a
       * client hits, and the message they get depends on this exception being
       * recognisable — import.ts turns `PasswordException` into "It is the
       * password you chose on the CAMS request form, not your PAN."
       *
       * If unpdf renamed or swallowed it, that guidance would silently become a
       * generic 500 and every confused client would be told nothing useful.
       */
      const pdf = readFileSync(path);

      const wrapped = await extractCasText(pdf, 'definitely-not-the-password').then(
        () => null,
        (e) => e as { name?: string },
      );
      const raw = await extractViaUnpdf(pdf, 'definitely-not-the-password').then(
        () => null,
        (e) => e as { name?: string },
      );

      /*
       * Compared at the right level. `extractCasText` already TRANSLATES the
       * exception, so it answers CasPasswordError while the bare candidate
       * answers whatever the library raised. What has to match is the name the
       * translation keys on — and unpdf raises the same `PasswordException`
       * pdfjs does, so the new extractor's catch fires unchanged.
       */
      expect(wrapped, 'pdfjs should reject a wrong password').not.toBeNull();
      expect(raw, 'unpdf should reject a wrong password').not.toBeNull();
      expect(raw?.name, 'the name the new extract.ts catches on').toBe('PasswordException');
      expect(wrapped?.name, 'the droplet translates it for the client').toBe('CasPasswordError');
    }, 120_000);

    it(`extracts something worth parsing: ${name}`, async () => {
      /*
       * A guard against the comparison passing vacuously. Two extractors that
       * both return an empty string agree perfectly and prove nothing — and a
       * wrong password does exactly that.
       */
      const text = await extractViaUnpdf(readFileSync(path), password);
      expect(text.length).toBeGreaterThan(1000);
      expect(/Folio No:/i.test(text)).toBe(true);
      expect(/INF[A-Z0-9]{9}/.test(text)).toBe(true);
    }, 120_000);
  }
});

describe.skipIf(found.length > 0)('extractor equivalence (skipped)', () => {
  it('needs CAS_FIXTURES to run', () => {
    // Present so the skip is visible in the output rather than silent — an
    // equivalence gate nobody notices is not a gate.
    expect(found).toHaveLength(0);
  });
});
