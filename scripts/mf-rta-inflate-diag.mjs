// Diagnose a mailback ZIP whose inflate fails ("corrupt deflate stream"):
// decrypt with our own winzip code, then walk the raw deflate payload with
// Node's zlib, reporting each deflate segment's compressed/uncompressed size.
// Prints sizes only — never file content. Password on stdin.
//
//   printf '%s' "<password>" | node scripts/mf-rta-inflate-diag.mjs <file.zip>
import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';
import nodeCrypto from 'node:crypto';
import { findAesEntry, aesCtrXor } from '../supabase/functions/_shared/rta/winzip.ts';

const pw = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
const zip = new Uint8Array(readFileSync(process.argv[2]));
const e = findAesEntry(zip, /\.(dbf|csv)$/i);
const saltLen = { 1: 8, 2: 12, 3: 16 }[e.strength];
const keyLen = { 1: 16, 2: 24, 3: 32 }[e.strength];
const blob = zip.subarray(e.dataStart, e.dataStart + e.csize);
const salt = blob.subarray(0, saltLen);
const cipher = blob.subarray(saltLen + 2, blob.length - 10);
const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-1' }, base, (2 * keyLen + 2) * 8));
const plain = Buffer.from(aesCtrXor(bits.subarray(0, keyLen), cipher));
// Reference keystream: Node's AES-ECB over WinZip's little-endian counter blocks.
const encKey = Buffer.from(bits.subarray(0, keyLen));
const nBlocks = Math.ceil(cipher.length / 16);
const ctrs = Buffer.alloc(nBlocks * 16);
const c = Buffer.alloc(16); c[0] = 1;
for (let b = 0; b < nBlocks; b++) {
  c.copy(ctrs, b * 16);
  for (let k = 0; k < 16; k++) { c[k] = (c[k] + 1) & 0xff; if (c[k] !== 0) break; }
}
const ecb = nodeCrypto.createCipheriv(`aes-${keyLen * 8}-ecb`, encKey, null); ecb.setAutoPadding(false);
const ks = Buffer.concat([ecb.update(ctrs), ecb.final()]);
const ref = Buffer.alloc(cipher.length);
for (let i = 0; i < cipher.length; i++) ref[i] = cipher[i] ^ ks[i];
let firstDiff = -1;
for (let i = 0; i < ref.length; i++) if (ref[i] !== plain[i]) { firstDiff = i; break; }
console.log(firstDiff < 0 ? 'our AES-CTR == Node AES-CTR (identical)' : `our AES-CTR DIFFERS from Node first at byte ${firstDiff} (block ${firstDiff >> 4})`);
try { const r = zlib.inflateRawSync(ref); console.log(`Node-decrypted inflate: OK ${r.length} bytes`); }
catch (err) { console.log(`Node-decrypted inflate: FAILED — ${err.message}`); }
console.log(`entry ${e.name}: method ${e.method}, compressed ${plain.length}, declared uncompressed ${e.usize ?? '?'}`);

// 1) what the edge function does
try {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Uint8Array(await new Response(new Blob([plain]).stream().pipeThrough(ds)).arrayBuffer());
  console.log(`DecompressionStream: OK ${out.length} bytes`);
} catch (err) {
  console.log(`DecompressionStream: FAILED — ${err?.message ?? err}`);
}

// 2) segment walk
let off = 0, total = 0, seg = 0;
while (off < plain.length) {
  try {
    const r = zlib.inflateRawSync(plain.subarray(off), { info: true });
    const used = r.engine.bytesWritten;
    seg++; total += r.buffer.length;
    console.log(`segment ${seg}: consumed ${used} compressed -> ${r.buffer.length} bytes (offset ${off})`);
    if (!used) break;
    off += used;
  } catch (err) {
    console.log(`segment ${seg + 1} at offset ${off} (of ${plain.length}): zlib error — ${err.message}`);
    // try partial output up to the error
    try {
      const partial = zlib.inflateRawSync(plain.subarray(off), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
      console.log(`  partial inflate before the error: ${partial.length} bytes`);
    } catch (e2) { console.log(`  partial: ${e2.message}`); }
    break;
  }
}
console.log(`segments ${seg}, inflated total ${total}, trailing unread ${plain.length - off}`);
