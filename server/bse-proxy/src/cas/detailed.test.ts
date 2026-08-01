/**
 * Transaction classification.
 *
 * Every description below is verbatim from a real CAMS statement, because this
 * is where invented test data would have been worthless: the bug was that the
 * rule matched the phrasings we imagined ("Purchase", "SIP ...") and missed the
 * ones registrars actually write.
 *
 * The cost of getting it wrong is invisible. A misclassified transaction still
 * parses its units correctly, so every balance check passes, the holdings are
 * right to the paisa, and the statement reconciles — only the money-weighted
 * return is wrong. On one real import, 121 purchases worth 2,04,489 fell
 * through to OTHER and the client was shown 70% where the truth was 6.59%.
 */
import { describe, expect, it } from 'vitest';
import { classify } from './detailed.js';

const typeOf = (s: string) => classify(s).type;

describe('classify — purchases, as registrars actually write them', () => {
  it('recognises the phrasings that used to fall through to OTHER', () => {
    // None of these start with "purchase" or "sip", which is all the old rule
    // could match.
    expect(typeOf('Systematic Investment (1)')).toBe('PURCHASE');
    expect(typeOf('Systematic Investment Existing Folio with SIP (1)')).toBe('PURCHASE');
    expect(typeOf('Systematic Investment New Purchase with SIP (1)')).toBe('PURCHASE');
    expect(typeOf('Systematic Purchase (Continuous Offer) - Instalment 2/904 - via Internet')).toBe('PURCHASE');
    expect(typeOf('Systematic Purchase (Continuous Offer)-BSE - Instalment No - 1')).toBe('PURCHASE');
    expect(typeOf('Initial Purchase')).toBe('PURCHASE');
    expect(typeOf('NFO Purchase')).toBe('PURCHASE');
  });

  it('still recognises the ones that always worked', () => {
    expect(typeOf('Purchase')).toBe('PURCHASE');
    expect(typeOf('SIP Purchase-BSE - Instalment No - 1 Online')).toBe('PURCHASE');
  });
});

describe('classify — redemptions', () => {
  it('recognises a plain redemption', () => {
    expect(typeOf('Redemption - NEFT PAYOUT-BSE - - HDFCN52025093099093409')).toBe('REDEMPTION');
  });

  it('keeps a redemption that names the charge deducted from it', () => {
    /*
     * The trap that broke the first fix. These mention STT, so testing for the
     * charge before the action turned real redemptions worth ~1,01,500 into fee
     * rows — money leaving the portfolio, recorded as a rounding-sized cost.
     */
    expect(typeOf('Redemption - NEFT PAYOUT-NSE - - HDFCH01074361490 , less STT')).toBe('REDEMPTION');
    expect(typeOf('*Redemption-BSE - - HDFCN52025093099220834 , less STT')).toBe('REDEMPTION');
  });

  it('treats a systematic withdrawal as a redemption, not an investment', () => {
    // Reads like the systematic purchases above and is the opposite.
    expect(typeOf('Systematic Withdrawal (1)')).toBe('REDEMPTION');
  });
});

describe('classify — charges carry no action word', () => {
  it('recognises the fee rows', () => {
    expect(typeOf('STT Paid')).toBe('STT');
    expect(typeOf('Stamp Duty')).toBe('STAMP_DUTY');
  });

  it('does not match "stt" inside an ordinary word', () => {
    expect(typeOf('Settlement of units')).not.toBe('STT');
  });
});

describe('classify — switches and dividends', () => {
  it('separates the two legs of a switch', () => {
    expect(typeOf('Switch Out - To Some Other Fund')).toBe('SWITCH_OUT');
    expect(typeOf('Switch In - From Some Other Fund')).toBe('SWITCH_IN');
  });

  it('recognises a dividend payout', () => {
    expect(typeOf('IDCW @ Rs.0.19478990 per unit')).toBe('DIVIDEND');
    expect(typeOf('Dividend Payout')).toBe('DIVIDEND');
  });
});

describe('classify — the guarantee the reconciliation gate relies on', () => {
  /*
   * reconcileDetailed now FAILS an import when a unit-bearing transaction comes
   * back as OTHER, precisely because no other check can see the problem. That
   * guard is only useful if the ordinary phrasings never land there.
   */
  const REAL_DESCRIPTIONS = [
    'Systematic Investment (1)',
    'Systematic Investment Existing Folio with SIP (1)',
    'Systematic Purchase (Continuous Offer)-BSE - Instalment No - 2/999 Online',
    'Initial Purchase',
    'NFO Purchase',
    'SIP Purchase-BSE - Instalment No - 1 Online',
    'Redemption - NEFT PAYOUT-BSE - - HDFCN52025093099093409 , less STT',
    'Switch Out - To Another Scheme',
  ];

  it('leaves no ordinary transaction unclassified', () => {
    const stragglers = REAL_DESCRIPTIONS.filter((d) => typeOf(d) === 'OTHER');
    expect(stragglers).toEqual([]);
  });

  it('still reports OTHER for something genuinely unrecognised', () => {
    // The guard has to be able to fire, or it protects nothing.
    expect(typeOf('Registration of Nominee')).toBe('OTHER');
  });
});
