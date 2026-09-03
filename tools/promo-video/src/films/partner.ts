/**
 * The partner film — recruiting distribution partners to the DSA portal.
 *
 * Scenes and acts live together because they are one document: the narration
 * describes what the act does, and changing either without the other puts the
 * voice out of step with the picture.
 */
import type * as pw from 'playwright';
import { BOTH, LONG, type Film, type Scene } from '../film.js';
import { closeModal, glide, type Act, type Stage } from '../stage.js';

const DEMO_PAN = 'NIYOM1234D';
const DEMO_PASSWORD = 'NiyomDemo@2026';

/** Sidebar on desktop, drawer on the phone. */
async function goToView({ page, p, mobile }: Stage, label: string): Promise<void> {
  if (mobile) {
    await p.click(page.getByRole('button', { name: 'Open navigation' }));
    await page.waitForTimeout(520);
  }
  await p.click(page.getByRole('button', { name: label, exact: true }));
  await page.waitForTimeout(mobile ? 900 : 650);
}

const scenes: Scene[] = [
  {
    id: 'title',
    kind: 'motion',
    title: 'Partner Portal',
    subtitle: 'Your clients, your products, your payouts',
    vo: 'So this is the Niyom Wealth partner portal. Everything you do with us — your clients, the products, your payouts — it\'s all sitting in one place.',
    caption: 'Niyom Wealth — Partner Portal',
    tail: 0.6,
    cuts: BOTH,
  },
  {
    id: 'login',
    kind: 'ui',
    vo: 'You sign in with your PAN. And if you set a four digit PIN once, that\'s it, you\'re straight in every time after that.',
    caption: 'Sign in with your PAN',
    tail: 0.5,
    cuts: LONG,
  },
  {
    id: 'dashboard',
    kind: 'ui',
    vo: 'First thing you see is where you stand. What you\'ve raised this financial year, what\'s already been paid out, what\'s still pending, and the clients you\'ve brought in.',
    caption: 'Everything you have earned, at a glance',
    illustrative: true,
    tail: 0.8,
    cuts: BOTH,
  },
  {
    id: 'onboard',
    kind: 'ui',
    vo: 'You can onboard a client yourself. Put in their PAN, it comes back verified, add their details — and they\'re mapped under you and your relationship manager. That\'s it. Your RM picks up the KYC from there.',
    sayText: 'You can onboard a client yourself. Put in their PAN, it comes back verified, add their details, and they\'re mapped under you and your relationship manager. That\'s it. Your R M picks up the K Y C from there.',
    caption: 'Onboard your own clients',
    tail: 0.8,
    cuts: LONG,
  },
  {
    id: 'clients',
    kind: 'ui',
    vo: 'Open any client and you\'ll see the whole portfolio you\'ve built for them. Every holding, every transaction, valued as of today.',
    caption: 'See every client portfolio you built',
    illustrative: true,
    tail: 0.6,
    cuts: LONG,
  },
  {
    id: 'bonds',
    kind: 'ui',
    vo: 'Now, the bonds. These are priced at your cost, and you decide your own markup on top — up to five percent. Your cost never shows to the client.',
    caption: 'Set your own markup — up to 5%',
    tail: 0.6,
    cuts: BOTH,
  },
  {
    id: 'bond-actions',
    kind: 'ui',
    vo: 'From here you can place an order for a client, send them a private link, or pull a marketing image with your own name and number on it. And if you\'d rather it didn\'t carry our branding at all, you just switch that off.',
    caption: 'Order · Share · Market — under your own name',
    tail: 0.8,
    cuts: BOTH,
  },
  {
    id: 'payouts',
    kind: 'ui',
    vo: 'Every payout statement is right here. Gross, TDS, net payable, ready to download. You\'re not chasing anybody for it.',
    sayText: 'Every payout statement is right here. Gross, T D S, net payable, ready to download. You\'re not chasing anybody for it.',
    caption: 'Payout statements, always available',
    illustrative: true,
    tail: 0.7,
    cuts: BOTH,
  },
  {
    id: 'referral',
    kind: 'ui',
    vo: 'And this is your referral link. Anyone who opens an account through it gets recorded against you automatically — nothing for you to claim afterwards.',
    caption: 'Your referral link, tracked automatically',
    tail: 0.6,
    cuts: LONG,
  },
  {
    id: 'cta',
    kind: 'motion',
    title: 'Become a partner',
    subtitle: 'niyomwealth.com/partner-onboarding',
    vo: 'If that sounds like something you want to be part of, come and register. It\'s niyomwealth dot com, slash partner onboarding.',
    caption: 'Register in a few minutes',
    tail: 1.2,
    cuts: BOTH,
  },
];

const acts: Record<string, Act> = {
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

export const partnerFilm: Film = {
  key: 'partner',
  slug: 'partner-portal',
  eyebrow: 'For distribution partners',
  loginPath: '/partner-login',
  pan: DEMO_PAN,
  password: DEMO_PASSWORD,
  signedInMarker: 'text=Welcome,',
  async signIn(page: pw.Page) {
    await page.getByPlaceholder('ABCDE1234F').fill(DEMO_PAN);
    await page.getByPlaceholder('Your password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  },
  scenes,
  acts,
};
