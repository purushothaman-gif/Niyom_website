/**
 * sxp_cancel payload.
 *
 * Worth pinning because the route sat in the proxy with no callers, and its
 * original body (`sxp_reg_num` + `member`) would have been rejected by BSE on
 * the first real cancellation — wrong id field, and both mandatory fields
 * missing.
 *
 * Every expectation below was checked against the live demo on 5-Aug-2026, not
 * read off the spec: BSE's field table and its worked example §8.3.2.1
 * disagree about the plan-type key, and the demo says the table wins
 * (`sxp_type`; `type` alone answers `required: Type`). The types matter too —
 * `reg_no` as a number and `reason_cd` as a string both give `invalid_json`.
 */
import { describe, it, expect } from 'vitest';
import { toSxpCancel } from './mappers.js';

const REG_NO = 'c49c7035-12cd-422c-b61c-1cbfa61914fc';

describe('toSxpCancel', () => {
  it('addresses the plan by reg_no and carries both mandatory fields', () => {
    const payload = toSxpCancel({ regNo: REG_NO, type: 'SIP', reasonCode: 6 }, '66899');

    expect(payload.reg_no).toBe(REG_NO);
    expect(payload.reason_cd).toBe(6);
    // The field table's key, not the example's `type` — demo rejects that one.
    expect(payload.sxp_type).toBe('SIP');
    expect(payload).not.toHaveProperty('type');
    expect(payload.member).toBe('66899');
  });

  it('sends reg_no as a string and reason_cd as a number', () => {
    // BSE answers invalid_json to either of these the wrong way round.
    const payload = toSxpCancel(
      { regNo: 202600000031617 as unknown as string, type: 'SIP', reasonCode: '7' as unknown as number },
      '66899',
    );

    expect(payload.reg_no).toBe('202600000031617');
    expect(payload.reason_cd).toBe(7);
  });

  it('omits reason_cd_msg rather than sending it empty', () => {
    // BSE reads an empty string as a supplied value on other endpoints, which
    // is how blank father_name/spouse_name used to fail UCC registration.
    expect('reason_cd_msg' in toSxpCancel({ regNo: REG_NO, type: 'SWP', reasonCode: 3 }, '66899'))
      .toBe(false);
    expect(
      'reason_cd_msg' in
        toSxpCancel({ regNo: REG_NO, type: 'SWP', reasonCode: 3, note: '   ' }, '66899'),
    ).toBe(false);
  });

  it('sends the reason in words for code 13 (Others), trimmed and capped', () => {
    const payload = toSxpCancel(
      { regNo: REG_NO, type: 'STP', reasonCode: 13, note: `  ${'x'.repeat(250)}  ` },
      '66899',
    );

    expect(payload.reason_cd).toBe(13);
    expect(payload.reason_cd_msg).toBe('x'.repeat(200));
  });
});
