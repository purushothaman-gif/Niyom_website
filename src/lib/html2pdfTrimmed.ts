/**
 * html2pdf without the empty trailing page.
 *
 * html2pdf captures the element as ONE tall canvas and slices it into A4
 * pages. When a one-page document runs even a few pixels past A4 (an extra
 * address line, bottom padding), the slice after it is pure white — and it
 * still becomes a page. 123 payment receipts and 23 debit notes were stored
 * with a blank page 2 that way.
 *
 * Fix: capture the canvas, find the last row with any ink, and crop the white
 * tail before slicing — so a page is only added when it has content. A
 * document with real content on page 2 is untouched.
 *
 * Use like html2pdf for A4 portrait with margin 0:
 *   await (await html2pdfTrimmed(opt, el)).worker.outputPdf('blob');
 *
 * The worker is returned INSIDE an object on purpose: it is a thenable, and
 * returning it bare from an async function would make `await` run the whole
 * job and discard the worker.
 */
type Html2Pdf = typeof import('html2pdf.js').default;
// The package's own typings: the factory is overloaded, so take the worker
// type from its Worker constructor rather than ReturnType (last overload).
type Html2PdfWorker = InstanceType<Html2Pdf['Worker']>;
type Html2PdfOptions = Parameters<Html2PdfWorker['set']>[0];

/** A pixel counts as ink when any channel is darker than this. */
const INK = 240;
/** White kept below the last ink, so nothing touches the page edge. */
const PAD_PX = 24;
const A4_RATIO = 297 / 210;

/** Last row (0-based) containing a non-white pixel; -1 if the canvas is blank. */
export function lastInkRow(data: Uint8ClampedArray, width: number, height: number): number {
  const step = 3; // sample every 3rd column: hairlines are wider than 3px at 2x scale
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += step) {
      const i = row + x * 4;
      if (data[i + 3] > 0 && (data[i] < INK || data[i + 1] < INK || data[i + 2] < INK)) return y;
    }
  }
  return -1;
}

/**
 * Height to keep: just past the last ink, but never past the end of the page
 * that ink is on (so the page count is exactly what the content needs).
 */
export function trimmedHeight(canvasHeight: number, canvasWidth: number, inkRow: number): number {
  if (inkRow < 0) return canvasHeight;
  const pagePx = Math.floor(canvasWidth * A4_RATIO);
  const pagesNeeded = Math.max(1, Math.ceil((inkRow + 1) / pagePx));
  const pageEnd = pagesNeeded * pagePx - 2; // stay clear of a rounding-induced extra page
  return Math.min(canvasHeight, Math.max(inkRow + 1, Math.min(inkRow + 1 + PAD_PX, pageEnd)));
}

export async function html2pdfTrimmed(opt: Html2PdfOptions, el: HTMLElement): Promise<{ worker: Html2PdfWorker }> {
  // Loaded on demand: html2pdf + jsPDF + html2canvas are heavy (payslips rely on this).
  const { default: html2pdf } = await import('html2pdf.js');
  const canvas: HTMLCanvasElement = await html2pdf().set(opt).from(el).toCanvas().get('canvas');
  let source = canvas;
  const ctx = canvas.getContext('2d');
  if (ctx && canvas.width > 0 && canvas.height > 0) {
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const keep = trimmedHeight(canvas.height, canvas.width, lastInkRow(data, canvas.width, canvas.height));
    if (keep < canvas.height) {
      const cropped = document.createElement('canvas');
      cropped.width = canvas.width;
      cropped.height = keep;
      const c2 = cropped.getContext('2d');
      if (c2) {
        c2.drawImage(canvas, 0, 0);
        source = cropped;
      }
    }
  }
  // Say 'canvas' explicitly (html2pdf then skips html2canvas); the package's
  // typings omit from()'s second parameter, which the runtime accepts.
  const w = html2pdf().set(opt) as unknown as { from(src: HTMLCanvasElement, type: 'canvas'): Html2PdfWorker };
  return { worker: w.from(source, 'canvas') };
}
