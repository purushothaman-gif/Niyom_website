/**
 * JOSE payload encryption for BSE StAR MF v2 (spec §6.1.7).
 *
 * Production mandates encrypted payloads — "all APIs are designed to work with
 * encrypted payload ie. all requests and responses are encrypted". The demo
 * environment accepts plain JSON, which is why eight weeks of demo work never
 * surfaced this: the first plain call against v2.bsestarmf.in fails with
 * `invalid_org_header`, because that header is part of this flow.
 *
 * The shape is nest-then-sign, exactly as BSE's pseudocode specifies:
 *
 *   request   JWE(payload, AES_256_GCM content, RSA-OAEP-256 key wrap to BSE's
 *                 public key, cty "application/json")   -> compact
 *           → JWS(that compact string, RS256 with OUR private key,
 *                 typ "jws", header version "1.0")      -> compact  → body
 *
 *   response  parse JWS → verify against BSE's public key
 *           → parse JWE → decrypt with OUR private key → JSON
 *
 * Note the asymmetry, which is easy to get backwards: we ENCRYPT to BSE's
 * public key (only they can open it) and SIGN with our private key (only we
 * could have sent it). On the way back those swap.
 */
import { readFileSync } from 'node:fs';
import {
  CompactEncrypt,
  CompactSign,
  compactDecrypt,
  compactVerify,
  importPKCS8,
  importSPKI,
  type CryptoKey,
} from 'jose';

export interface JoseKeys {
  /** Ours — signs requests, decrypts responses. */
  ownPrivate: CryptoKey;
  /** BSE's — encrypts requests to them, verifies their responses. */
  remotePublic: CryptoKey;
}

/**
 * Load the keypair from PEM files on disk. The private key never leaves the
 * droplet, so this is deliberately a filesystem read rather than an env var.
 */
export async function loadJoseKeys(
  ownPrivatePath: string,
  remotePublicPath: string,
): Promise<JoseKeys> {
  const [ownPrivate, remotePublic] = await Promise.all([
    importPKCS8(readFileSync(ownPrivatePath, 'utf8'), 'RS256'),
    importSPKI(readFileSync(remotePublicPath, 'utf8'), 'RSA-OAEP-256'),
  ]);
  return { ownPrivate, remotePublic };
}

/** Clear JSON -> the compact JWS string BSE expects as the request body. */
export async function encryptPayload(payload: unknown, keys: JoseKeys): Promise<string> {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));

  const jwe = await new CompactEncrypt(plaintext)
    .setProtectedHeader({
      alg: 'RSA-OAEP-256', // wraps the session key with BSE's public key
      enc: 'A256GCM', // AES_256_GCM content encryption
      cty: 'application/json',
    })
    .encrypt(keys.remotePublic);

  // The JWE compact string becomes the JWS payload — nested, not detached.
  return new CompactSign(new TextEncoder().encode(jwe))
    .setProtectedHeader({ alg: 'RS256', typ: 'jws', version: '1.0' })
    .sign(keys.ownPrivate);
}

/** BSE's compact JWS response -> the clear JSON object inside it. */
export async function decryptPayload<T>(body: string, keys: JoseKeys): Promise<T> {
  const { payload: jweBytes } = await compactVerify(body.trim(), keys.remotePublic);
  const { plaintext } = await compactDecrypt(
    new TextDecoder().decode(jweBytes).trim(),
    keys.ownPrivate,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
