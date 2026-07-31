/**
 * Dry-run a CAS through the exact parse + reconciliation gate the import route
 * uses, and print what it found. Touches no database and writes no file — it
 * exists so a statement can be proven before, or instead of, importing it.
 *
 *   npm run build
 *   node scripts/cas-check.mjs "/path/to/statement.pdf" "<statement password>"
 *
 * Exits non-zero when the parse does not reconcile, so it can gate a deploy
 * after any change to the parser.
 */
import { extractCasText } from '../dist/cas/extract.js';
import { parseCas, normalizeLines, readInvestor, readStatementPeriod } from '../dist/cas/parse.js';
import { parseDetailedSchemes } from '../dist/cas/detailed.js';
import { reconcileDetailed, reconcileSummary } from '../dist/cas/import.js';
import { readFile } from 'node:fs/promises';

const [, , file, password] = process.argv;
if (!file || !password) {
  console.error('usage: node scripts/cas-check.mjs <statement.pdf> <password>');
  process.exit(2);
}

const inr = (n) =>
  n === null || n === undefined ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const text = await extractCasText(await readFile(file), password);
const detailed = !/Consolidated Account Summary/i.test(text);
const investor = readInvestor(text);
const period = readStatementPeriod(text);

console.log(`variant   : ${detailed ? 'DETAILED' : 'SUMMARY'}`);
console.log(`investor  : ${investor.name || '—'}  ${investor.pan || '(PAN masked)'}`);
console.log(`period    : ${period ? `${period.from} → ${period.to}` : '—'}`);

let recon;
if (detailed) {
  const schemes = parseDetailedSchemes(text);
  recon = reconcileDetailed(schemes, normalizeLines(text));
  const txns = schemes.reduce((n, s) => n + s.transactions.length, 0);
  const ours = schemes.filter((s) => /362707/.test(s.advisorCode ?? '')).length;
  console.log(`schemes   : ${schemes.length}  (${ours} attributed to ARN-362707)`);
  console.log(`txns      : ${txns}`);
  for (const s of schemes) {
    const ledger = s.transactions.reduce((sum, t) => sum + t.units, s.openingUnits);
    const ok = Math.abs(ledger - s.closingUnits) <= 0.001 && s.balanceMismatch === null;
    console.log(
      `  ${ok ? '✓' : '✗'} ${s.schemeName.slice(0, 52).padEnd(52)} ` +
        `${String(s.transactions.length).padStart(4)} txn  ${inr(s.marketValue).padStart(14)}  ${s.advisorCode || '—'}`,
    );
  }
} else {
  const parsed = parseCas(text);
  console.log(`holdings  : ${parsed.holdings.length}`);
  for (const h of parsed.holdings) {
    console.log(`  · ${h.schemeName.slice(0, 60).padEnd(60)} ${inr(h.marketValue).padStart(14)}`);
  }
  recon = reconcileSummary(parsed);
}

console.log(`\nmarket    : parsed ${inr(recon.parsedMarket)}  stated ${inr(recon.statedMarket)}`);
console.log(`cost      : parsed ${inr(recon.parsedCost)}  stated ${inr(recon.statedCost)}`);
for (const w of recon.warnings) console.log(`warning   : ${w}`);
for (const f of recon.failures) console.log(`FAILURE   : ${f}`);
console.log(`\n${recon.reconciled ? 'RECONCILED — this import would be marked authoritative.' : 'MISMATCH — this import would be stored but never read.'}`);

process.exit(recon.reconciled ? 0 : 1);
