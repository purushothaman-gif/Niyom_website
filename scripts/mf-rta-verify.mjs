// Diagnostic: run the ACTUAL edge decryption + parse code against a real
// mailback ZIP, locally. The password is read from stdin (never argv/env) and
// nothing from the file is printed except non-identifying structure (field and
// row counts, snapshot date). Node 24 strips the TS types on import, so this
// exercises the same winzip.ts / dbf.ts / wbr9.ts the deployed function uses.
//
//   printf '%s' "<password>" | node scripts/mf-rta-verify.mjs <file.zip>
//
// Normally invoked through scripts/mf-rta-verify.sh, which reads the password
// with hidden input.
import { readFileSync } from 'node:fs';
import { unzipSingleDbf } from '../supabase/functions/_shared/rta/winzip.ts';
import { parseDbf } from '../supabase/functions/_shared/rta/dbf.ts';
import { parseWbr9 } from '../supabase/functions/_shared/rta/wbr9.ts';

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
  const parsed = parseWbr9(table);
  console.log('DECRYPT+PARSE OK');
  console.log(`  member: ${name}`);
  console.log(`  dbf first byte: 0x${(bytes[0] ?? 0).toString(16)} (expect 0x03)`);
  console.log(`  fields: ${table.fields.length}, records: ${table.rows.length}`);
  console.log(`  snapshot: ${parsed.snapshotDate}, folios: ${parsed.folios.size}, holdings: ${parsed.holdings.length}`);
} catch (e) {
  console.log(`FAILED: ${e?.message ?? e}`);
  process.exit(1);
}
