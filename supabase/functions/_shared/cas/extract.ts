/**
 * CAS PDF -> text.
 *
 * CAS files are always encrypted, with a password the investor chooses when
 * requesting the statement — NOT their PAN, which is a common and wrong
 * assumption. The client must therefore supply it along with the file.
 *
 * Text is rebuilt line by line from item positions rather than taken from a
 * naive concatenation: the parser relies on holdings arriving as separate
 * lines, and pdf.js emits items in reading order with no newlines of its own.
 * Items whose baseline (transform[5]) differs from the previous one start a
 * new line; anything on the same baseline is a continuation of that row.
 *
 * ## Why unpdf and not pdfjs-dist
 *
 * This module used to import `pdfjs-dist` directly, on the droplet. It cannot
 * do that here: a static import of pdfjs-dist kills a Supabase Edge worker at
 * BOOT — before any PDF is touched — reporting only `WORKER_ERROR` with no
 * stack. Verified against an identical control function with no PDF library,
 * which returns 200 in under a second.
 *
 * `unpdf` is pdfjs repackaged with the Node and DOM assumptions stripped out,
 * and it boots. The line-rebuilding below is character-for-character what ran
 * on the droplet, because the migration must not change what the parser reads.
 *
 * That the two agree is PROVEN, not assumed — and it needed proving, because
 * unpdf bundles pdfjs 4.6.82 while the droplet ran 6.2.108, two major versions
 * apart. `extractorEquivalence.test.ts` diffs both extractors over a real
 * encrypted statement byte-for-byte. Run it against any new registrar's PDF
 * before trusting this on one.
 *
 * The specifier is bare (`unpdf`, not `npm:unpdf@...`) so this one file works
 * under both Deno — via the import map in each function's deno.json — and
 * vitest, which resolves it from node_modules. A versioned npm: specifier here
 * would make the module unimportable by the test suite.
 */
import { getDocumentProxy } from 'unpdf';

export class CasPasswordError extends Error {
  constructor() {
    super('That password did not open the statement.');
    this.name = 'CasPasswordError';
  }
}

/** Baselines drift by sub-pixel amounts within a row; 2pt is comfortably inside a line height. */
const LINE_TOLERANCE = 2;

export async function extractCasText(pdf: Uint8Array, password: string): Promise<string> {
  let doc;
  try {
    doc = await getDocumentProxy(pdf, { password });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'PasswordException') throw new CasPasswordError();
    throw err;
  }

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
