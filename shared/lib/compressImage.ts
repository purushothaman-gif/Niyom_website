/**
 * Shrink a KYC/document photo in the browser before it is uploaded.
 *
 * Phone photos of a PAN card or cheque arrive at 3–8 MB; 2000px on the long
 * edge at JPEG 0.85 keeps every character legible at ~200–400 KB.
 *
 * Rules:
 *  - Only JPEG / PNG / WEBP images above MIN_BYTES are touched. PDFs, HEIC
 *    (browsers can't decode it on a canvas) and small files pass through.
 *  - PNG becomes JPEG (photos saved as PNG are the worst offenders) and the
 *    returned File is renamed `.jpg` — derive storage paths from the RETURNED
 *    file's name, or use `swapExt`.
 *  - `keepType: true` keeps the original format and name: for "replace in
 *    place" uploads whose storage path is already fixed.
 *  - Never makes a file bigger, never throws: any failure returns the original.
 *  - Outside a browser (React Native) it is a no-op.
 */

const MAX_EDGE = 2000;
const QUALITY = 0.85;
const MIN_BYTES = 300 * 1024;
const COMPRESSIBLE = ['image/jpeg', 'image/png', 'image/webp'];

export async function compressImageFile(file: File, opts: { keepType?: boolean } = {}): Promise<File> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return file;
  if (!COMPRESSIBLE.includes(file.type) || file.size < MIN_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    const outType = opts.keepType ? file.type : (file.type === 'image/webp' ? 'image/webp' : 'image/jpeg');
    if (outType === 'image/jpeg') {
      // JPEG has no alpha: paint white so transparent PNG areas don't go black.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, outType, QUALITY));
    if (!blob || blob.size >= file.size) return file;

    const name = outType === file.type ? file.name : swapExt(file.name, '.jpg');
    return new File([blob], name, { type: outType, lastModified: file.lastModified });
  } catch {
    return file;
  }
}

/** Replace a path's extension with another file name's (or a literal ".ext"). */
export function swapExt(path: string, extOrName: string): string {
  const dot = extOrName.lastIndexOf('.');
  const ext = dot >= 0 ? extOrName.slice(dot) : '';
  const slash = path.lastIndexOf('/');
  const pDot = path.lastIndexOf('.');
  return pDot > slash ? path.slice(0, pDot) + ext : path + ext;
}
