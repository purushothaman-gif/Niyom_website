/**
 * The client film — why a prospective investor should open an account.
 *
 * Filmed against the sample client (shared/portal/demo/demoClient.ts): no auth
 * user, no database rows, invented securities throughout, and the portal's own
 * "Sample portal" banner visible in every frame of the product.
 */
import type * as pw from 'playwright';
import { BOTH, LONG, type Film, type Scene } from '../film.js';
import { glide, type Act, type Stage } from '../stage.js';

/** Same origin as whatever is loaded, so PROMO_BASE_URL is honoured. */
const origin = (page: pw.Page) => page.url().split('/').slice(0, 3).join('/');

const DEMO_PAN = 'NIYOM5678C';
const DEMO_PASSWORD = 'NiyomDemo@2026';

/**
 * The portal groups its fifteen destinations under four header menus on
 * desktop, and puts all of them behind one "More" sheet on the phone. Both
 * paths land in the same place; neither is a plain link.
 */
const GROUP: Record<string, string> = {
  'My Portfolio': 'Portfolio',
  'Asset Allocation': 'Portfolio',
  'Capital Gains': 'Portfolio',
  Reports: 'Portfolio',
  'Mutual Funds': 'Invest',
  Bonds: 'Invest',
  'Unlisted Shares': 'Invest',
  Transactions: 'Activity',
  Documents: 'Activity',
  SIP: 'Activity',
  // Not in a named group — Profile, Notifications and Support hang off the
  // identity chip at the right-hand end of the header.
  Support: 'chip',
  Notifications: 'chip',
  Profile: 'chip',
};

async function goToView({ page, p, mobile }: Stage, label: string): Promise<void> {
  if (mobile) {
    if (label === 'Dashboard') {
      await p.click(page.getByRole('button', { name: 'Home', exact: true }));
    } else {
      await p.click(page.getByRole('button', { name: 'More', exact: true }));
      await page.waitForTimeout(650);
      await p.click(page.getByRole('button', { name: new RegExp(`^${label}`) }).last());
    }
  } else {
    const group = GROUP[label];
    if (group === 'chip') {
      await p.click(page.locator('header button').last());
    } else {
      await p.click(page.getByRole('button', { name: group, exact: true }));
    }
    await page.waitForTimeout(480);
    await p.click(page.getByRole('menuitem', { name: new RegExp(`^${label}`) }));
  }
  await page.waitForTimeout(mobile ? 950 : 700);
}

const scenes: Scene[] = [
  {
    id: 'title',
    kind: 'motion',
    title: 'Your wealth, in one place',
    subtitle: 'Mutual funds, bonds and unlisted shares — valued every day',
    vo: 'Niyom Wealth gives you one place for everything you own. Mutual funds, bonds and unlisted shares, valued every single day.',
    caption: 'Niyom Wealth — Client Portal',
    tail: 0.6,
    cuts: BOTH,
  },
  {
    id: 'onboarding',
    kind: 'ui',
    vo: 'Opening an account starts with your PAN and takes about thirty seconds. Your K Y C is completed inside the portal, not on paper.',
    caption: 'Open an account in minutes',
    tail: 0.6,
    cuts: LONG,
    setup: async (page) => {
      await page.goto(`${origin(page)}/onboarding`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(900);
    },
  },
  {
    id: 'login',
    kind: 'ui',
    vo: 'After that, signing in is just your PAN number and your password. Or a four digit PIN, on a device you trust.',
    caption: 'Your PAN is your login',
    tail: 0.5,
    cuts: LONG,
    // The onboarding scene leaves the browser on the public sign-up page, so
    // this one puts it back rather than shooting a login form that is not there.
    setup: async (page) => {
      await page.goto(`${origin(page)}/client-login`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
    },
  },
  {
    id: 'dashboard',
    kind: 'ui',
    vo: 'Your dashboard opens on what you are worth today, how it moved, and the return you have actually earned on the money you put in.',
    caption: 'What you are worth, today',
    illustrative: true,
    tail: 0.8,
    cuts: BOTH,
  },
  {
    id: 'portfolio',
    kind: 'ui',
    vo: 'Every holding sits in one list. Mutual funds, bonds and unlisted shares side by side, with what you paid and what it is worth now.',
    caption: 'Every holding, in one list',
    illustrative: true,
    tail: 0.8,
    cuts: BOTH,
  },
  {
    id: 'allocation',
    kind: 'ui',
    vo: 'Asset allocation shows how your money is spread, so you can see a concentration before it becomes a problem.',
    caption: 'See how your money is spread',
    illustrative: true,
    tail: 0.7,
    cuts: LONG,
  },
  {
    id: 'gains',
    kind: 'ui',
    vo: 'Capital gains are worked out for you, year by year. Long term and short term, with the tax treatment already applied, so there is no spreadsheet waiting for you in March.',
    caption: 'Capital gains, already worked out',
    illustrative: true,
    tail: 0.8,
    cuts: BOTH,
  },
  {
    id: 'funds',
    kind: 'ui',
    vo: 'Explore mutual funds with their returns, their risk and their N A V history, and invest straight from the portal.',
    caption: 'Explore and invest in minutes',
    tail: 0.7,
    cuts: BOTH,
  },
  {
    id: 'bonds',
    kind: 'ui',
    vo: 'And not just funds. Bonds and unlisted shares too, the kind of fixed income and pre I P O access most apps will never offer you.',
    caption: 'Bonds and unlisted shares, not just funds',
    tail: 0.8,
    cuts: BOTH,
  },
  {
    id: 'reports',
    kind: 'ui',
    vo: 'Every statement and document is there to download whenever you need it.',
    caption: 'Statements, ready when you are',
    tail: 0.6,
    cuts: LONG,
  },
  {
    id: 'support',
    kind: 'ui',
    vo: 'And your relationship manager is one tap away. Raise a ticket and it reaches them directly.',
    caption: 'A real person, one tap away',
    tail: 0.7,
    cuts: LONG,
  },
  {
    id: 'cta',
    kind: 'motion',
    title: 'Open a free account',
    subtitle: 'niyomwealth.com',
    vo: 'Open a free account today at niyom wealth dot com.',
    caption: 'It takes about thirty seconds',
    tail: 1.2,
    cuts: BOTH,
  },
];

const acts: Record<string, Act> = {
  /**
   * The public account-opening page. The PAN is typed but never submitted —
   * "Verify PAN" calls the live Cashfree gate, which would reject an invented
   * PAN on camera.
   */
  onboarding: async ({ page, p }) => {
    await page.waitForTimeout(700);
    await p.type(page.getByPlaceholder('ABCDE1234F'), 'ABCDE1234F', 70);
    await page.waitForTimeout(1500);
    await glide(page, 260, 4, 150);
    await page.waitForTimeout(900);
  },

  /** Doubles as the sign-in for the rest of the film. */
  login: async ({ page, p }) => {
    await page.waitForTimeout(500);
    await p.type(page.getByPlaceholder('ABCDE1234F'), DEMO_PAN, 62);
    await page.waitForTimeout(180);
    await p.type(page.getByPlaceholder('Your password'), DEMO_PASSWORD, 40);
    await page.waitForTimeout(280);
    await p.click(page.getByRole('button', { name: /^Sign In/ }).first());
    await page.waitForSelector('text=Sample portal', { timeout: 20000 });
    await page.waitForTimeout(1600);
  },

  dashboard: async ({ page, p, mobile }) => {
    await page.waitForTimeout(900);
    if (mobile) {
      await glide(page, 820, 9, 150);
      await page.waitForTimeout(700);
      await glide(page, 620, 7, 150);
    } else {
      await p.moveTo(560, 420, 24);
      await page.waitForTimeout(500);
      await p.moveTo(1120, 420, 22);
      await page.waitForTimeout(500);
      await glide(page, 560, 8, 140);
      await page.waitForTimeout(1400);
    }
  },

  portfolio: async (s) => {
    await goToView(s, 'My Portfolio');
    await s.page.waitForTimeout(900);
    await glide(s.page, s.mobile ? 800 : 520, 8, 145);
    await s.page.waitForTimeout(1600);
  },

  allocation: async (s) => {
    await goToView(s, 'Asset Allocation');
    await s.page.waitForTimeout(1400);
    await glide(s.page, 420, 6, 150);
    await s.page.waitForTimeout(1500);
  },

  gains: async (s) => {
    await goToView(s, 'Capital Gains');
    await s.page.waitForTimeout(1500);
    await glide(s.page, s.mobile ? 700 : 480, 7, 145);
    await s.page.waitForTimeout(1800);
  },

  funds: async (s) => {
    await goToView(s, 'Mutual Funds');
    await s.page.waitForTimeout(1300);
    await glide(s.page, s.mobile ? 620 : 420, 6, 150);
    await s.page.waitForTimeout(1500);
  },

  bonds: async (s) => {
    await goToView(s, 'Bonds');
    await s.page.waitForTimeout(1400);
    await glide(s.page, s.mobile ? 620 : 400, 6, 150);
    await s.page.waitForTimeout(1800);
  },

  reports: async (s) => {
    await goToView(s, 'Reports');
    await s.page.waitForTimeout(1500);
    await glide(s.page, 380, 5, 150);
    await s.page.waitForTimeout(1400);
  },

  support: async (s) => {
    await goToView(s, 'Support');
    await s.page.waitForTimeout(1400);
    await glide(s.page, 400, 5, 150);
    await s.page.waitForTimeout(1600);
  },
};

export const clientFilm: Film = {
  key: 'client',
  slug: 'client-portal',
  eyebrow: 'For investors',
  loginPath: '/client-login',
  pan: DEMO_PAN,
  password: DEMO_PASSWORD,
  signedInMarker: 'text=Sample portal',
  async signIn(page: pw.Page) {
    await page.getByPlaceholder('ABCDE1234F').fill(DEMO_PAN);
    await page.getByPlaceholder('Your password').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: /^Sign In/ }).first().click();
  },
  scenes,
  acts,
};
