import { describe, expect, it } from 'vitest';
import { lastInkRow, trimmedHeight } from './html2pdfTrimmed';

/** width x height RGBA canvas data, white, with dark rows at the given y's. */
function canvas(width: number, height: number, inkRows: number[]) {
  const d = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const y of inkRows) for (let x = 0; x < width; x++) { const i = (y * width + x) * 4; d[i] = d[i + 1] = d[i + 2] = 20; }
  return d;
}

describe('lastInkRow', () => {
  it('finds the last dark row', () => {
    expect(lastInkRow(canvas(30, 100, [5, 60]), 30, 100)).toBe(60);
  });
  it('returns -1 for a blank canvas', () => {
    expect(lastInkRow(canvas(30, 100, []), 30, 100)).toBe(-1);
  });
  it('ignores near-white (anti-aliasing / off-white)', () => {
    const d = canvas(30, 100, [10]);
    for (let x = 0; x < 30; x++) { const i = (90 * 30 + x) * 4; d[i] = d[i + 1] = d[i + 2] = 248; }
    expect(lastInkRow(d, 30, 100)).toBe(10);
  });
});

describe('trimmedHeight', () => {
  const W = 1588; const page = Math.floor(W * 297 / 210); // ≈ 2245

  it('cuts a white tail that spilled onto page 2', () => {
    const h = trimmedHeight(page + 40, W, page - 300);
    expect(h).toBeLessThan(page);
    expect(Math.ceil(h / page)).toBe(1);
  });
  it('keeps real page-2 content', () => {
    const h = trimmedHeight(page * 2, W, page + 500);
    expect(Math.ceil(h / page)).toBe(2);
    expect(h).toBeGreaterThan(page + 500);
  });
  it('never grows the canvas, and leaves blank canvases alone', () => {
    expect(trimmedHeight(500, W, 490)).toBe(500);
    expect(trimmedHeight(page + 40, W, -1)).toBe(page + 40);
  });
});
