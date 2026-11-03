// Diagnostic: run the ACTUAL edge decryption + parse code against a real
// mailback ZIP, locally. The password is read from stdin (never argv/env) and
// nothing from the file is printed except non-identifying structure (field and
// row counts, snapshot date, status tallies). Node 24 strips the TS types on
// import, so this exercises the same winzip.ts / dbf.ts / parsers the deployed
// function uses. The report (WBR9 holdings vs WBR49 SIPs) is auto-detected.
//
//   printf '%s' "<password>" | node scripts/mf-rta-verify.mjs <file.zip>
//
// Normally invoked through scripts/mf-rta-verify.sh, which reads the password
// with hidden input.
import { readFileSync } from 'node:fs';
import { unzipSingleDbf } from '../supabase/functions/_shared/rta/winzip.ts';
import { parseDbf } from '../supabase/functions/_shared/rta/dbf.ts';
import { parseWbr9 } from '../supabase/functions/_shared/rta/wbr9.ts';
import { parseWbr49 } from '../supabase/functions/_shared/rta/wbr49.ts';
import { detectReport, snapshotFromName } from '../supabase/functions/_shared/rta/pipeline.ts';

const zipPath = process.argv[2];
if (!zipPath) {
  console.error('usage: node scripts/mf-rta-verify.mjs <file.zip>  (password on stdin)');
  process.exit(2);
}
const pw = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
const zip = new Uint8Array(readFileSync(zipPath));

try {
  const { name, bytes } = await unzipSingleDbf(zip, pw);
  const table = parseDbf(bytes);
  const report = detectReport(table);
  console.log('DECRYPT+PARSE OK');
  console.log(`  member: ${name}`);
  console.log(`  dbf first byte: 0x${(bytes[0] ?? 0).toString(16)} (expect 0x03)`);
  console.log(`  report: ${report ?? 'UNRECOGNISED'}`);
  console.log(`  fields: ${table.fields.length}, records: ${table.rows.length}`);

  if (report === 'WBR9') {
    const p = parseWbr9(table);
    console.log(`  snapshot: ${p.snapshotDate}, folios: ${p.folios.size}, holdings: ${p.holdings.length}`);
  } else if (report === 'WBR49') {
    const p = parseWbr49(table, 'CAMS', snapshotFromName(name));
    const by = { active: 0, paused: 0, ceased: 0 };
    let withPan = 0;
    const folios = new Set();
    for (const s of p.sips) {
      by[s.status] = (by[s.status] ?? 0) + 1;
      if (s.pan) withPan++;
      folios.add(s.folio);
    }
    console.log(`  snapshot: ${p.snapshotDate}, sips: ${p.sips.length}, folios: ${folios.size}`);
    console.log(`  status: ${by.active} active / ${by.paused} paused / ${by.ceased} ceased; ${withPan} with a PAN`);
  } else {
    console.log('  (no parser matched — columns did not look like WBR9 or WBR49)');
    process.exit(1);
  }
} catch (e) {
  console.log(`FAILED: ${e?.message ?? e}`);
  process.exit(1);
}
