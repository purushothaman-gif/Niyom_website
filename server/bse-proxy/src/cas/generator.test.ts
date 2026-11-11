/**
 * The vendor call.
 *
 * Pinned because every field here is a promise to a third party about a real
 * client: the wrong key name silently drops the PAN, and a loose success check
 * tells a client a statement is coming when nothing was requested.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ProxyConfig } from '../config.js';
import {
  buildMailbackBody,
  isAcceptablePassword,
  mailbackEnabled,
  requestCasMailback,
} from './generator.js';

const cfg = { casparserApiKey: 'k_test', casparserAuthority: 'cams' } as ProxyConfig;
const input = {
  email: 'investor@example.com',
  pan: 'abcde1234f',
  fromDate: '1990-01-01',
  toDate: '2026-11-11',
  password: 'Kmrtqx@4827',
};

const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('buildMailbackBody', () => {
  it('uses the vendor field names and upper-cases the PAN', () => {
    expect(buildMailbackBody(cfg, input)).toEqual({
      email: 'investor@example.com',
      pan_no: 'ABCDE1234F',
      from_date: '1990-01-01',
      to_date: '2026-11-11',
      password: 'Kmrtqx@4827',
      cas_authority: 'cams',
    });
  });

  it('leaves the PAN out rather than send a malformed one', () => {
    expect(buildMailbackBody(cfg, { ...input, pan: 'not-a-pan' })).not.toHaveProperty('pan_no');
    expect(buildMailbackBody(cfg, { ...input, pan: null })).not.toHaveProperty('pan_no');
  });
});

describe('requestCasMailback', () => {
  it('is off without a key', async () => {
    expect(mailbackEnabled({ casparserApiKey: null } as ProxyConfig)).toBe(false);
    await expect(
      requestCasMailback({ ...cfg, casparserApiKey: null } as ProxyConfig, input, reply(200, {})),
    ).rejects.toMatchObject({ httpStatus: 503 });
  });

  it('sends the key as a header and resolves on success', async () => {
    const f = reply(200, { status: 'success', msg: 'CAS request submitted.' });
    await expect(requestCasMailback(cfg, input, f)).resolves.toBeUndefined();
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://api.casparser.in/v4/generate');
    expect((init as RequestInit).headers).toMatchObject({ 'x-api-key': 'k_test' });
  });

  it('does not treat a 200 without "success" as placed', async () => {
    await expect(
      requestCasMailback(cfg, input, reply(200, { status: 'failed', msg: 'x' })),
    ).rejects.toMatchObject({ httpStatus: 502 });
  });

  it('blames the input for a plain 4xx, and never echoes the vendor text', async () => {
    const err = await requestCasMailback(
      cfg,
      input,
      reply(400, { status: 'failed', msg: 'internal vendor detail' }),
    ).catch((e) => e);
    expect(err.httpStatus).toBe(400);
    expect(err.message).not.toContain('vendor');
  });

  it('treats auth and quota failures as ours, not the client’s', async () => {
    for (const s of [401, 402, 403, 429, 500]) {
      await expect(requestCasMailback(cfg, input, reply(s, {}))).rejects.toMatchObject({
        httpStatus: 502,
      });
    }
  });

  it('survives the service being unreachable', async () => {
    const down = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    await expect(requestCasMailback(cfg, input, down)).rejects.toMatchObject({ httpStatus: 502 });
  });
});

describe('isAcceptablePassword', () => {
  it('accepts what the portal generates and rejects what the registrar would', () => {
    expect(isAcceptablePassword('Kmrtqx@4827')).toBe(true);
    expect(isAcceptablePassword('ABCDE1234F')).toBe(false); // a PAN: no special
    expect(isAcceptablePassword('short@1A')).toBe(true);
    expect(isAcceptablePassword('1Kmrtqx@482')).toBe(false);
  });
});
