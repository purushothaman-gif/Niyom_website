/**
 * BSE StAR MF 2.0 client — the only module that talks to BSE.
 * -----------------------------------------------------------------------------
 * Handles: login → access_token (cached, re-login on expiry/401), the
 * `{"data": {…}}` request envelope, and response unwrapping.
 *
 * Endpoint + payload shapes come from BSE's StARMF 2.0 Integration Portal
 * (see docs/bse-starmf-v2-api.md in the repo root). Anything not yet verified
 * against the live sandbox is marked UAT-VERIFY.
 */
import type { ProxyConfig } from './config.js';
import { decryptPayload, encryptPayload, loadJoseKeys, type JoseKeys } from './jose.js';

/** BSE response envelope (documented shape: status/data/messages). */
interface BseEnvelope<T> {
  status: string;
  data: T;
  messages?: unknown;
}

export class BseError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly bseMessages?: unknown,
  ) {
    super(message);
  }
}

export class BseClient {
  private token: string | null = null;
  private tokenIssuedAt = 0;
  /** In-flight login, so concurrent callers share one round trip (see getToken). */
  private loginInFlight: Promise<string> | null = null;
  /** Conservative token lifetime; UAT-VERIFY the real expiry (likely JWT exp). */
  private static TOKEN_TTL_MS = 45 * 60 * 1000;

  /** Loaded once, lazily — reading keys off disk on every call would be silly. */
  private joseKeys: Promise<JoseKeys> | null = null;

  constructor(private readonly cfg: ProxyConfig) {}

  private keys(): Promise<JoseKeys> {
    this.joseKeys ??= loadJoseKeys(
      this.cfg.bseJosePrivateKeyPath,
      this.cfg.bseJoseRemoteKeyPath,
    );
    return this.joseKeys;
  }

  private async login(): Promise<string> {
    const res = await fetch(`${this.cfg.bseBaseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { username: this.cfg.bseUsername, password: this.cfg.bsePassword } }),
    });
    if (!res.ok) {
      throw new BseError(`BSE login failed (${res.status})`, res.status);
    }
    const body = (await res.json()) as BseEnvelope<{ access_token?: string }> & {
      access_token?: string;
    };
    // UAT-VERIFY: token location — documented as access_token; tolerate both
    // {data:{access_token}} and a top-level access_token.
    const token = body.data?.access_token ?? body.access_token;
    if (!token) {
      throw new BseError('BSE login succeeded but no access_token in response', 502, body);
    }
    this.token = token;
    this.tokenIssuedAt = Date.now();
    return token;
  }

  /**
   * The member's BSE token, shared by every caller.
   *
   * SINGLE-FLIGHT: when the token is stale, concurrent requests must NOT each
   * call login(). Ten clients ordering at once would otherwise fire ten logins;
   * if BSE issues one session per member, each login invalidates the previous
   * and the losers cascade into 401s. Callers that arrive during a login join
   * the in-flight promise instead of starting another.
   */
  private async getToken(): Promise<string> {
    if (this.token && Date.now() - this.tokenIssuedAt < BseClient.TOKEN_TTL_MS) {
      return this.token;
    }
    if (this.loginInFlight) return this.loginInFlight;
    this.loginInFlight = this.login().finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
  }

  /**
   * POST a BSE v2 endpoint with the {"data": …} envelope. Retries once on 401
   * with a fresh login (expired token).
   */
  /**
   * Same as post(), but `data` is sent verbatim — for endpoints whose envelope
   * is an ARRAY rather than an object (e.g. /v2/get_2fa_link).
   */
  async postRaw<T>(route: string, data: unknown): Promise<T> {
    return this.post<T>(route, data);
  }

  async post<T>(route: string, data: unknown, retry = true): Promise<T> {
    const token = await this.getToken();
    const jose = this.cfg.bseJose;

    // Login stays plain even under JOSE — verified against production, where a
    // plain login succeeds and only the authenticated calls are rejected.
    const requestBody = jose
      ? await encryptPayload({ data }, await this.keys())
      : JSON.stringify({ data });

    const res = await fetch(`${this.cfg.bseBaseUrl}${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': jose ? 'application/jose' : 'application/json',
        Authorization: `Bearer ${token}`,
        // Production rejects every authenticated call without this; demo never
        // asks for it. Login itself does NOT need it — verified against prod.
        ...(this.cfg.bseOrgId ? { 'X-API-Org-ID': this.cfg.bseOrgId } : {}),
      },
      body: requestBody,
    });

    if (res.status === 401 && retry) {
      // Only invalidate the token WE used. Under concurrency another request may
      // already have refreshed it, and blindly nulling would discard a good
      // token and start the stampede this class exists to prevent.
      if (this.token === token) {
        this.token = null;
        this.tokenIssuedAt = 0;
      }
      return this.post<T>(route, data, false);
    }

    const text = await res.text();
    let parsed: BseEnvelope<T> | null = null;
    try {
      // An encrypted response is a compact JWS — three base64url parts, no
      // braces. Errors can still come back as plain JSON, so sniff rather than
      // assume, and never let a decrypt failure hide the real error text.
      parsed =
        jose && res.ok && !text.trimStart().startsWith('{')
          ? await decryptPayload<BseEnvelope<T>>(text, await this.keys())
          : (JSON.parse(text) as BseEnvelope<T>);
    } catch {
      /* non-JSON / undecryptable error body */
    }

    if (!res.ok) {
      throw new BseError(
        `BSE ${route} failed (${res.status})`,
        res.status,
        parsed?.messages ?? text.slice(0, 500),
      );
    }
    if (parsed && parsed.status && parsed.status !== 'success') {
      throw new BseError(`BSE ${route} returned status=${parsed.status}`, 502, parsed.messages);
    }
    return (parsed?.data ?? (parsed as unknown as T)) as T;
  }
}
