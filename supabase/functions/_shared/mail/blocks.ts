// The campaign body format.
//
// A campaign body is a LIST OF BLOCKS, not HTML. Two reasons, both of which
// ruled out the obvious alternative of a rich-text editor writing HTML:
//
//   1. Safety. Admin-authored HTML would be stored and then delivered to every
//      client's inbox. The debit-note XSS closed on 2026-08-09 came from
//      exactly that shape of trust. Blocks carry only text and URLs, and the
//      renderer escapes both, so there is no path from the composer to markup.
//
//   2. Email clients. Outlook renders through Word and ignores modern layout
//      entirely, so the delivered HTML has to be nested tables with inline
//      styles. No WYSIWYG produces that, and hand-written HTML from a composer
//      would break the moment someone pasted from a browser. Blocks let the
//      renderer own the table scaffolding completely.
//
// Inline emphasis inside `text` uses a deliberately tiny markdown subset —
// **bold**, *italic*, [label](https://…) — parsed by the renderer after
// escaping, so the markup can only ever produce the three tags it knows.

export type MailBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'button'; label: string; url: string }
  | { type: 'image'; url: string; alt: string; href?: string }
  | { type: 'divider' };

export type MailAudience = 'client' | 'partner';

export const BLOCK_TYPES: MailBlock['type'][] = [
  'heading', 'paragraph', 'bullets', 'button', 'image', 'divider',
];

/** Narrow unknown jsonb from the database into a block list, dropping anything
 *  unrecognised rather than trusting the column's shape. */
export function parseBlocks(raw: unknown): MailBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: MailBlock[] = [];
  for (const b of raw) {
    if (!b || typeof b !== 'object') continue;
    const t = (b as { type?: unknown }).type;
    const str = (k: string): string => {
      const v = (b as Record<string, unknown>)[k];
      return typeof v === 'string' ? v : '';
    };
    switch (t) {
      case 'heading':   out.push({ type: 'heading', text: str('text') }); break;
      case 'paragraph': out.push({ type: 'paragraph', text: str('text') }); break;
      case 'bullets': {
        const items = (b as { items?: unknown }).items;
        out.push({
          type: 'bullets',
          items: Array.isArray(items) ? items.filter((i): i is string => typeof i === 'string') : [],
        });
        break;
      }
      case 'button': out.push({ type: 'button', label: str('label'), url: str('url') }); break;
      case 'image': {
        const href = str('href');
        out.push({ type: 'image', url: str('url'), alt: str('alt'), ...(href ? { href } : {}) });
        break;
      }
      case 'divider': out.push({ type: 'divider' }); break;
      default: break;
    }
  }
  return out;
}

/** Every text field a block can carry, for compliance linting and previews. */
export function blockText(blocks: MailBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
      case 'paragraph': parts.push(b.text); break;
      case 'bullets':   parts.push(b.items.join(' ')); break;
      case 'button':    parts.push(b.label); break;
      case 'image':     parts.push(b.alt); break;
      case 'divider':   break;
    }
  }
  return parts.join('\n');
}
