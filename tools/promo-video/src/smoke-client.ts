/**
 * Smoke check for the demo CLIENT portal — the twin of smoke.ts. Run before a
 * client capture: it fails loudly where the capture would quietly film empty
 * states.
 */
import { chromium } from 'playwright';

const BASE = process.env.PROMO_BASE_URL ?? 'http://localhost:5173';
const DEMO_PAN = 'NIYOM5678C';
const DEMO_PASSWORD = 'NiyomDemo@2026';

const results: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'dark' });
await ctx.addInitScript(() => { try { localStorage.setItem('niyom-theme', 'dark'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(`${BASE}/client-login`, { waitUntil: 'networkidle' });
await page.getByPlaceholder('ABCDE1234F').first().fill(DEMO_PAN);
await page.getByPlaceholder(/password/i).first().fill(DEMO_PASSWORD);
await page.getByRole('button', { name: /^Sign In/ }).first().click();

await page.waitForSelector('text=Sample portal', { timeout: 20000 });
check('demo sign-in reaches the portal', true);

const body = () => page.evaluate(() => document.body.innerText);
const has = async (needle: string | RegExp) => {
  const t = await body();
  return typeof needle === 'string' ? t.includes(needle) : needle.test(t);
};

await page.waitForTimeout(2500);
check('net worth is rendered', await has(/24,59,550|24\.60 L|24\.6 L|₹24/), '');
check('a sample holding is on screen', await has('Sample Flexi Cap'));

/** The portal header groups its destinations under Portfolio / Invest / Activity. */
const GROUP: Record<string, string> = {
  'My Portfolio': 'Portfolio', 'Asset Allocation': 'Portfolio',
  'Capital Gains': 'Portfolio', Reports: 'Portfolio',
  'Mutual Funds': 'Invest', Bonds: 'Invest', 'Unlisted Shares': 'Invest',
  Transactions: 'Activity', SIP: 'Activity', Documents: 'Activity', Support: 'Activity',
};

const go = async (label: string) => {
  await page.getByRole('button', { name: GROUP[label], exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('menuitem', { name: new RegExp(`^${label}`) }).first().click();
  await page.waitForTimeout(1900);
};

for (const [label, needle] of [
  ['My Portfolio', 'Velan Aerospace'],
  ['Asset Allocation', /Equity|Allocation/],
  ['Capital Gains', /2026-27|Capital Gains/],
  ['Transactions', 'Meridian Infra'],
  ['Mutual Funds', 'Sample Mid Cap'],
  ['Bonds', 'Meridian Infra'],
  ['Reports', /Statement|Report/],
] as Array<[string, string | RegExp]>) {
  try {
    await go(label);
    check(`${label} renders`, await has(needle));
  } catch (e) {
    check(`${label} renders`, false, String(e).slice(0, 80));
  }
}

check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(results.join('\n'));
