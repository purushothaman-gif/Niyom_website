import React from 'react';

// Shared 2-page A4 Deal Confirmation Note. Rendered by:
//  - the CRM preview (DealConfirmation.tsx)
//  - the public client page (PublicDealView.tsx)
//  - the signed-PDF generator (public page passes signatureDataUrl)
//
// The root element id is the html2pdf target; keep it stable.

export interface DealDocumentData {
  confirmation_number: string;
  deal_date: string;
  created_at?: string;
  transaction_type: string;
  product_type: string;
  security_name: string;
  isin: string;
  quantity: number;
  rate_per_unit: number;
  stamp_duty: number;
  settlement_amount: number;
  snap_client_name: string;
  snap_pan: string;
  snap_dp_name: string;
  snap_demat_account: string;
  snap_depository: string;
  // Client bank snapshot — only needed to print the "remit to" account on a
  // SELL (where Niyom pays the client). Optional so buy-only callers are unaffected.
  snap_bank_name?: string;
  snap_bank_account?: string;
  snap_bank_ifsc?: string;
}

// Niyom is the fixed counterparty on every deal note. On a BUY the client buys
// from us (Niyom = Seller); on a SELL the client sells to us (Niyom = Buyer).
// The party columns below swap by direction, but Niyom's identity is constant.
const NIYOM_PARTY = {
  clientName: 'NIYOM WEALTH DISTRIBUTION LLP',
  pan: 'AAZFN2255K',
  dpName: 'Chola Securities',
  dpId: 'IN300572',
  clientId: '10158746',
  depository: 'NSDL',
} as const;

// Niyom's collection account — printed when the client is the buyer (BUY),
// i.e. the client pays into this account.
const NIYOM_BANK = {
  bankName: 'IDFC FIRST BANK',
  accountName: 'NIYOM WEALTH DISTRIBUTION LLP',
  accountNumber: '89394331135',
  ifsc: 'IDFB0080131',
  branch: 'Anna Nagar West Branch',
} as const;

function fmt(n: number) {
  return '₹' + (n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface Props {
  deal: DealDocumentData;
  /** When present, rendered in the client signature box (accepted documents). */
  signatureDataUrl?: string;
  /** Date string shown next to the client signature when signed. */
  acceptedDate?: string;
  /** Override the html2pdf target id (defaults to the CRM preview id). */
  pdfElementId?: string;
  /**
   * Controls whether the final "Confirmation" block (company + client signature
   * boxes, dates, authorized signatory) is rendered. Defaults to true so the
   * signed PDF and CRM preview are unchanged. The public client preview passes
   * false to hide it until the client has signed.
   */
  showConfirmation?: boolean;
}

export default function DealDocument({ deal, signatureDataUrl, acceptedDate, pdfElementId = 'deal-confirmation-pdf-content', showConfirmation = true }: Props) {
  // SELL reverses the parties: the client sells to us, so the client is the
  // Seller and Niyom is the Buyer, and the money is remitted TO the client.
  const isSell = (deal.transaction_type || '').trim().toLowerCase() === 'sell';
  const dpId = (deal.snap_demat_account || '').slice(0, 8);
  const clientIdDP = (deal.snap_demat_account || '').slice(-8);

  // Party column data. `clientParty` is always the client's snapshot; `niyomParty`
  // is always Niyom. Which one sits under "Buyer" vs "Seller" flips on SELL.
  const clientParty = [
    ['Client Name', deal.snap_client_name],
    ['PAN Number', deal.snap_pan],
    ['DP Name', deal.snap_dp_name],
    ['DP ID', dpId],
    ['Client ID', clientIdDP],
    ['Depository', deal.snap_depository || '-'],
  ] as const;
  const niyomParty = [
    ['Client Name', NIYOM_PARTY.clientName],
    ['PAN Number', NIYOM_PARTY.pan],
    ['DP Name', NIYOM_PARTY.dpName],
    ['DP ID', NIYOM_PARTY.dpId],
    ['Client ID', NIYOM_PARTY.clientId],
    ['Depository', NIYOM_PARTY.depository],
  ] as const;
  const buyerParty = isSell ? niyomParty : clientParty;
  const sellerParty = isSell ? clientParty : niyomParty;
  const headerDate = fmtDate(deal.deal_date);
  const createdAt = deal.created_at
    ? new Date(deal.created_at).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true })
    : '';
  const docRef = `DEAL-CONFIRMATION-${deal.confirmation_number}-${deal.deal_date}`;

  const cellStyle: React.CSSProperties = { border: '1px solid #000', color: '#000', padding: '4px 8px', fontSize: '8px' };
  const cellLabelStyle: React.CSSProperties = { ...cellStyle, fontWeight: 600, textAlign: 'center', width: '38%' };
  const cellValueStyle: React.CSSProperties = { ...cellStyle, textAlign: 'center' };
  const cellValueBoldStyle: React.CSSProperties = { ...cellValueStyle, fontWeight: 700 };
  const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', border: '1px solid #000' };
  const sectionTitleStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 700, color: '#000', marginBottom: '6px' };

  const PageHeader = ({ pageNum }: { pageNum: number }) => (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '7px', color: '#000', marginBottom: '10px' }}>
        <span>{createdAt}</span>
        <span style={{ fontWeight: 600 }}>{docRef}</span>
        <span>{pageNum}/2</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="/niyomlogo.png" alt="Niyom Wealth" style={{ height: '40px', objectFit: 'contain' }} />
          <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: '14px', color: '#8B7355' }}>Wealth Reimagined</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ fontSize: '8px', color: '#000', marginBottom: '4px' }}>Ref: {deal.confirmation_number}  •  {headerDate}</p>
          <p style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '3px', color: '#000' }}>DEAL NOTE</p>
        </div>
      </div>
      <div style={{ borderBottom: '2px solid #000', marginTop: '8px' }} />
    </div>
  );

  const PageFooter = ({ pageNum }: { pageNum: number }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', color: '#000', marginTop: 'auto', paddingTop: '8px' }}>
      <span>www.niyomwealth.com</span>
      <span>{pageNum}/2</span>
    </div>
  );

  return (
    <div
      id={pdfElementId}
      style={{ fontFamily: 'Calibri, Arial, sans-serif', color: '#000', background: '#fff', margin: '0 auto', maxWidth: '794px' }}
    >
      {/* ==================== PAGE 1 ==================== */}
      <div style={{
        width: '210mm', minHeight: '297mm', maxWidth: '100%', padding: '10mm 20mm',
        background: '#fff', position: 'relative', display: 'flex', flexDirection: 'column', boxSizing: 'border-box',
      }}>
        <PageHeader pageNum={1} />

        <div style={{ marginBottom: '14px' }}>
          <p style={sectionTitleStyle}>Deal Information</p>
          <table style={tableStyle}>
            <tbody>
              {[
                ['Deal Date', fmtDate(deal.deal_date)],
                ['Transaction Type', deal.transaction_type],
                ['Product Type', deal.product_type],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td style={cellLabelStyle}>{label}</td>
                  <td style={cellValueStyle}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <p style={sectionTitleStyle}>Security / Instrument Details</p>
          <table style={tableStyle}>
            <tbody>
              {[
                ['Security / Company Name', deal.security_name, false],
                ['ISIN Number', deal.isin, false],
                ['Quantity', deal.quantity.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), false],
                [`Rate per ${deal.product_type === 'Unlisted Share' ? 'Share' : 'Unit'} (₹)`, `${(Math.round(deal.rate_per_unit * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Per ${deal.product_type === 'Unlisted Share' ? 'Share' : 'Unit'}`, false],
                ['Stamp Duty / Charges (₹)', `${(Math.round((deal.stamp_duty || 0) * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, false],
                ['Settlement Amount (₹)', fmt(deal.settlement_amount), true],
              ].map(([label, value, bold]) => (
                <tr key={label as string}>
                  <td style={cellLabelStyle}>{label}</td>
                  <td style={bold ? cellValueBoldStyle : cellValueStyle}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th colSpan={2} style={{ ...cellStyle, fontWeight: 700, textAlign: 'center', fontSize: '10px' }}>Buyer Details</th>
                <th colSpan={2} style={{ ...cellStyle, fontWeight: 700, textAlign: 'center', fontSize: '10px' }}>Seller Details</th>
              </tr>
              <tr>
                {['Particulars', 'Details', 'Particulars', 'Details'].map((h, i) => (
                  <th key={i} style={{ ...cellStyle, fontWeight: 700, textAlign: 'center', width: '25%', fontSize: '9px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {buyerParty.map(([bl, bv], i) => {
                const [sl, sv] = sellerParty[i];
                return (
                  <tr key={i}>
                    <td style={{ ...cellStyle, fontWeight: 500, textAlign: 'center' }}>{bl}</td>
                    <td style={{ ...cellStyle, textAlign: 'center' }}>{bv}</td>
                    <td style={{ ...cellStyle, fontWeight: 500, textAlign: 'center' }}>{sl}</td>
                    <td style={{ ...cellStyle, textAlign: 'center' }}>{sv}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginBottom: '14px' }}>
          {/* BUY: client pays into Niyom's account. SELL: Niyom remits the
              settlement to the client (Seller), so we print the client's bank. */}
          <p style={sectionTitleStyle}>{isSell ? "Payment Details (Remitted to Seller's Account)" : 'Payment Details'}</p>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <table style={{ ...tableStyle, width: '60%' }}>
              <thead>
                <tr>
                  <th style={{ ...cellStyle, fontWeight: 700, textAlign: 'center', fontSize: '9px' }}>Particulars</th>
                  <th style={{ ...cellStyle, fontWeight: 700, textAlign: 'center', fontSize: '9px' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {(isSell
                  ? [
                      ['Bank Name', deal.snap_bank_name || '-'],
                      ['Account Name', deal.snap_client_name || '-'],
                      ['Account Number', deal.snap_bank_account || '-'],
                      ['IFSC Code', deal.snap_bank_ifsc || '-'],
                    ]
                  : [
                      ['Bank Name', NIYOM_BANK.bankName],
                      ['Account Name', NIYOM_BANK.accountName],
                      ['Account Number', NIYOM_BANK.accountNumber],
                      ['IFSC Code', NIYOM_BANK.ifsc],
                      ['Branch', NIYOM_BANK.branch],
                    ]
                ).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ ...cellStyle, fontWeight: 500, textAlign: 'center' }}>{k}</td>
                    <td style={{ ...cellStyle, textAlign: 'center' }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ marginBottom: '0' }}>
          <p style={{ fontSize: '11px', fontWeight: 900, color: '#000', marginBottom: '8px', textTransform: 'uppercase' }}>TERMS & CONDITIONS</p>
          {[
            ['1. Deal Confirmation & Settlement', 'The transaction shall be considered final upon mutual confirmation of price, quantity, and settlement terms by both parties. The Buyer shall ensure timely payment, and the Seller shall ensure timely transfer of securities/bonds as per the agreed timeline.'],
            ['2. Intermediary Role', 'Niyom Wealth Distribution LLP acts solely as a facilitator/intermediary for the transaction and shall not be held liable for any payment default, transfer delay, counterparty failure, operational issue, or investment-related loss.'],
            ['3. Risk & Disclaimer', 'Investments in unlisted shares and secondary bonds are subject to market, liquidity, credit, regulatory, and valuation risks. Niyom Wealth Distribution LLP does not guarantee listing, liquidity, returns, redemption, coupon payments, price appreciation, or exit opportunities. Clients are advised to undertake independent due diligence before transacting.'],
            ['4. Compliance, Taxes & Charges', 'All parties confirm compliance with applicable KYC norms, SEBI/RBI regulations, taxation laws, and depository requirements. Applicable taxes, stamp duty, DP charges, brokerage, and statutory levies shall be borne by the respective parties as mutually agreed.'],
          ].map(([title, body]) => (
            <div key={title} style={{ marginBottom: '6px' }}>
              <p style={{ fontSize: '9px', fontWeight: 700, color: '#000', marginBottom: '2px' }}>{title}</p>
              <p style={{ fontSize: '8px', color: '#000', lineHeight: '1.5' }}>{body}</p>
            </div>
          ))}
        </div>

        <PageFooter pageNum={1} />
      </div>

      {/* ==================== PAGE 2 ==================== */}
      <div style={{
        width: '210mm', maxWidth: '100%', padding: '10mm 20mm 15mm 20mm',
        background: '#fff', position: 'relative', boxSizing: 'border-box',
      }}>
        <PageHeader pageNum={2} />

        <div style={{ marginBottom: '14px' }}>
          <p style={{ fontSize: '9px', fontWeight: 700, color: '#000', marginBottom: '2px' }}>5. Jurisdiction & Acceptance</p>
          <p style={{ fontSize: '8px', color: '#000', lineHeight: '1.5' }}>
            Any dispute, claim, default, or legal proceeding arising out of the transaction shall be subject to the exclusive jurisdiction of the courts in Chennai, Tamil Nadu, India. Execution of payment, transfer instruction, email/WhatsApp confirmation, or deal confirmation shall constitute deemed acceptance of these Terms & Conditions.
          </p>
        </div>

        {showConfirmation && (
        <div style={{ marginBottom: '14px' }}>
          <p style={{ fontSize: '11px', fontWeight: 700, color: '#000', marginBottom: '4px' }}>Confirmation</p>
          <p style={{ fontSize: '8px', color: '#000', marginBottom: '10px' }}>We hereby confirm that the above details are true and agreed upon by both parties.</p>
          <table style={tableStyle}>
            <tbody>
              <tr>
                <td style={{ border: '1px solid #000', width: '50%', padding: 0, verticalAlign: 'top' }}>
                  <div style={{ padding: '6px 10px', fontSize: '9px', fontWeight: 700, color: '#000', borderBottom: '1px solid #000' }}>For NIYOM WEALTH DISTRIBUTION LLP</div>
                  <div style={{ padding: '12px 14px' }}>
                    <p style={{ fontSize: '8px', color: '#000', marginBottom: '6px' }}>Authorized Signatory Name: <strong>Purushothaman S</strong></p>
                    <p style={{ fontSize: '8px', color: '#000', marginBottom: '10px' }}>Date: {fmtDate(deal.deal_date)}</p>
                    <div style={{ height: '64px', display: 'flex', alignItems: 'flex-end' }}>
                      <img
                        src="/Screenshot_2026-04-06_at_4.02.25_PM.png"
                        alt="Signature and Seal"
                        style={{ height: '62px', maxWidth: '190px', width: 'auto', objectFit: 'contain', display: 'block' }}
                      />
                    </div>
                    <div style={{ borderTop: '1px solid #000', marginTop: '4px', paddingTop: '5px' }}>
                      <p style={{ fontSize: '8px', color: '#000', fontWeight: 600 }}>Designated Partner</p>
                      <p style={{ fontSize: '7px', color: '#555', marginTop: '2px' }}>Signature &amp; Seal · For NIYOM WEALTH DISTRIBUTION LLP</p>
                    </div>
                  </div>
                </td>
                <td style={{ border: '1px solid #000', width: '50%', padding: 0, verticalAlign: 'top' }}>
                  <div style={{ padding: '6px 10px', fontSize: '9px', fontWeight: 700, color: '#000', borderBottom: '1px solid #000' }}>Client / Counterparty</div>
                  <div style={{ padding: '12px 14px' }}>
                    <p style={{ fontSize: '8px', color: '#000', marginBottom: '6px' }}>Authorized Signatory Name: <strong>{deal.snap_client_name}</strong></p>
                    <p style={{ fontSize: '8px', color: '#000', marginBottom: '10px' }}>Date: {acceptedDate ? fmtDate(acceptedDate) : ''}</p>
                    <div style={{ height: '64px', display: 'flex', alignItems: 'flex-end' }}>
                      {signatureDataUrl
                        ? <img src={signatureDataUrl} alt="Client Signature" style={{ height: '62px', maxWidth: '230px', width: 'auto', objectFit: 'contain', display: 'block' }} />
                        : <div style={{ height: '62px' }} />}
                    </div>
                    <div style={{ borderTop: '1px solid #000', marginTop: '4px', paddingTop: '5px' }}>
                      <p style={{ fontSize: '8px', color: '#000', fontWeight: 600 }}>Signature</p>
                      <p style={{ fontSize: '7px', color: '#555', marginTop: '2px' }}>Accepted &amp; e-signed by client</p>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        )}

        <p style={{ textAlign: 'center', fontSize: '8px', color: '#000', marginTop: '12px', marginBottom: '12px', padding: '6px 0' }}>
          Website: www.niyomwealth.com
        </p>

        <img
          src="/niyomlogo.png"
          alt="Niyom Wealth Watermark"
          style={{ position: 'absolute', bottom: '60px', left: '50%', transform: 'translateX(-50%)', width: '250px', opacity: 0.08, pointerEvents: 'none' }}
        />
        <div style={{ height: '548px' }} />
        <PageFooter pageNum={2} />
      </div>
    </div>
  );
}
