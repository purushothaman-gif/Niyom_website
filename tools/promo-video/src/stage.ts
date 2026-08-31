/**
 * The vocabulary every film's acts are written in.
 *
 * Extracted from the partner film when the client film arrived: the two drive
 * different products with different navigation, but they scroll, close modals
 * and pace clicks identically, and those helpers are what make an act read like
 * a shot list instead of a Playwright script.
 */
import type { Page } from 'playwright';
import type { Pointer } from './cursor.js';

export interface Stage {
  page: Page;
  p: Pointer;
  /** The vertical cut drives the phone layout, where navigation differs. */
  mobile: boolean;
}

export type Act = (s: Stage) => Promise<void>;

/** A readable scroll — several small wheel steps rather than one jump. */
export async function glide(page: Page, total: number, steps = 8, pause = 130): Promise<void> {
  const per = Math.round(total / steps);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, per);
    await page.waitForTimeout(pause);
  }
}

/**
 * Close whatever modal is open.
 *
 * Both portals close their modals on an X or a backdrop click — Escape is not
 * wired up, and silently doing nothing is exactly the failure that leaves the
 * next scene shooting through a dimmed overlay.
 */
export async function closeModal({ page, p }: Stage): Promise<void> {
  const x = page.locator('button:has(svg.lucide-x)').last();
  if (await x.isVisible().catch(() => false)) {
    await p.click(x);
  } else {
    await page.mouse.click(60, 90);
  }
  await page.waitForTimeout(450);
}
