/**
 * What happens on screen in each UI scene.
 *
 * Every act drives the real portal — nothing here is a mockup. Acts are written
 * to run close to the length of their narration; a scene that finishes early
 * simply holds, and one that overruns extends the cut with silence, so the
 * pacing here is the pacing of the film.
 */
import type { Page } from 'playwright';
import type { Pointer } from './cursor.js';

export interface Stage {
  page: Page;
  p: Pointer;
  /** The vertical cut drives the phone layout, where nav lives in a drawer. */
  mobile: boolean;
}

export type Act = (s: Stage) => Promise<void>;

/** Sidebar on desktop, drawer on the phone. */
async function goToView({ page, p, mobile }: Stage, label: string): Promise<void> {
  if (mobile) {
    await p.click(page.getByRole('button', { name: 'Open navigation' }));
    await page.waitForTimeout(520);
  }
  await p.click(page.getByRole('button', { name: label, exact: true }));
  await page.waitForTimeout(mobile ? 900 : 650);
}

/**
 * Close whatever modal is open.
 *
 * The partner modals close on their X or on a backdrop click — Escape is not
 * wired up, and silently doing nothing is exactly the failure that leaves the
 * next scene shooting through a dimmed overlay.
 */
async function closeModal({ page, p }: Stage): Promise<void> {
  const x = page.locator('button:has(svg.lucide-x)').last();
  if (await x.isVisible().catch(() => false)) {
    await p.click(x);
  } else {
    await page.mouse.click(60, 90);
  }
  await page.waitForTimeout(450);
}

/** A readable scroll — several small wheel steps rather than one jump. */
async function glide(page: Page, total: number, steps = 8, pause = 130): Promise<void> {
  const per = Math.round(total / steps);
  for (let i = 0; i < steps; i += 1) {
    await page.mouse.wheel(0, per);
    await page.waitForTimeout(pause);
  }
}

export const ACTS: Record<string, Act> = {
  /**
   * Doubles as the sign-in for the whole session, so the landscape cut opens on
   * the real login rather than a reconstruction of it.
   */
  login: async ({ page, p }) => {
    await page.waitForTimeout(700);
    await p.type(page.getByPlaceholder('ABCDE1234F'), 'NIYOM1234D', 65);
    await page.waitForTimeout(200);
    await p.type(page.getByPlaceholder('Your password'), 'NiyomDemo@2026', 42);
    await page.waitForTimeout(320);
    await p.click(page.getByRole('button', { name: 'Sign In', exact: true }));
    await page.waitForSelector('text=Welcome,', { timeout: 20000 });
    await page.waitForTimeout(1400);
  },

  dashboard: async ({ page, p, mobile }) => {
    await page.waitForTimeout(900);
    if (mobile) {
      await glide(page, 900, 10, 150);
      await page.waitForTimeout(700);
      await glide(page, 700, 8, 150);
    } else {
      // Walk the earnings tiles, then reveal the business tiles below.
      await p.moveTo(560, 430, 24);
      await page.waitForTimeout(520);
      await p.moveTo(1080, 430, 22);
      await page.waitForTimeout(520);
      await glide(page, 620, 8, 140);
      await page.waitForTimeout(1500);
    }
  },

  /**
   * Runs the flow to its success state and closes up, so the next scene starts
   * on a clean dashboard rather than behind an open modal.
   */
  onboard: async ({ page, p }) => {
    await p.click(page.getByRole('button', { name: 'Onboard a client' }));
    await page.getByPlaceholder('ABCDE1234F').waitFor({ timeout: 10000 });
    await page.waitForTimeout(450);

    await p.type(page.getByPlaceholder('ABCDE1234F'), 'ABCDE1234F', 50);
    await page.waitForTimeout(160);
    await p.click(page.getByRole('button', { name: 'Verify', exact: true }));
    // The PAN gate answers with the legal name, which fills the name field.
    await page.getByPlaceholder('10-digit mobile').waitFor({ timeout: 10000 });
    await page.waitForTimeout(700);

    await p.type(page.getByPlaceholder('10-digit mobile'), '9840012345', 30);
    await page.waitForTimeout(140);
    await p.type(page.getByPlaceholder('name@example.com'), 'priya@example.com', 22);
    await page.waitForTimeout(240);

    await p.click(page.getByRole('button', { name: 'Onboard client', exact: true }));
    await page.getByText('Client onboarded').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1800);
    await p.click(page.getByRole('button', { name: 'Done', exact: true }));
    await page.waitForTimeout(600);
    if (await page.locator('button:has(svg.lucide-x)').last().isVisible().catch(() => false)) {
      await closeModal({ page, p, mobile: false });
    }
  },

  clients: async ({ page, p, mobile }) => {
    await goToView({ page, p, mobile }, 'My Clients');
    await page.waitForTimeout(700);
    await p.click(page.getByText('ANAND KRISHNAMURTHY').first());
    await page.waitForTimeout(1800);
    await glide(page, mobile ? 700 : 480, 7, 140);
    await page.waitForTimeout(1100);
  },

  bonds: async ({ page, p, mobile }) => {
    await goToView({ page, p, mobile }, 'Bonds');
    await page.waitForTimeout(900);
    const markup = page.locator('input[type="number"]').first();
    await markup.scrollIntoViewIfNeeded();
    const box = await markup.boundingBox();
    if (box) {
      await p.moveTo(box.x + box.width / 2, box.y + box.height / 2, 22);
      await page.waitForTimeout(260);
      await markup.click({ clickCount: 3 });
      await markup.type('3', { delay: 90 });
    }
    await page.waitForTimeout(260);
    await p.click(page.getByRole('button', { name: 'Save', exact: true }));
    await page.waitForTimeout(1600);
    await glide(page, mobile ? 600 : 420, 7, 140);
    await page.waitForTimeout(900);
  },

  'bond-actions': async ({ page, p, mobile }) => {
    await p.click(page.getByRole('button', { name: /View details/ }));
    await page.getByText('Your pricing').first().waitFor({ timeout: 12000 });
    await page.waitForTimeout(mobile ? 1000 : 700);

    await p.click(page.getByRole('button', { name: 'Share', exact: true }));
    await page.getByText('Share with a client').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(450);
    await p.click(page.getByRole('button', { name: /Generate link/ }));
    await page.waitForTimeout(1600);
    await closeModal({ page, p, mobile });

    await p.click(page.getByRole('button', { name: /Marketing image/ }));
    await page.getByText('Include Niyom branding').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(650);
    // The branding switch only — Brochure/Promo would start a download.
    await p.click(page.getByText('Include Niyom branding').first());
    await page.waitForTimeout(1400);
    await closeModal({ page, p, mobile });
  },

  payouts: async ({ page, p, mobile }) => {
    await goToView({ page, p, mobile }, 'Payouts & Statements');
    await page.waitForTimeout(1000);
    if (!mobile) {
      await p.moveTo(600, 400, 22);
      await page.waitForTimeout(450);
      await p.moveTo(1150, 400, 22);
      await page.waitForTimeout(450);
    }
    await glide(page, mobile ? 900 : 560, 8, 145);
    await page.waitForTimeout(1600);
  },

  referral: async ({ page, p, mobile }) => {
    await goToView({ page, p, mobile }, 'Referral Link');
    await page.waitForTimeout(900);
    await p.click(page.getByRole('button', { name: /^Copy/ }));
    await page.waitForTimeout(1500);
    await glide(page, mobile ? 700 : 420, 7, 140);
    await page.waitForTimeout(1200);
  },
};
