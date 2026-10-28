// Wylth investor SSO gateway (Investor SSO Partner Integration Guide v1.0).
//
// One call: POST <host>/api/investorsso/login with `Authorization: Bearer <API key>`
// and body {"data": base64(AES-CBC/PKCS7({"pan":"<PAN>"}))}, where the AES key
// and IV are the UTF-8 bytes of the secret key and IV Wylth issued us. Wylth
// always answers HTTP 200; `Status` 0 = success (Data.redirect_url), 1 = failure
// (reason in `Message`).
//
// The redirect_url is a one-time sign-in credential: callers hand it straight
// to the browser and never log, store or cache it. Same for the PAN and the
// encrypted payload.
//
//   WYLTH_GATEWAY      "mock" forces the mock (dev, before credentials exist)
//   WYLTH_API_BASE     Wylth API host per environment, e.g. https://uat-api.example
//   WYLTH_API_KEY      bearer key
//   WYLTH_SECRET_KEY   AES key text (16, 24 or 32 UTF-8 bytes)
//   WYLTH_IV           AES IV text (16 UTF-8 bytes)
//
// If Wylth turns out to whitelist caller IPs, add a RelayGateway through the
// droplet here, the way _shared/panGateway.ts does for Cashfree.

export type WylthLoginResult =
  | { ok: true; redirectUrl: string }
  | { ok: false; notMapped: boolean; message: string };

export interface WylthGateway {
  login(pan: string): Promise<WylthLoginResult>;
}

const enc = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// AES-CBC with PKCS7 padding (WebCrypto's AES-CBC always pads PKCS7), key
// size picked from the key length exactly like Wylth's Node sample.
export async function encryptPayload(pan: string, secretKey: string, iv: string): Promise<string> {
  const key = enc.encode(secretKey);
  const ivBytes = enc.encode(iv);
  if (![16, 24, 32].includes(key.length)) throw new Error("Wylth secret key must be 16, 24 or 32 bytes.");
  if (ivBytes.length !== 16) throw new Error("Wylth IV must be 16 bytes.");
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt"]);
  const json = JSON.stringify({ pan: pan.toUpperCase() });
  const cipher = await crypto.subtle.encrypt({ name: "AES-CBC", iv: ivBytes }, cryptoKey, enc.encode(json));
  return toBase64(new Uint8Array(cipher));
}

// "Investor or partner not found" family — the PAN isn't mapped under our
// partner account at Wylth. Kept loose until Wylth confirms the exact text.
function isNotMapped(message: string): boolean {
  return /not\s+found/i.test(message);
}

class DirectGateway implements WylthGateway {
  constructor(
    private baseUrl: string,
    private apiKey: string,
    private secretKey: string,
    private iv: string,
  ) {}

  async login(pan: string): Promise<WylthLoginResult> {
    const data = await encryptPayload(pan, this.secretKey, this.iv);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/investorsso/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ data }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (_e) {
      // Deno puts the URL in network errors; keep the host out of anything
      // that might be surfaced.
      return { ok: false, notMapped: false, message: "Wylth is unreachable." };
    }
    const body = await res.json().catch(() => null) as
      | { Status?: number; Message?: string; Data?: { redirect_url?: string } | null }
      | null;
    if (!body) return { ok: false, notMapped: false, message: `Wylth returned a non-JSON response (HTTP ${res.status}).` };
    const url = body.Data?.redirect_url;
    if (body.Status === 0 && typeof url === "string" && /^https:\/\//i.test(url)) {
      return { ok: true, redirectUrl: url };
    }
    const message = String(body.Message ?? "").trim() || `Wylth login failed (HTTP ${res.status}).`;
    return { ok: false, notMapped: isNotMapped(message), message };
  }
}

// Mock (dev / tests): any PAN ending in "Z" is treated as not mapped so the
// RM-alert path can be exercised; everything else gets a fake link.
class MockGateway implements WylthGateway {
  // deno-lint-ignore require-await
  async login(pan: string): Promise<WylthLoginResult> {
    if (pan.toUpperCase().endsWith("Z")) {
      return { ok: false, notMapped: true, message: "Mock: investor not found" };
    }
    return { ok: true, redirectUrl: "https://example.com/?wylth-sso-mock=1" };
  }
}

// null = not configured (no mock override and credentials missing).
export function getWylthGateway(): WylthGateway | null {
  if ((Deno.env.get("WYLTH_GATEWAY") ?? "").trim().toLowerCase() === "mock") return new MockGateway();
  const base = Deno.env.get("WYLTH_API_BASE")?.trim();
  const apiKey = Deno.env.get("WYLTH_API_KEY")?.trim();
  const secretKey = Deno.env.get("WYLTH_SECRET_KEY")?.trim();
  const iv = Deno.env.get("WYLTH_IV")?.trim();
  if (base && apiKey && secretKey && iv) return new DirectGateway(base, apiKey, secretKey, iv);
  return null;
}
