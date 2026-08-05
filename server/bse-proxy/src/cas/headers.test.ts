/**
 * Scheme headers, and the many ways a PDF breaks one across lines.
 *
 * A header that does not parse does not fail loudly — it takes its entire block
 * with it, so the scheme, its units and its transactions are simply absent. One
 * real statement (04-Aug-2026, 34 schemes) imported ten schemes short: ₹13.9L
 * of a ₹54.8L portfolio, recorded as "reconciled", because the completeness
 * check that would have caught it was blind at the time (see totals.test.ts).
 *
 * Every header below is verbatim from that statement. Invented ones would have
 * been useless: the parser already handled the shapes we imagined.
 */
import { describe, expect, it } from 'vitest';
import { parseDetailedSchemes } from './detailed.js';

/** A minimal but complete scheme block, so the header is what is under test. */
const block = (headerLines: string[]) =>
  [
    'Sundaram Mutual Fund',
    'PAN: AQDPM9866D KYC: OK  PAN: OK',
    ...headerLines,
    'Folio No: 61015022015 / 0',
    'R Madhavi',
    ' Opening Unit Balance: 0.000',
    '04-Aug-2020 200,000.00 28.03847,135.212Purchase 7,135.212',
    'NAV on 03-Aug-2026: INR 25.08 Market Value on 03-Aug-2026: INR 178,970.38',
    'Closing Unit Balance: 7,135.212 Total Cost Value: 200,000.00',
  ].join('\n');

const parseOne = (headerLines: string[]) => parseDetailedSchemes(block(headerLines));

describe('scheme headers that wrap', () => {
  it('reads one that does not wrap at all', () => {
    const [s] = parseOne([
      '176SBDP-SUNDARAM AGGRESSIVE HYBRID FUND - REGULAR PLAN (Non Demat ) - ISIN: INF173K01CI4(Advisor: ARN-74926)',
      'Registrar : CAMS',
    ]);
    expect(s).toBeDefined();
    expect(s.closingUnits).toBeCloseTo(7135.212, 3);
    expect(s.marketValue).toBeCloseTo(178970.38, 2);
  });

  it('wraps before the demat marker', () => {
    // HDFC Balanced Advantage, the shape that was already handled.
    const out = parseOne([
      'HGFGT-HDFC Balanced Advantage Fund - Direct Plan - Growth Option (formerly HDFC Growth',
      '(Non-Demat) - ISIN: INF179K01WA6(Advisor: INZ000208032)',
      'Registrar : CAMS',
    ]);
    expect(out).toHaveLength(1);
  });

  it('wraps INSIDE the demat marker, leaving "-Demat )" to start the line', () => {
    // ICICI Prudential Large Cap, twice in the statement — ₹5.74L between them.
    const out = parseOne([
      'P1191-ICICI Prudential Large Cap Fund (erstwhile Bluechip Fund) - Growth (formerly ICICI Prudential Focused Bluechip Equity Fund) (Non',
      '-Demat) - ISIN: INF109K01BL4(Advisor: ARN-163992)',
      'Registrar : CAMS',
    ]);
    expect(out).toHaveLength(1);
  });

  it('wraps right after "ISIN:", leaving the code to start the next line', () => {
    // Aditya Birla Sun Life Value Fund — ₹2.94L.
    const out = parseOne([
      'B296G-Aditya Birla Sun Life Value Fund - Growth-Regular Plan(formerly known as Aditya Birla Sun Life Pure Value Fund) (Non-Demat) - ISIN:',
      'INF209K01LF3(Advisor: ARN-163992)',
      'Registrar : CAMS',
    ]);
    expect(out).toHaveLength(1);
  });

  it('wraps before "ISIN:", leaving it to start the next line', () => {
    // Aditya Birla Sun Life Large Cap IDCW — ₹25,104.67.
    const out = parseOne([
      'B91-Aditya Birla Sun Life Large Cap Fund -IDCW',
      '#-Regular Plan(formerly known as Aditya Birla Sun Life Frontline Equity Fund) (Non-Demat) -',
      'ISIN: INF209K01EC5 - Reinvest(Advisor: ARN-163992)',
      'Registrar : CAMS',
    ]);
    expect(out).toHaveLength(1);
  });

  it('wraps on BOTH sides of the ISIN at once', () => {
    /*
     * Sundaram Aggressive Hybrid IDCW Payout — ₹1.79L, and the last scheme to
     * come back. The name breaks above the ISIN and the advisor's bracket is
     * left open below it, so neither a forward nor a backward join alone is
     * enough.
     */
    const out = parseOne([
      '176SBDP-SUNDARAM AGGRESSIVE HYBRID FUND - REGULAR PLAN MONTHLY IDCW',
      '#',
      'PAYOUT (Non Demat) - ISIN: INF173K01CI4 - Payout(Advisor:',
      'ARN-74926) Registrar :',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].closingUnits).toBeCloseTo(7135.212, 3);
  });
});

describe('IDCW plans name their option between the ISIN and the advisor', () => {
  it('accepts "- Payout" and "- Reinvest"', () => {
    for (const header of [
      ['108DYDPD-UTI Dividend Yield Fund - Regular Plan (Non Demat) - ISIN: INF789F01448 - Payout(Advisor: ARN-74926) Registrar :', 'KFINTECH'],
      ['UKHERDP-Union Aggressive Hybrid Fund - Regular Plan - IDCW', '#', 'Payout (Non-Demat) - ISIN: INF582M01HE0 - Payout(Advisor: ARN-265132) Registrar : CAMS'],
    ]) {
      expect(parseOne(header)).toHaveLength(1);
    }
  });

  it('accepts an option with no advisor at all', () => {
    // UTI Value Fund Regular — "- Payout Registrar :", nothing in between.
    expect(
      parseOne(['108OPDPD-UTI Value Fund - Regular Plan (Non Demat) - ISIN: INF789F01AE0 - Payout Registrar :', 'KFINTECH']),
    ).toHaveLength(1);
  });
});

describe('the joiner does not over-reach', () => {
  it('leaves a header that never parses alone rather than swallowing the block', () => {
    // No ISIN code at all: nothing to rebuild, and the folio line below must
    // survive for the next scheme.
    const out = parseDetailedSchemes(
      ['Some Mutual Fund', 'Total gibberish - ISIN: not-a-code', 'Folio No: 123 / 0'].join('\n'),
    );
    expect(out).toHaveLength(0);
  });

  it('keeps two adjacent schemes apart', () => {
    const text = [
      block([
        '176SBDP-SUNDARAM AGGRESSIVE HYBRID FUND - REGULAR PLAN (Non Demat ) - ISIN: INF173K01CI4(Advisor: ARN-74926)',
        'Registrar : CAMS',
      ]),
      block([
        'B296G-Aditya Birla Sun Life Value Fund - Growth (Non-Demat) - ISIN:',
        'INF209K01LF3(Advisor: ARN-163992)',
        'Registrar : CAMS',
      ]),
    ].join('\n');
    const out = parseDetailedSchemes(text);
    expect(out).toHaveLength(2);
    expect(out[0].isin).not.toBe(out[1].isin);
  });
});

describe('the advisor code, when the header wrapped away from it', () => {
  /*
   * The advisor is OPTIONAL in a scheme header, so a header missing it still
   * parses — and a long fund name that pushed "(Advisor: ARN-362707)" onto the
   * next line left the holding attributed to nobody. The client was shown
   * "Advisor not stated" on a fund that is under OUR ARN, and the held-away
   * split was wrong by that holding.
   *
   * Silent, because a scheme with no advisor is real and common: every Direct
   * plan has none.
   */
  const sbi = (headerLines: string[]) =>
    parseDetailedSchemes(
      [
        'SBI Mutual Fund',
        'PAN: AKCPH1164J KYC: OK  PAN: OK',
        ...headerLines,
        'Folio No: 12345678 / 0',
        'A CLIENT',
        ' Opening Unit Balance: 0.000',
        '29-Jul-2026 59,997.00 66.5991900.844Switch In 900.844',
        'NAV on 03-Aug-2026: INR 66.67 Market Value on 03-Aug-2026: INR 60,065.22',
        'Closing Unit Balance: 900.844 Total Cost Value: 59,997.00',
      ].join('\n'),
    );

  it('reads it from the header when it fits', () => {
    const [s] = sbi([
      'SBIMAG-SBI Multi Asset Allocation Fund Regular Growth (Non-Demat) - ISIN: INF200K01VT2(Advisor: ARN-362707)',
      'Registrar : CAMS',
    ]);
    expect(s.advisorCode).toBe('ARN-362707');
  });

  it('picks it up from the next line when the name pushed it there', () => {
    const [s] = sbi([
      'SBIMAG-SBI Multi Asset Allocation Fund Regular Growth (formerly SBI Magnum Monthly Income Plan) (Non-Demat) - ISIN: INF200K01VT2',
      '(Advisor: ARN-362707) Registrar : CAMS',
    ]);
    expect(s.advisorCode).toBe('ARN-362707');
    expect(s.registrar).toBe('CAMS');
  });

  it('picks it up when it trails the registrar', () => {
    const [s] = sbi([
      'SBIMAG-SBI Multi Asset Allocation Fund Regular Growth (Non-Demat) - ISIN: INF200K01VT2 Registrar :',
      'CAMS (Advisor: ARN-362707)',
    ]);
    expect(s.advisorCode).toBe('ARN-362707');
  });

  it('leaves it blank when the statement really does not state one', () => {
    // Verbatim from a real statement: ISIN straight to Registrar, no advisor.
    // A Direct plan has no distributor, and inventing one would claim a
    // holding we do not advise on.
    const [s] = sbi([
      '108OPD2G-UTI Value Fund - Direct Plan (Non Demat) - ISIN: INF789F01VB2 Registrar :',
      'KFINTECH',
    ]);
    expect(s.advisorCode).toBe('');
  });

  it('never overwrites an advisor the header already stated', () => {
    const [s] = sbi([
      'SBIMAG-SBI Multi Asset Allocation Fund Regular Growth (Non-Demat) - ISIN: INF200K01VT2(Advisor: ARN-163992)',
      '(Advisor: ARN-362707) Registrar : CAMS',
    ]);
    expect(s.advisorCode).toBe('ARN-163992');
  });

  it('does not borrow an advisor from the block below', () => {
    // The fragment scan stops at the folio line, so a following scheme's
    // advisor cannot leak upwards into one that genuinely has none.
    const out = parseDetailedSchemes(
      [
        'SBI Mutual Fund',
        '108OPD2G-UTI Value Fund - Direct Plan (Non Demat) - ISIN: INF789F01VB2 Registrar :',
        'KFINTECH',
        'Folio No: 111 / 0',
        ' Opening Unit Balance: 0.000',
        '29-Jul-2026 59,997.00 66.5991900.844Purchase 900.844',
        'NAV on 03-Aug-2026: INR 66.67 Market Value on 03-Aug-2026: INR 60,065.22',
        'Closing Unit Balance: 900.844 Total Cost Value: 59,997.00',
        '(Advisor: ARN-362707)',
      ].join('\n'),
    );
    expect(out[0].advisorCode).toBe('');
  });
});
