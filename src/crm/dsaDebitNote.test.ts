/*
 * Escaping tests for the DSA debit-note HTML builder.
 *
 * buildDebitNoteHtml does not only feed html2pdf: PublicDebitNoteView renders
 * its output with dangerouslySetInnerHTML on an UNAUTHENTICATED page. Every
 * field below arrives from the database, so a payload stored in a DSA or client
 * name reaches a partner's browser at the moment they sign a payout document.
 *
 * The builder pulls in html2pdf.js at module scope, which wants a browser; it is
 * stubbed since none of these tests touch the PDF path.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('html2pdf.js', () => ({ default: () => ({}) }));

const { buildDebitNoteHtml } = await import('./dsaDebitNote');
type DebitNoteInput = Parameters<typeof buildDebitNoteHtml>[0];

/** Classic breakout payloads: element injection, and attribute breakout. */
const XSS = `<img src=x onerror="alert(1)">`;
const ATTR_BREAK = `" onerror="alert(1)`;

function makeInput(over: Partial<DebitNoteInput> = {}): DebitNoteInput {
  return {
    debitNoteNumber: 'DN-2026-08-0001',
    date: new Date('2026-08-09T00:00:00Z'),
    month: 8,
    year: 2026,
    dsa: {
      id: 'd1',
      dsa_code: 'DSA-001',
      employee_id: 'e1',
      full_name: 'Test Partner',
      email: 'partner@example.com',
      mobile: '9876543210',
      pan: 'ABCDE1234F',
      address: '1 Test Street',
      bank_name: 'Test Bank',
      bank_account: '1234567890',
      bank_ifsc: 'TEST0001234',
      photo_url: null,
      pan_doc_url: null,
      bank_doc_url: null,
      status: 'active',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
    particulars: [{
      client_name: 'Test Client',
      client_code: 'NIYOM-001',
      product_type: 'bond',
      product_name: 'Test Bond',
      quantity: 10,
      payout: 1000,
    }],
    total: 1000,
    tdsAmount: 20,
    netPayable: 980,
    generatedBy: 'Test Employee',
    ...over,
  } as DebitNoteInput;
}

const countOf = (s: string, ch: string) => s.split(ch).length - 1;

/**
 * The invariant that actually matters: injecting a payload must not add a single
 * markup character to the document.
 *
 * Checking for substrings like `onerror=` is the wrong test — once escaped, the
 * payload still *reads* as `&lt;img src=x onerror=&quot;alert(1)&quot;&gt;`, and
 * that inert text trips a naive substring check while being perfectly safe.
 * Comparing the counts of `<`, `>` and `"` against a benign baseline is exact:
 * an unescaped `<` would open an element, and an unescaped `"` would close an
 * attribute and let the next token become a live handler.
 */
function expectNoNewMarkup(baseline: string, injected: string) {
  for (const ch of ['<', '>', '"']) {
    expect(
      countOf(injected, ch),
      `payload introduced a new ${ch} character`,
    ).toBe(countOf(baseline, ch));
  }
  // And the payload is present, escaped — proving it was rendered, not dropped.
  expect(injected).toContain('&lt;img src=x');
  expect(injected).not.toContain('<img src=x');
}

describe('buildDebitNoteHtml — DSA fields', () => {
  const dsaFields = [
    'full_name', 'dsa_code', 'pan', 'mobile', 'email', 'address',
    'bank_name', 'bank_account', 'bank_ifsc',
  ] as const;

  for (const field of dsaFields) {
    it(`escapes dsa.${field}`, () => {
      const base = makeInput();
      expectNoNewMarkup(
        buildDebitNoteHtml(base),
        buildDebitNoteHtml(makeInput({ dsa: { ...base.dsa, [field]: XSS } })),
      );
    });
  }
});

describe('buildDebitNoteHtml — particulars', () => {
  const rowFields = ['client_name', 'client_code', 'product_name', 'product_type'] as const;

  for (const field of rowFields) {
    it(`escapes particulars[].${field}`, () => {
      const base = makeInput();
      expectNoNewMarkup(
        buildDebitNoteHtml(base),
        buildDebitNoteHtml(makeInput({ particulars: [{ ...base.particulars[0], [field]: XSS }] })),
      );
    });
  }
});

describe('buildDebitNoteHtml — remaining interpolated fields', () => {
  it('escapes debitNoteNumber', () => {
    expectNoNewMarkup(
      buildDebitNoteHtml(makeInput()),
      buildDebitNoteHtml(makeInput({ debitNoteNumber: XSS })),
    );
  });

  it('escapes generatedBy', () => {
    expectNoNewMarkup(
      buildDebitNoteHtml(makeInput()),
      buildDebitNoteHtml(makeInput({ generatedBy: XSS })),
    );
  });

  it('escapes signedDate', () => {
    // signedDate has no benign baseline in the default input (the unsigned copy
    // renders a blank date line), so compare against a plain signed date.
    expectNoNewMarkup(
      buildDebitNoteHtml(makeInput({ signedDate: '09 August 2026' })),
      buildDebitNoteHtml(makeInput({ signedDate: XSS })),
    );
  });

  it('escapes the client signature src so it cannot break out of the attribute', () => {
    const benign = buildDebitNoteHtml(
      makeInput({ clientSignatureDataUrl: 'data:image/png;base64,AAAA' }),
    );
    const injected = buildDebitNoteHtml(makeInput({ clientSignatureDataUrl: ATTR_BREAK }));
    // A breakout would close src= and add two quotes plus a live handler; the
    // quote count must be identical to the benign render.
    expect(countOf(injected, '"')).toBe(countOf(benign, '"'));
    expect(injected).not.toContain(`src="" onerror="alert(1)"`);
    expect(injected).toContain('&quot; onerror=&quot;alert(1)');
  });
});

describe('buildDebitNoteHtml — output is still correct', () => {
  it('renders ordinary values as readable text, not entities', () => {
    const html = buildDebitNoteHtml(makeInput());
    expect(html).toContain('Test Partner');
    expect(html).toContain('NIYOM-001');
    expect(html).toContain('Test Bond');
    expect(html).toContain('DN-2026-08-0001');
    expect(html).toContain('Generated by Test Employee');
  });

  it('escapes an ampersand in a legitimate name without mangling the rest', () => {
    // A real partner name, not an attack — must survive as one readable entity.
    const base = makeInput();
    const html = buildDebitNoteHtml(
      makeInput({ dsa: { ...base.dsa, full_name: 'Ram & Sons' } }),
    );
    expect(html).toContain('Ram &amp; Sons');
    expect(html).not.toContain('Ram & Sons');
  });

  it('still shows the em-dash placeholder for an empty bank field', () => {
    const base = makeInput();
    const html = buildDebitNoteHtml(
      makeInput({ dsa: { ...base.dsa, bank_name: '' } }),
    );
    expect(html).toContain('—');
  });
});
