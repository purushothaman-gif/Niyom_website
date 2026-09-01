// The campaign body editor.
//
// A stack of typed blocks rather than a rich-text box. There is no WYSIWYG in
// this codebase, and adding one would mean storing admin-authored HTML that is
// then delivered to every client — the shape of trust behind the debit-note XSS
// closed on 2026-08-09. Blocks keep the composer expressive (headings, bullets,
// buttons, images) while leaving the renderer in sole charge of the markup.

import { useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, Heading, Image as ImageIcon, Link2, List, Minus, Plus, Trash2, Type,
} from 'lucide-react';
import type { MailBlock } from '../mailTypes';
import { GhostButton } from '../../ui/kit';
import ImageLibrary from './ImageLibrary';

const inputClass =
  'w-full px-3 py-2 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[var(--accent-soft)] transition';
const inputStyle = { background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' };

const ADD_OPTIONS: { type: MailBlock['type']; label: string; icon: typeof Type }[] = [
  { type: 'paragraph', label: 'Text', icon: Type },
  { type: 'heading', label: 'Heading', icon: Heading },
  { type: 'bullets', label: 'Bullets', icon: List },
  { type: 'button', label: 'Button', icon: Link2 },
  { type: 'image', label: 'Image', icon: ImageIcon },
  { type: 'divider', label: 'Divider', icon: Minus },
];

function emptyBlock(type: MailBlock['type']): MailBlock {
  switch (type) {
    case 'heading': return { type: 'heading', text: '' };
    case 'bullets': return { type: 'bullets', items: [''] };
    case 'button': return { type: 'button', label: '', url: '' };
    case 'image': return { type: 'image', url: '', alt: '' };
    case 'divider': return { type: 'divider' };
    default: return { type: 'paragraph', text: '' };
  }
}

interface Props {
  blocks: MailBlock[];
  onChange: (blocks: MailBlock[]) => void;
  disabled?: boolean;
}

export default function BlockEditor({ blocks, onChange, disabled }: Props) {
  const [picking, setPicking] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (i: number, b: MailBlock) => onChange(blocks.map((x, j) => (j === i ? b : x)));
  const add = (type: MailBlock['type']) => onChange([...blocks, emptyBlock(type)]);
  const remove = (i: number) => onChange(blocks.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {blocks.length === 0 && (
        <div className="rounded-xl px-4 py-8 text-center text-sm"
          style={{ background: 'var(--bg-surface)', border: '1px dashed var(--border)', color: 'var(--text-muted)' }}>
          Nothing here yet. Add a block below, or generate a draft from a few keywords.
        </div>
      )}

      {blocks.map((b, i) => (
        <div key={i} className="rounded-xl p-3"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              {b.type}
            </span>
            <div className="flex items-center gap-1">
              <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)}
                className="p-1.5 rounded-lg disabled:opacity-30" style={{ color: 'var(--text-muted)' }} title="Move up">
                <ArrowUp size={14} />
              </button>
              <button type="button" disabled={disabled || i === blocks.length - 1} onClick={() => move(i, 1)}
                className="p-1.5 rounded-lg disabled:opacity-30" style={{ color: 'var(--text-muted)' }} title="Move down">
                <ArrowDown size={14} />
              </button>
              <button type="button" disabled={disabled} onClick={() => remove(i)}
                className="p-1.5 rounded-lg disabled:opacity-30" style={{ color: 'rgb(239,68,68)' }} title="Remove">
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {b.type === 'heading' && (
            <input className={inputClass} style={inputStyle} disabled={disabled} value={b.text}
              placeholder="Section heading"
              onChange={(e) => set(i, { type: 'heading', text: e.target.value })} />
          )}

          {b.type === 'paragraph' && (
            <textarea className={inputClass} style={{ ...inputStyle, minHeight: 96 }} disabled={disabled} value={b.text}
              placeholder="Write the paragraph. **bold**, *italic* and [link](https://…) work here."
              onChange={(e) => set(i, { type: 'paragraph', text: e.target.value })} />
          )}

          {b.type === 'bullets' && (
            <div className="space-y-2">
              {b.items.map((item, k) => (
                <div key={k} className="flex gap-2">
                  <input className={inputClass} style={inputStyle} disabled={disabled} value={item}
                    placeholder={`Point ${k + 1}`}
                    onChange={(e) => set(i, { type: 'bullets', items: b.items.map((x, m) => (m === k ? e.target.value : x)) })} />
                  <button type="button" disabled={disabled || b.items.length === 1}
                    onClick={() => set(i, { type: 'bullets', items: b.items.filter((_, m) => m !== k) })}
                    className="p-2 rounded-lg disabled:opacity-30" style={{ color: 'var(--text-muted)' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <GhostButton type="button" disabled={disabled}
                onClick={() => set(i, { type: 'bullets', items: [...b.items, ''] })}>
                <Plus size={13} /> Add point
              </GhostButton>
            </div>
          )}

          {b.type === 'button' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <input className={inputClass} style={inputStyle} disabled={disabled} value={b.label}
                placeholder="Button label" onChange={(e) => set(i, { ...b, label: e.target.value })} />
              <input className={inputClass} style={inputStyle} disabled={disabled} value={b.url}
                placeholder="https://…" onChange={(e) => set(i, { ...b, url: e.target.value })} />
            </div>
          )}

          {b.type === 'image' && (
            <div className="space-y-2">
              {b.url && (
                <img src={b.url} alt="" className="rounded-lg max-h-40 object-contain"
                  style={{ border: '1px solid var(--border)' }} />
              )}
              <div className="flex gap-2">
                <input className={inputClass} style={inputStyle} disabled={disabled} value={b.url}
                  placeholder="Image URL" onChange={(e) => set(i, { ...b, url: e.target.value })} />
                <GhostButton type="button" disabled={disabled} onClick={() => setPicking(i)}>
                  <ImageIcon size={13} /> Library
                </GhostButton>
              </div>
              <input className={inputClass} style={inputStyle} disabled={disabled} value={b.alt}
                placeholder="Alt text — shown when images are blocked, so make it meaningful"
                onChange={(e) => set(i, { ...b, alt: e.target.value })} />
            </div>
          )}

          {b.type === 'divider' && (
            <div className="h-px my-2" style={{ background: 'var(--border)' }} />
          )}
        </div>
      ))}

      <div className="flex flex-wrap gap-2 pt-1">
        {ADD_OPTIONS.map(({ type, label, icon: Icon }) => (
          <GhostButton key={type} type="button" disabled={disabled} onClick={() => add(type)}>
            <Icon size={13} /> {label}
          </GhostButton>
        ))}
      </div>

      <input ref={fileRef} type="file" accept="image/*" hidden />

      {picking !== null && (
        <ImageLibrary
          onClose={() => setPicking(null)}
          onPick={(url) => {
            const b = blocks[picking];
            if (b?.type === 'image') set(picking, { ...b, url });
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}
