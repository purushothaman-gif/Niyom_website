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
 */
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export class CasPasswordError extends Error {
  constructor() {
    super('That password did not open the statement.');
    this.name = 'CasPasswordError';
  }
}

/** Baselines drift by sub-pixel amounts within a row; 2pt is comfortably inside a line height. */
const LINE_TOLERANCE = 2;

export async function extractCasText(pdf: Buffer, password: string): Promise<string> {
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(pdf),
      password,
      // No network fetches for fonts — this runs server-side on a box that
      // should not be reaching out to render a client's statement.
      useSystemFonts: true,
    }).promise;
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
  await doc.cleanup();
  return out;
}
