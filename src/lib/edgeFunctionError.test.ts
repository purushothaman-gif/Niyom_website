/**
 * The case that matters is the one the old code got wrong: a non-2xx, where
 * `data` is null and the real reason is sitting unread on `error.context`.
 */
import { describe, it, expect } from 'vitest';
import { edgeFunctionErrorMessage } from './edgeFunctionError.ts';

/** What supabase-js hands back on a non-2xx: null data, generic message. */
function httpError(status: number, body: unknown, asText = false): unknown {
  const init = { status, headers: { 'Content-Type': asText ? 'text/plain' : 'application/json' } };
  return {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(asText ? String(body) : JSON.stringify(body), init),
  };
}

const FALLBACK = 'Could not send payment link.';

describe('edgeFunctionErrorMessage', () => {
  it('recovers the real reason from a non-2xx body', async () => {
    // The exact failure that prompted this: the RM saw the generic string while
    // Cashfree's actionable message sat unread in the response.
    const real = 'link_creation_api is not enabled or approved. Please reach out to care@cashfree.com.';
    const err = httpError(502, { success: false, error: real });
    await expect(edgeFunctionErrorMessage(err, null, FALLBACK)).resolves.toBe(real);
  });

  it('never returns the library’s generic string when a body message exists', async () => {
    const err = httpError(502, { success: false, error: 'This deal is already fully paid.' });
    const msg = await edgeFunctionErrorMessage(err, null, FALLBACK);
    expect(msg).not.toContain('non-2xx');
    expect(msg).toBe('This deal is already fully paid.');
  });

  it('prefers data.error when the function returned 2xx with success:false', async () => {
    const msg = await edgeFunctionErrorMessage(null, { success: false, error: 'Deal not found.' }, FALLBACK);
    expect(msg).toBe('Deal not found.');
  });

  it('accepts a body that uses `message` instead of `error`', async () => {
    const err = httpError(500, { message: 'Internal error.' });
    await expect(edgeFunctionErrorMessage(err, null, FALLBACK)).resolves.toBe('Internal error.');
  });

  it('leaves the body readable for any later handler', async () => {
    // clone() matters: a Response body is a one-shot stream, and consuming it
    // here would hand the caller an empty one.
    const err = httpError(502, { error: 'boom' }) as { context: Response };
    await edgeFunctionErrorMessage(err, null, FALLBACK);
    await expect(err.context.json()).resolves.toEqual({ error: 'boom' });
  });

  it('falls back to the library message when the body is empty JSON', async () => {
    const err = httpError(502, {});
    await expect(edgeFunctionErrorMessage(err, null, FALLBACK))
      .resolves.toBe('Edge Function returned a non-2xx status code');
  });

  it('uses a short plain-text body', async () => {
    const err = httpError(502, 'upstream timed out', true);
    await expect(edgeFunctionErrorMessage(err, null, FALLBACK)).resolves.toBe('upstream timed out');
  });

  it('refuses an HTML error page rather than dumping it into a toast', async () => {
    const err = httpError(502, '<!DOCTYPE html><html><body>Bad Gateway</body></html>', true);
    const msg = await edgeFunctionErrorMessage(err, null, FALLBACK);
    expect(msg).toBe('Edge Function returned a non-2xx status code');
  });

  it('refuses an over-long text body', async () => {
    const err = httpError(502, 'x'.repeat(500), true);
    await expect(edgeFunctionErrorMessage(err, null, FALLBACK))
      .resolves.toBe('Edge Function returned a non-2xx status code');
  });

  it('returns the fallback when there is nothing else at all', async () => {
    await expect(edgeFunctionErrorMessage(null, null, FALLBACK)).resolves.toBe(FALLBACK);
    await expect(edgeFunctionErrorMessage({}, undefined, FALLBACK)).resolves.toBe(FALLBACK);
  });

  it('still recovers a real body message on client-facing pages', async () => {
    // opting out of the library message must not cost the useful one — a client
    // being told "Incorrect OTP" is the whole point.
    const err = httpError(400, { error: 'Incorrect OTP. Please try again.' });
    const msg = await edgeFunctionErrorMessage(err, null, FALLBACK, { allowLibraryMessage: false });
    expect(msg).toBe('Incorrect OTP. Please try again.');
  });

  it('never shows a client the library’s technical string', async () => {
    // A client signing a deal should see our friendly wording, not our plumbing.
    const err = httpError(500, {});
    const msg = await edgeFunctionErrorMessage(err, null, FALLBACK, { allowLibraryMessage: false });
    expect(msg).toBe(FALLBACK);
    expect(msg).not.toContain('non-2xx');
  });

  it('does not throw when context is not a Response', async () => {
    // A helper used only on the error path must never manufacture a second
    // error and bury the first.
    const err = { message: 'weird', context: { not: 'a response' } };
    await expect(edgeFunctionErrorMessage(err, null, FALLBACK)).resolves.toBe('weird');
  });
});
