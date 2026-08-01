/**
 * Request lifecycle.
 *
 * `isOpenRequest` decides which screen a client lands on when they reopen the
 * import. Get it wrong in one direction and someone mid-journey is asked to
 * start again; wrong in the other and a finished request traps them on a
 * waiting screen for a statement that already arrived.
 */
import { describe, expect, it } from 'vitest';
import { isOpenRequest, type CasRequestStatus } from './CasRequestService';

const ALL: CasRequestStatus[] = [
  'draft',
  'awaiting_statement',
  'received',
  'imported',
  'failed',
  'cancelled',
  'expired',
];

describe('isOpenRequest', () => {
  it('treats a request still in flight as open', () => {
    expect(isOpenRequest('draft')).toBe(true);
    expect(isOpenRequest('awaiting_statement')).toBe(true);
    // 'received' means a statement turned up and is being processed — still the
    // client's active journey, so they should see progress rather than a form.
    expect(isOpenRequest('received')).toBe(true);
  });

  it('treats every terminal status as closed', () => {
    expect(isOpenRequest('imported')).toBe(false);
    expect(isOpenRequest('failed')).toBe(false);
    expect(isOpenRequest('cancelled')).toBe(false);
    expect(isOpenRequest('expired')).toBe(false);
  });

  it('classifies every known status, so a new one cannot be silently ignored', () => {
    const open = ALL.filter(isOpenRequest);
    const closed = ALL.filter((s) => !isOpenRequest(s));
    expect(open.length + closed.length).toBe(ALL.length);
    expect(open).toEqual(['draft', 'awaiting_statement', 'received']);
  });
});
