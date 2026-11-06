// Read a single WinZip-AES-encrypted member out of a ZIP, dependency-free.
//
// The CAMS/KFintech mailback ZIPs use WinZip AES (compression method 99, the
// 0x9901 "AE" extra field), which standard ZIP tooling in the edge runtime does
// not open. The format (per the WinZip AE-1/AE-2 spec):
//   [salt][2-byte password verifier][AES-CTR ciphertext][10-byte HMAC-SHA1]
// The key material is PBKDF2-HMAC-SHA1(password, salt, 1000) split into the AES
// key, the HMAC key and the 2-byte verifier. AES runs in CTR mode with a
// 128-bit little-endian counter starting at 1. The plaintext is then the inner
// (usually deflate) stream, which the caller inflates.
//
// PBKDF2, HMAC and inflate come from the runtime (WebCrypto + Decompression
// stream); only the AES block cipher and CTR are hand-rolled (see aes.ts).

import { Aes } from './aes.ts';

const SALT_LEN: Record<number, number> = { 1: 8, 2: 12, 3: 16 };
const KEY_LEN: Record<number, number> = { 1: 16, 2: 24, 3: 32 };

export class WinzipError extends Error {}

const u16 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8);
const u32 = (d: Uint8Array, o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;

const asciiStr = (d: Uint8Array, o: number, len: number) => {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(d[o + i]);
  return s;
};

const lastIndexOf = (hay: Uint8Array, needle: number[]): number => {
  for (let i = hay.length - needle.length; i >= 0; i--) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
};

interface AesEntry {
  name: string;
  strength: number; // 1=AES-128, 2=AES-192, 3=AES-256
  method: number; // real compression method (0 stored, 8 deflate)
  dataStart: number;
  csize: number;
}

/** Locate the first encrypted member matching `extRe` via the central directory. */
export function findAesEntry(zip: Uint8Array, extRe: RegExp = /\.dbf$/i): AesEntry {
  const eocd = lastIndexOf(zip, [0x50, 0x4b, 0x05, 0x06]);
  if (eocd < 0) throw new WinzipError('Not a ZIP file.');
  const cdOff = u32(zip, eocd + 16);
  const n = u16(zip, eocd + 10);

  let p = cdOff;
  for (let i = 0; i < n; i++) {
    if (!(zip[p] === 0x50 && zip[p + 1] === 0x4b && zip[p + 2] === 0x01 && zip[p + 3] === 0x02)) break;
    const flags = u16(zip, p + 8);
    const method = u16(zip, p + 10);
    const csize = u32(zip, p + 20);
    const nlen = u16(zip, p + 28);
    const elen = u16(zip, p + 30);
    const clen = u16(zip, p + 32);
    const lho = u32(zip, p + 42);
    const name = asciiStr(zip, p + 46, nlen);
    const extra = zip.subarray(p + 46 + nlen, p + 46 + nlen + elen);

    if ((flags & 1) && method === 99 && extRe.test(name)) {
      let strength = 3;
      let realMethod = 8;
      let q = 0;
      while (q + 4 <= extra.length) {
        const hid = u16(extra, q);
        const hsz = u16(extra, q + 2);
        if (hid === 0x9901) {
          strength = extra[q + 8];
          realMethod = u16(extra, q + 9);
        }
        q += 4 + hsz;
      }
      if (!(zip[lho] === 0x50 && zip[lho + 1] === 0x4b && zip[lho + 2] === 0x03 && zip[lho + 3] === 0x04)) {
        throw new WinzipError('Corrupt ZIP (bad local header).');
      }
      const lnlen = u16(zip, lho + 26);
      const lelen = u16(zip, lho + 28);
      const dataStart = lho + 30 + lnlen + lelen;
      return { name, strength, method: realMethod, dataStart, csize };
    }
    p = p + 46 + nlen + elen + clen;
  }
  throw new WinzipError('No matching encrypted file found in the ZIP.');
}

/** Back-compat: the first encrypted .dbf member. */
export function findAesDbfEntry(zip: Uint8Array): AesEntry {
  return findAesEntry(zip, /\.dbf$/i);
}

/**
 * AES-CTR transform with WinZip's 128-bit little-endian counter starting at 1.
 * CTR is symmetric, so this both encrypts and decrypts; exported for testing.
 */
export function aesCtrXor(key: Uint8Array, data: Uint8Array): Uint8Array {
  const aes = new Aes(key);
  const out = new Uint8Array(data.length);
  const counter = new Uint8Array(16);
  counter[0] = 1;
  for (let off = 0; off < data.length; off += 16) {
    const ks = aes.encryptBlock(counter);
    const end = Math.min(16, data.length - off);
    for (let j = 0; j < end; j++) out[off + j] = data[off + j] ^ ks[j];
    // Little-endian increment with carry. NOT `if (++counter[k] !== 0)`: on a
    // Uint8Array that expression evaluates to 256 (the stored byte is 0), so the
    // carry never happened and every block from #256 on was decrypted with the
    // wrong keystream — any feed over ~4 KB compressed came out corrupt.
    for (let k = 0; k < 16; k++) {
      counter[k] = (counter[k] + 1) & 0xff;
      if (counter[k] !== 0) break;
    }
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Response(new Blob([data as unknown as BlobPart]).stream().pipeThrough(ds));
  return new Uint8Array(await stream.arrayBuffer());
}

/**
 * Decrypt and inflate the single encrypted DBF in the ZIP. Throws WinzipError
 * with code-like messages: WRONG_PASSWORD (2-byte verifier failed) or
 * AUTH_FAILED (HMAC mismatch — wrong password or a corrupt file).
 */
export async function unzipMember(
  zip: Uint8Array,
  password: string,
  extRe: RegExp = /\.(dbf|csv)$/i,
): Promise<{ name: string; bytes: Uint8Array }> {
  const entry = findAesEntry(zip, extRe);
  const saltLen = SALT_LEN[entry.strength];
  const keyLen = KEY_LEN[entry.strength];
  if (!saltLen || !keyLen) throw new WinzipError('Unsupported AES strength in the ZIP.');

  const blob = zip.subarray(entry.dataStart, entry.dataStart + entry.csize);
  if (blob.length < saltLen + 2 + 10) throw new WinzipError('Encrypted entry is too short.');
  const salt = blob.subarray(0, saltLen);
  const pwdVerify = blob.subarray(saltLen, saltLen + 2);
  const cipher = blob.subarray(saltLen + 2, blob.length - 10);
  const authCode = blob.subarray(blob.length - 10);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedLen = 2 * keyLen + 2;
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-1' },
      baseKey,
      derivedLen * 8,
    ),
  );
  const encKey = bits.subarray(0, keyLen);
  const authKey = bits.subarray(keyLen, 2 * keyLen);
  const verify = bits.subarray(2 * keyLen, 2 * keyLen + 2);
  if (verify[0] !== pwdVerify[0] || verify[1] !== pwdVerify[1]) {
    throw new WinzipError('WRONG_PASSWORD');
  }

  const hmacKey = await crypto.subtle.importKey('raw', authKey, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, cipher)).subarray(0, 10);
  for (let i = 0; i < 10; i++) {
    if (mac[i] !== authCode[i]) throw new WinzipError('AUTH_FAILED');
  }

  const plain = aesCtrXor(encKey, cipher);
  let bytes: Uint8Array;
  if (entry.method === 8) bytes = await inflateRaw(plain);
  else if (entry.method === 0) bytes = plain;
  else throw new WinzipError('Unsupported compression inside the ZIP.');
  return { name: entry.name, bytes };
}

/** Back-compat: decrypt and inflate the single encrypted DBF in the ZIP. */
export async function unzipSingleDbf(
  zip: Uint8Array,
  password: string,
): Promise<{ name: string; bytes: Uint8Array }> {
  return unzipMember(zip, password, /\.dbf$/i);
}
