// Minimal AES block cipher (encrypt only), enough to generate the keystream for
// WinZip-AES CTR decryption. Supports 128/192/256-bit keys. Encrypt-only is
// sufficient because CTR mode decrypts by XOR-ing with AES-encrypted counter
// blocks — the inverse cipher is never needed.
//
// This exists instead of an npm dependency because the Supabase edge bundler
// could not fetch a ZIP/AES package; a self-contained cipher bundles nothing.
// It is pinned against the FIPS-197 known-answer vectors in aes.test.ts.

const SBOX = new Uint8Array(256);
const RCON = new Uint8Array([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d]);

// Build the S-box once: multiplicative inverse in GF(2^8) then the AES affine
// transform s ^ rotl(s,1) ^ rotl(s,2) ^ rotl(s,3) ^ rotl(s,4) ^ 0x63.
(function initSbox() {
  const exp = new Uint8Array(256);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    x ^= ((x << 1) ^ ((x & 0x80) ? 0x11b : 0)) & 0xff;
  }
  const ginv = (a: number) => (a === 0 ? 0 : exp[(255 - log[a]) % 255]);
  for (let i = 0; i < 256; i++) {
    const s = ginv(i);
    let xf = s;
    let r = s;
    for (let c = 0; c < 4; c++) {
      r = ((r << 1) | (r >> 7)) & 0xff;
      xf ^= r;
    }
    SBOX[i] = (xf ^ 0x63) & 0xff;
  }
})();

const mul = (a: number, b: number): number => {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) r ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return r & 0xff;
};

export class Aes {
  private rk: Uint8Array;
  private Nr: number;

  constructor(key: Uint8Array) {
    const Nk = key.length / 4;
    if (Nk !== 4 && Nk !== 6 && Nk !== 8) throw new Error('AES key must be 16, 24 or 32 bytes.');
    this.Nr = Nk + 6;
    const totalWords = 4 * (this.Nr + 1);
    const w = new Uint8Array(totalWords * 4);
    w.set(key);
    const temp = new Uint8Array(4);
    for (let i = Nk; i < totalWords; i++) {
      temp.set(w.subarray((i - 1) * 4, (i - 1) * 4 + 4));
      if (i % Nk === 0) {
        const t0 = temp[0];
        temp[0] = SBOX[temp[1]] ^ RCON[i / Nk - 1];
        temp[1] = SBOX[temp[2]];
        temp[2] = SBOX[temp[3]];
        temp[3] = SBOX[t0];
      } else if (Nk > 6 && i % Nk === 4) {
        temp[0] = SBOX[temp[0]];
        temp[1] = SBOX[temp[1]];
        temp[2] = SBOX[temp[2]];
        temp[3] = SBOX[temp[3]];
      }
      for (let j = 0; j < 4; j++) w[i * 4 + j] = w[(i - Nk) * 4 + j] ^ temp[j];
    }
    this.rk = w;
  }

  /** Encrypt one 16-byte block, returning a new 16-byte array. */
  encryptBlock(input: Uint8Array): Uint8Array {
    const s = new Uint8Array(16);
    s.set(input.subarray(0, 16));
    this.addRoundKey(s, 0);
    for (let round = 1; round < this.Nr; round++) {
      this.subBytes(s);
      this.shiftRows(s);
      this.mixColumns(s);
      this.addRoundKey(s, round);
    }
    this.subBytes(s);
    this.shiftRows(s);
    this.addRoundKey(s, this.Nr);
    return s;
  }

  private addRoundKey(s: Uint8Array, round: number) {
    const o = round * 16;
    for (let i = 0; i < 16; i++) s[i] ^= this.rk[o + i];
  }

  private subBytes(s: Uint8Array) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
  }

  private shiftRows(s: Uint8Array) {
    // State is column-major: byte index = row + 4*col.
    const t = new Uint8Array(16);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) t[r + 4 * c] = s[r + 4 * ((c + r) % 4)];
    }
    s.set(t);
  }

  private mixColumns(s: Uint8Array) {
    for (let c = 0; c < 4; c++) {
      const i = 4 * c;
      const a0 = s[i], a1 = s[i + 1], a2 = s[i + 2], a3 = s[i + 3];
      s[i] = mul(a0, 2) ^ mul(a1, 3) ^ a2 ^ a3;
      s[i + 1] = a0 ^ mul(a1, 2) ^ mul(a2, 3) ^ a3;
      s[i + 2] = a0 ^ a1 ^ mul(a2, 2) ^ mul(a3, 3);
      s[i + 3] = mul(a0, 3) ^ a1 ^ a2 ^ mul(a3, 2);
    }
  }
}
