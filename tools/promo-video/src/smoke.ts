/**
 * Smoke check: can we drive the demo partner portal, and does the new
 * marketplace fixture actually render? Run this before a capture — it fails
 * fast and loudly, where the capture would just record an empty screen.
 */
import { chromium } from 'playwright';

const BASE = process.env.PROMO_BASE_URL ?? 'http://localhost:5173';
const DEMO_PAN = 'NIYOM1234D';
const DEMO_PASSWORD = 'NiyomDemo@2026';

const results: string[] = [];
function check(label: string, ok: boolean, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

await page.goto(`${BASE}/partner-login`, { waitUntil: 'networkidle' });
await page.getByPlaceholder('ABCDE1234F').fill(DEMO_PAN);
await page.getByPlaceholder('Your password').fill(DEMO_PASSWORD);
await page.getByRole('button', { name: 'Sign In', exact: true }).click();

await page.waitForSelector('text=Welcome,', { timeout: 15000 });
check('demo sign-in reaches the dashboard', true);

const banner = await page.locator('text=Sample portal').count();
check('demo disclosure banner is visible', banner > 0);

// --- Bonds -----------------------------------------------------------------
await page.getByRole('button', { name: 'Bonds', exact: true }).click();
await page.waitForSelector('text=Your markup', { timeout: 15000 });
const bondCards = await page.getByText('View details').count();
check('bond shelf renders cards', bondCards >= 6, `${bondCards} cards`);
const meridian = await page.locator('text=Meridian Infra Finance').count();
check('fixture issuer is on screen', meridian > 0);

const myOrdersTab = page.getByRole('button', { name: /My Orders/ }).first();
await myOrdersTab.click();
await page.waitForTimeout(800);
const orderRefs = await page.locator('text=/PBO-DEMO-\\d{4}/').count();
check('seeded bond orders render', orderRefs >= 3, `${orderRefs} rows`);

// --- Unlisted shares -------------------------------------------------------
await page.getByRole('button', { name: 'Unlisted Shares', exact: true }).click();
await page.waitForSelector('text=Your markup', { timeout: 15000 });
const velan = await page.locator('text=Velan Aerospace').count();
check('unlisted share shelf renders', velan > 0);

// --- Markup repricing ------------------------------------------------------
await page.getByRole('button', { name: 'Bonds', exact: true }).click();
await page.waitForSelector('text=Your markup', { timeout: 15000 });
const cardText = () => page.locator('text=Meridian Infra Finance').locator('xpath=ancestor::*[4]').first().innerText();
const priceBefore = await cardText();
const markupInput = page.locator('input[type="number"]').first();
await markupInput.fill('4');
await page.getByRole('button', { name: 'Save', exact: true }).first().click();
await page.waitForTimeout(1800);
const priceAfter = await cardText();
check('saving a markup reprices the shelf', priceBefore !== priceAfter, `card text ${priceBefore === priceAfter ? 'unchanged' : 'changed'}`);

await browser.close();
console.log(results.join('\n'));
