import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, ZoomIn } from 'lucide-react';

interface Props {
  file: File;
  onCancel: () => void;
  onApply: (blob: Blob) => void;
  busy?: boolean;
}

const VIEWPORT = 288; // px — the square crop window shown to the user
const OUTPUT = 512;   // px — exported avatar resolution
const MAX_ZOOM = 3;

/**
 * Square avatar cropper (pan + zoom), dependency-free.
 *
 * Coordinate model: at zoom 1 the image exactly *covers* the viewport
 * (baseScale). `zoom` (1..MAX_ZOOM) multiplies that. `offset` is the image's
 * top-left relative to the viewport's top-left, clamped so the image always
 * covers the square. On apply we map the visible square back to source pixels
 * and draw it onto an OUTPUT×OUTPUT canvas.
 */
export default function ImageCropModal({ file, onCancel, onApply, busy }: Props) {
  const [src, setSrc] = useState<string>('');
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  // Load the file into an object URL.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const baseScale = nat ? Math.max(VIEWPORT / nat.w, VIEWPORT / nat.h) : 1;
  const eff = baseScale * zoom;
  const dw = nat ? nat.w * eff : 0;
  const dh = nat ? nat.h * eff : 0;

  const clamp = useCallback((x: number, y: number, w: number, h: number) => ({
    x: Math.min(0, Math.max(VIEWPORT - w, x)),
    y: Math.min(0, Math.max(VIEWPORT - h, y)),
  }), []);

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const w = img.naturalWidth, h = img.naturalHeight;
    setNat({ w, h });
    const bs = Math.max(VIEWPORT / w, VIEWPORT / h);
    const iw = w * bs, ih = h * bs;
    setOffset({ x: (VIEWPORT - iw) / 2, y: (VIEWPORT - ih) / 2 }); // centered
  };

  // Re-clamp whenever zoom changes.
  useEffect(() => {
    if (!nat) return;
    setOffset(o => clamp(o.x, o.y, nat.w * baseScale * zoom, nat.h * baseScale * zoom));
  }, [zoom, nat, baseScale, clamp]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !nat) return;
    const nx = drag.current.ox + (e.clientX - drag.current.px);
    const ny = drag.current.oy + (e.clientY - drag.current.py);
    setOffset(clamp(nx, ny, dw, dh));
  };
  const onPointerUp = () => { drag.current = null; };

  const handleApply = () => {
    if (!nat) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // white backdrop so JPEG output has no black transparency
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, OUTPUT, OUTPUT);
    // Map the visible viewport square back into source-image pixels.
    const sx = -offset.x / eff;
    const sy = -offset.y / eff;
    const sSize = VIEWPORT / eff;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUTPUT, OUTPUT);
      canvas.toBlob(b => { if (b) onApply(b); }, 'image/jpeg', 0.9);
    };
    img.src = src;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-bold text-text-primary">Crop photo</h3>
          <button onClick={onCancel} disabled={busy} style={{ color: 'var(--text-faint)' }}><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4">
          {/* Crop viewport */}
          <div className="mx-auto relative select-none" style={{ width: VIEWPORT, height: VIEWPORT }}>
            <div
              className="absolute inset-0 overflow-hidden rounded-xl cursor-grab active:cursor-grabbing touch-none"
              style={{ border: '1px solid var(--border)' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {src && (
                <img
                  src={src}
                  alt="crop"
                  draggable={false}
                  onLoad={onImgLoad}
                  style={{ position: 'absolute', left: offset.x, top: offset.y, width: dw, height: dh, maxWidth: 'none' }}
                />
              )}
            </div>
            {/* Circular guide so admins frame a round avatar */}
            <div className="absolute inset-0 pointer-events-none rounded-full" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)', border: '2px solid rgba(255,255,255,0.6)' }} />
          </div>

          {/* Zoom */}
          <div className="flex items-center gap-3">
            <ZoomIn className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
            <input
              type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom}
              onChange={e => setZoom(parseFloat(e.target.value))}
              className="w-full" style={{ accentColor: 'var(--accent)' }}
            />
          </div>
          <p className="text-xs text-center" style={{ color: 'var(--text-faint)' }}>Drag to reposition · slide to zoom</p>

          <div className="flex justify-end gap-3 pt-1">
            <button onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-xl text-sm disabled:opacity-50" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
            <button onClick={handleApply} disabled={busy || !nat} className="px-5 py-2 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
              {busy ? 'Uploading…' : 'Apply & upload'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
