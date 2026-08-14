/**
 * This classifier decides whether the render job can exit ZERO.
 *
 * Everything it matches is reported as success to CI, so the cases that matter
 * most are the ones it must NOT match — an infrastructure failure classified as
 * "content gone" means a green run that rendered nothing, which nobody
 * investigates. The strings below are real: they were captured from the live
 * endpoint and from Supabase itself, not invented.
 */
import { describe, expect, it } from 'vitest';
import { isContentGone } from './classifyError.ts';

/** How index.ts wraps a failed call before this ever sees it. */
const wrap = (action: string, status: number, body: string) =>
  `${action} failed (${status}): ${body}`;

describe('isContentGone', () => {
  describe('content genuinely gone — skip, do not fail the job', () => {
    it('matches the message mkt-auto-render-io actually returns', () => {
      // Verbatim from supabase/functions/mkt-auto-render-io/index.ts.
      expect(isContentGone(wrap('asset-urls', 404, '{"error":"content row no longer exists"}'))).toBe(true);
    });

    it('matches wording the sweep may use later', () => {
      expect(isContentGone('content expired before render')).toBe(true);
      expect(isContentGone('slot was swept')).toBe(true);
      expect(isContentGone('content has been deleted')).toBe(true);
    });
  });

  describe('infrastructure failures — MUST fail the job', () => {
    it('does not match an undeployed or misrouted function', () => {
      /*
       * The regression this file exists for. Supabase answers a request for a
       * function that is not deployed with exactly this body; an earlier
       * `not found` alternative matched it, so every slot was "skipped" and the
       * run went green having rendered nothing at all.
       */
      expect(
        isContentGone(wrap('claim', 404, '{"code":"NOT_FOUND","message":"Requested function was not found"}')),
      ).toBe(false);
    });

    it('does not match a 404 on an asset upload', () => {
      expect(isContentGone(wrap('Upload of og', 404, 'Not Found'))).toBe(false);
    });

    it('does not match a bad secret', () => {
      expect(isContentGone(wrap('claim', 401, '{"error":"Unauthorized"}'))).toBe(false);
    });

    it('does not match the endpoint rejecting our payload', () => {
      expect(isContentGone(wrap('finalise', 400, '{"error":"slot_id and content_id are required"}'))).toBe(false);
      expect(isContentGone(wrap('claim', 400, '{"error":"Unknown action: claim"}'))).toBe(false);
    });

    it('does not match a broken harness or a blank render', () => {
      expect(isContentGone('Harness not built. Run: npm run build:harness')).toBe(false);
      expect(
        isContentGone('Suspiciously small assets (likely a blank render): og.png, story.png'),
      ).toBe(false);
      expect(isContentGone('No upload URL issued for og')).toBe(false);
    });

    it('does not match a timeout or a network drop', () => {
      expect(isContentGone('fetch failed')).toBe(false);
      expect(isContentGone('Navigation timeout of 30000 ms exceeded')).toBe(false);
    });
  });
});
