/**
 * Unlock password-protected PDFs at upload time.
 *
 * Bank statements, CML copies and CAS files usually arrive locked. Stored that
 * way, nobody in the CRM can open them later without chasing the client for
 * the password. So before upload:
 *   1. detect the lock (cheap byte scan — pdf.js is only loaded when needed);
 *   2. try the passwords the issuer most likely used (pdfPasswordCandidates);
 *   3. failing that, ask the uploader once (and again if it's wrong);
 *   4. store an UNLOCKED copy. The password itself is never stored.
 *
 * The unlocked copy is re-drawn page by page (pdf.js → JPEG → jsPDF), because
 * no browser library writes a decrypted PDF. Pages look identical; text is no
 * longer selectable, which is fine for KYC evidence.
 *
 * Web only (Vite worker URL); the mobile app does not import this.
 */
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export type AskPassword = (fileName: string, wrongAttempt: boolean) => Promise<string | null>;

export type UnlockOutcome =
  | { status: 'not-locked'; file: File }
  | { status: 'unlocked'; file: File; automatic: boolean }
  | { status: 'skipped'; file: File }; // uploader declined to give a password

const RENDER_SCALE = 2; // ≈144 dpi — sharp enough to read small print
const JPEG_QUALITY = 0.85;

function looksLikePdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** True if the PDF declares an /Encrypt dictionary (any PDF version). */
export async function isEncryptedPdf(file: File): Promise<boolean> {
  if (!looksLikePdf(file)) return false;
  const bytes = new Uint8Array(await file.arrayBuffer());
  // latin1 keeps a 1:1 byte→char mapping, so indexOf works on raw bytes.
  const text = new TextDecoder('latin1').decode(bytes);
  return text.includes('/Encrypt');
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

/**
 * Open with the candidates first, then ask. Resolves to the opened document
 * and whether a human had to type the password, or null if they declined.
 */
async function openLocked(
  file: File,
  candidates: string[],
  ask: AskPassword,
) {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  let i = 0;
  let asked = false;
  let declined = false;
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    if (i < candidates.length) { update(candidates[i++]); return; }
    const wrong = asked && reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
    asked = true;
    void ask(file.name, wrong).then((pw) => {
      if (pw === null) { declined = true; void task.destroy(); }
      else update(pw);
    });
  };
  try {
    const doc = await task.promise;
    return { doc, automatic: !asked };
  } catch (err) {
    if (declined) return null;
    throw err;
  }
}

/** Re-draw every page into a new, unprotected PDF. */
async function redraw(doc: import('pdfjs-dist').PDFDocumentProxy, name: string): Promise<File> {
  const { jsPDF } = await import('jspdf');
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });           // PDF points
    const vp = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const img = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    const orientation = base.width > base.height ? 'landscape' : 'portrait';
    if (!pdf) pdf = new jsPDF({ unit: 'pt', format: [base.width, base.height], orientation, compress: true });
    else pdf.addPage([base.width, base.height], orientation);
    pdf.addImage(img, 'JPEG', 0, 0, base.width, base.height);
    page.cleanup();
    canvas.width = canvas.height = 0; // release memory early on long statements
  }
  await doc.loadingTask.destroy();
  if (!pdf) throw new Error('The PDF has no pages.');
  return new File([pdf.output('blob')], name, { type: 'application/pdf', lastModified: Date.now() });
}

/**
 * The one call upload code needs. Never throws for a normal locked/unlocked
 * file; a genuinely broken PDF is passed through unchanged (the upload goes on
 * exactly as before this feature existed).
 */
export async function unlockPdfForUpload(
  file: File,
  candidates: string[],
  ask: AskPassword,
): Promise<UnlockOutcome> {
  try {
    if (!(await isEncryptedPdf(file))) return { status: 'not-locked', file };
    const opened = await openLocked(file, candidates, ask);
    if (!opened) return { status: 'skipped', file };
    const out = await redraw(opened.doc, file.name);
    return { status: 'unlocked', file: out, automatic: opened.automatic };
  } catch (err) {
    console.warn('PDF unlock failed; uploading the original', err);
    return { status: 'not-locked', file };
  }
}
