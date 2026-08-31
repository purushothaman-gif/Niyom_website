/**
 * A visible pointer.
 *
 * Headless Chromium draws no cursor, and the screencast captures only what the
 * page paints — so an un-augmented recording shows menus opening and fields
 * filling with nothing causing it. This injects a gold dot that tracks real
 * mouse events (so it can never desync from where clicks actually land) and a
 * ripple on press.
 */
import type { Locator, Page } from 'playwright';
import { BRAND } from './brand.js';

export const CURSOR_INIT = (accent: string, soft: string) => `
(() => {
  const style = document.createElement('style');
  style.textContent = \`
    #nw-cursor {
      position: fixed; left: 0; top: 0; width: 22px; height: 22px;
      margin: -11px 0 0 -11px; border-radius: 50%;
      background: radial-gradient(circle at 35% 35%, ${soft}, ${accent});
      box-shadow: 0 0 0 3px rgba(200,164,93,0.28), 0 6px 18px rgba(0,0,0,0.45);
      pointer-events: none; z-index: 2147483647; opacity: 0;
      transition: opacity 180ms ease, transform 90ms ease;
    }
    #nw-cursor.on { opacity: 1; }
    #nw-cursor.press { transform: scale(0.72); }
    .nw-ripple {
      position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px;
      border-radius: 50%; border: 2px solid ${accent};
      pointer-events: none; z-index: 2147483646;
      animation: nw-ripple 620ms cubic-bezier(0.22,0.61,0.36,1) forwards;
    }
    @keyframes nw-ripple {
      from { transform: scale(1); opacity: 0.85; }
      to   { transform: scale(4.2); opacity: 0; }
    }
  \`;
  const attach = () => {
    if (document.getElementById('nw-cursor')) return;
    document.head.appendChild(style);
    const dot = document.createElement('div');
    dot.id = 'nw-cursor';
    document.body.appendChild(dot);
    addEventListener('mousemove', (e) => {
      dot.classList.add('on');
      dot.style.transform = dot.classList.contains('press') ? 'scale(0.72)' : '';
      dot.style.left = e.clientX + 'px';
      dot.style.top = e.clientY + 'px';
    }, true);
    addEventListener('mousedown', (e) => {
      dot.classList.add('press');
      const r = document.createElement('div');
      r.className = 'nw-ripple';
      r.style.left = e.clientX + 'px';
      r.style.top = e.clientY + 'px';
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 700);
    }, true);
    addEventListener('mouseup', () => dot.classList.remove('press'), true);
  };
  if (document.body) attach();
  else addEventListener('DOMContentLoaded', attach);
})();
`;

export async function installCursor(page: Page): Promise<void> {
  await page.addInitScript(CURSOR_INIT(BRAND.accent, BRAND.accentSoft));
}

/**
 * Mouse helper with human-ish pacing. Every click travels to its target first,
 * so the viewer's eye can follow — an instant click reads as a glitch.
 */
export class Pointer {
  private x = 0;
  private y = 0;

  constructor(private readonly page: Page) {}

  async moveTo(x: number, y: number, steps = 28): Promise<void> {
    await this.page.mouse.move(x, y, { steps });
    this.x = x;
    this.y = y;
  }

  async park(x: number, y: number): Promise<void> {
    await this.moveTo(x, y, 12);
  }

  private resolve(target: Locator | string): Locator {
    return (typeof target === 'string' ? this.page.locator(target) : target).first();
  }

  /** Move to an element's centre, pause, then click it. */
  async click(target: Locator | string, opts: { settle?: number } = {}): Promise<void> {
    const el = this.resolve(target);
    await el.waitFor({ state: 'visible', timeout: 15000 });
    await el.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(180);
    const box = await el.boundingBox();
    if (!box) throw new Error(`no bounding box for ${el}`);
    await this.moveTo(box.x + box.width / 2, box.y + box.height / 2);
    await this.page.waitForTimeout(opts.settle ?? 260);
    await this.page.mouse.down();
    await this.page.waitForTimeout(70);
    await this.page.mouse.up();
  }

  /** Click, then type at a readable pace so the field is seen filling. */
  async type(target: Locator | string, text: string, delay = 55): Promise<void> {
    await this.click(target);
    await this.page.waitForTimeout(160);
    await this.resolve(target).pressSequentially(text, { delay });
  }

  get position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }
}
