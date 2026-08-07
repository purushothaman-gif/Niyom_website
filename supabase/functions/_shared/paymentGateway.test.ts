/**
 * The payment gateway decides two things that are invisible until they are
 * wrong with real money: WHICH Cashfree environment a link is created in, and
 * WHETHER the call goes out through the droplet's whitelisted IP. A mistake in
 * either produces a link that looks fine to the RM — it just charges nothing,
 * or fails to be created at all once IP whitelisting is on.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/* The module reads Deno.env inside its functions, so the stub only has to exist
   before a call — but it is installed at import time so nothing can observe a
   half-built global. */
let env: Record<string, string> = {};
(globalThis as any).Deno = { env: { get: (k: string) => env[k] } };

const { getPaymentGateway } = await import('./paymentGateway.ts');

type Captured = { url: string; headers: Record<string, string>; body: any };
let captured: Captured[] = [];
const realFetch = globalThis.fetch;

/** Stub fetch, recording every call and replying with a canned response. */
function stubFetch(status: number, payload: unknown) {
  captured = [];
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    } as unknown as Response;
  }) as typeof fetch;
}

const LINK = {
  link_id: 'DC-EMP01-001-abc',
  link_amount: 2500.5,
  link_currency: 'INR',
  link_purpose: 'Payment for Deal Confirmation DC-EMP01-001',
  customer_details: {
    customer_name: 'Test Client',
    customer_email: 'client@example.com',
    customer_phone: '9876543210',
  },
  link_notify: { send_sms: false, send_email: false },
};

beforeEach(() => {
  env = {};
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('gateway selection', () => {
  it('returns null when nothing is configured, rather than a mock link', () => {
    // A mock payment link is worse than an error: it tells an RM the client was
    // asked to pay, via a URL that takes no money.
    expect(getPaymentGateway()).toBeNull();
  });

  it('calls Cashfree directly when only Cashfree credentials are set', () => {
    env = { CASHFREE_APP_ID: 'app', CASHFREE_SECRET_KEY: 'secret' };
    expect(getPaymentGateway()?.kind).toBe('direct');
  });

  it('prefers the droplet relay when it is configured', () => {
    env = {
      CASHFREE_APP_ID: 'app',
      CASHFREE_SECRET_KEY: 'secret',
      PAY_RELAY_URL: 'https://api.niyomwealth.com',
      PAY_RELAY_SECRET: 'relay-secret',
    };
    expect(getPaymentGateway()?.kind).toBe('relay');
  });

  it('does not use the relay when only half of it is configured', () => {
    // A half-set relay silently falling back to direct is fine; a half-set
    // relay being USED would send the call with no authentication.
    env = {
      CASHFREE_APP_ID: 'app',
      CASHFREE_SECRET_KEY: 'secret',
      PAY_RELAY_URL: 'https://api.niyomwealth.com',
    };
    expect(getPaymentGateway()?.kind).toBe('direct');
  });
});

describe('environment selection (direct)', () => {
  const creds = { CASHFREE_APP_ID: 'app', CASHFREE_SECRET_KEY: 'secret' };

  it('defaults to sandbox when CASHFREE_ENV is unset', async () => {
    env = { ...creds };
    stubFetch(200, { link_url: 'https://x', link_status: 'ACTIVE' });
    await getPaymentGateway()!.createLink(LINK);
    expect(captured[0].url).toBe('https://sandbox.cashfree.com/pg/links');
  });

  it('uses production only for an explicit "production"', async () => {
    env = { ...creds, CASHFREE_ENV: 'production' };
    stubFetch(200, { link_url: 'https://x', link_status: 'ACTIVE' });
    await getPaymentGateway()!.createLink(LINK);
    expect(captured[0].url).toBe('https://api.cashfree.com/pg/links');
  });

  it('tolerates the casing and whitespace a pasted value carries', async () => {
    for (const value of [' production', 'Production', 'PRODUCTION\n']) {
      env = { ...creds, CASHFREE_ENV: value };
      stubFetch(200, { link_url: 'https://x', link_status: 'ACTIVE' });
      await getPaymentGateway()!.createLink(LINK);
      expect(captured[0].url, `CASHFREE_ENV=${JSON.stringify(value)}`)
        .toBe('https://api.cashfree.com/pg/links');
    }
  });

  it('falls back to SANDBOX, not production, for an unrecognised value', async () => {
    // The safe direction: a typo must fail to take real money, never start
    // taking it.
    env = { ...creds, CASHFREE_ENV: 'prod' };
    stubFetch(200, { link_url: 'https://x', link_status: 'ACTIVE' });
    await getPaymentGateway()!.createLink(LINK);
    expect(captured[0].url).toBe('https://sandbox.cashfree.com/pg/links');
  });

  it('sends the credentials and API version Cashfree expects', async () => {
    env = { ...creds };
    stubFetch(200, { link_url: 'https://x', link_status: 'ACTIVE' });
    await getPaymentGateway()!.createLink(LINK);
    expect(captured[0].headers['x-client-id']).toBe('app');
    expect(captured[0].headers['x-client-secret']).toBe('secret');
    expect(captured[0].headers['x-api-version']).toBe('2022-09-01');
  });
});

describe('relay path', () => {
  const relayEnv = {
    PAY_RELAY_URL: 'https://api.niyomwealth.com',
    PAY_RELAY_SECRET: 'relay-secret',
  };

  it('posts the link payload to the droplet with the relay secret', async () => {
    env = { ...relayEnv };
    stubFetch(200, { link_url: 'https://pay/x', link_status: 'ACTIVE' });
    const out = await getPaymentGateway()!.createLink(LINK);

    expect(captured[0].url).toBe('https://api.niyomwealth.com/pay/link');
    expect(captured[0].headers['x-relay-secret']).toBe('relay-secret');
    // Never send Cashfree credentials to the relay — the droplet holds its own.
    expect(captured[0].headers['x-client-secret']).toBeUndefined();
    expect(captured[0].body.link_id).toBe(LINK.link_id);
    expect(captured[0].body.link_amount).toBe(2500.5);
    expect(out).toMatchObject({ ok: true, link_url: 'https://pay/x', link_status: 'ACTIVE' });
  });

  it('tolerates a trailing slash on the relay URL', async () => {
    env = { ...relayEnv, PAY_RELAY_URL: 'https://api.niyomwealth.com/' };
    stubFetch(200, { link_url: 'https://pay/x', link_status: 'ACTIVE' });
    await getPaymentGateway()!.createLink(LINK);
    expect(captured[0].url).toBe('https://api.niyomwealth.com/pay/link');
  });

  it("unwraps Cashfree's own message out of the droplet error envelope", async () => {
    // The droplet replies { error, cashfree: <cashfree body> }. The RM should
    // see "link_id already exists", not a generic gateway failure.
    env = { ...relayEnv };
    stubFetch(409, {
      error: 'Payment link creation failed',
      cashfree: { message: 'link_id already exists' },
    });
    const out = await getPaymentGateway()!.createLink(LINK);
    expect(out.ok).toBe(false);
    expect(out.error).toBe('link_id already exists');
    expect(out.status).toBe(409);
  });

  it('falls back to the droplet error when Cashfree sent no message', async () => {
    env = { ...relayEnv };
    stubFetch(503, { error: 'Cashfree payments not configured' });
    const out = await getPaymentGateway()!.createLink(LINK);
    expect(out).toMatchObject({ ok: false, error: 'Cashfree payments not configured' });
  });
});

describe('cancelLink', () => {
  const creds = { CASHFREE_APP_ID: 'app', CASHFREE_SECRET_KEY: 'secret' };
  const relayEnv = {
    PAY_RELAY_URL: 'https://api.niyomwealth.com',
    PAY_RELAY_SECRET: 'relay-secret',
  };

  it('cancels through Cashfree on the direct path', async () => {
    env = { ...creds };
    stubFetch(200, { link_status: 'CANCELLED' });
    const out = await getPaymentGateway()!.cancelLink('DC-EMP01-001-abc');
    expect(captured[0].url).toBe('https://sandbox.cashfree.com/pg/links/DC-EMP01-001-abc/cancel');
    expect(captured[0].headers['x-client-secret']).toBe('secret');
    expect(out.ok).toBe(true);
  });

  it('cancels through the droplet on the relay path', async () => {
    env = { ...relayEnv };
    stubFetch(200, { link_status: 'CANCELLED' });
    const out = await getPaymentGateway()!.cancelLink('DC-EMP01-001-abc');
    expect(captured[0].url).toBe('https://api.niyomwealth.com/pay/link/cancel');
    expect(captured[0].headers['x-relay-secret']).toBe('relay-secret');
    expect(captured[0].body.link_id).toBe('DC-EMP01-001-abc');
    expect(out.ok).toBe(true);
  });

  it('escapes a link id that would otherwise alter the path', async () => {
    env = { ...creds };
    stubFetch(200, {});
    await getPaymentGateway()!.cancelLink('a/../b');
    expect(captured[0].url).toBe('https://sandbox.cashfree.com/pg/links/a%2F..%2Fb/cancel');
  });

  it('reports failure without throwing when the link is already paid', async () => {
    // The caller treats cancellation as best-effort, so this must come back as
    // a value rather than an exception — a throw here would abort a send whose
    // new link is already live.
    env = { ...creds };
    stubFetch(409, { message: 'link is already PAID' });
    const out = await getPaymentGateway()!.cancelLink('DC-EMP01-001-abc');
    expect(out).toMatchObject({ ok: false, error: 'link is already PAID', status: 409 });
  });

  it("unwraps Cashfree's message from the droplet envelope on the relay path", async () => {
    env = { ...relayEnv };
    stubFetch(409, {
      error: 'Link cancellation failed',
      cashfree: { message: 'link is already PAID' },
    });
    const out = await getPaymentGateway()!.cancelLink('DC-EMP01-001-abc');
    expect(out).toMatchObject({ ok: false, error: 'link is already PAID' });
  });
});

describe('result shaping', () => {
  const creds = { CASHFREE_APP_ID: 'app', CASHFREE_SECRET_KEY: 'secret' };

  it('treats a 200 with no link_url as a failure', async () => {
    // Otherwise the caller emails the client a link of "null".
    env = { ...creds };
    stubFetch(200, { link_status: 'ACTIVE' });
    const out = await getPaymentGateway()!.createLink(LINK);
    expect(out.ok).toBe(false);
    expect(out.link_url).toBeNull();
  });

  it("surfaces Cashfree's error message on a non-2xx", async () => {
    env = { ...creds };
    stubFetch(400, { message: 'link_amount is invalid' });
    const out = await getPaymentGateway()!.createLink(LINK);
    expect(out).toMatchObject({ ok: false, error: 'link_amount is invalid', status: 400 });
  });
});
