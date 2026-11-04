// Direction classification for the shared transaction classifier. Focused on the
// CAMS "change of broker" transfer legs (TICOB / TOCOB, codes TI / TO), which a
// client moving a folio to our ARN produces and which must count toward invested
// cost as a switch leg rather than falling through to 'other'.
import { describe, it, expect } from 'vitest';
import { classifyTxn } from './txns.ts';

describe('classifyTxn — change-of-broker transfers', () => {
  it('treats a transfer-in (TICOB / TI) as an inflow', () => {
    expect(classifyTxn('TICOB', 'TI', null, null)).toBe('switch_in');
    expect(classifyTxn(null, 'TI', null, null)).toBe('switch_in');
    expect(classifyTxn('Change of Broker', null, null, null)).toBe('switch_in');
  });

  it('treats a transfer-out (TOCOB / TO) as an outflow', () => {
    expect(classifyTxn('TOCOB', 'TO', null, null)).toBe('switch_out');
    expect(classifyTxn(null, 'TO', null, null)).toBe('switch_out');
    expect(classifyTxn('Change of Broker Out', null, null, null)).toBe('switch_out');
  });

  it('still classifies the common types correctly', () => {
    expect(classifyTxn('Purchase', 'P', null, null)).toBe('purchase');
    expect(classifyTxn('Redemption', 'R', null, null)).toBe('redemption');
    expect(classifyTxn('Switch Over - In', 'SI', null, null)).toBe('switch_in');
    expect(classifyTxn('Dividend Reinvestment', 'DR', null, 'Y')).toBe('purchase');
    expect(classifyTxn('Dividend Payout', 'DP', null, null)).toBe('dividend');
    expect(classifyTxn('Something odd', 'ZZ', null, null)).toBe('other');
  });
});
