/**
 * sxp_cancel payload.
 *
 * This one is worth pinning because it is spec-derived rather than
 * live-verified: the route sat in the proxy for days with no callers, and its
 * original body (`sxp_reg_num` + `member`) would have been rejected by BSE on
 * the first real cancellation — wrong id field, and both mandatory fields
 * missing. The reference is BSE's own worked example, §8.3.2.1 of
 * bse-starmfv2-api_2.0.0.pdf:
 *
 *   { "data": { "reg_no": "c49c7035-…", "reason_cd": 6,
 *               "reason_cd_msg": "", "type": "SIP" } }
 */
import { describe, it, expect } from 'vitest';
import { toSxpCancel } from './mappers.js';

const REG_NO = 'c49c7035-12cd-422c-b61c-1cbfa61914fc';

describe('toSxpCancel', () => {
  it('addresses the plan by reg_no and carries both mandatory fields', () => {
    const payload = toSxpCancel({ regNo: REG_NO, type: 'SIP', reasonCode: 6 }, '66899');

    expect(payload.reg_no).toBe(REG_NO);
    expect(payload.reason_cd).toBe(6);
    // Plan type under both keys BSE's spec uses for it — see toSxpCancel.
    expect(payload.type).toBe('SIP');
    expect(payload.sxp_type).toBe('SIP');
    expect(payload.member).toBe('66899');
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
