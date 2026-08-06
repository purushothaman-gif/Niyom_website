import { emailFooterHtml, emailFooterText } from "./email_footer.ts";
// -----------------------------------------------------------------------------
// Transfer / Deal Closure — email templates
//
// One entry point: buildClosureEmail(caseKind, context). The case discriminator
// is picked by the caller from the live ledger — the admin never chooses.
//
//   single : one payment covered the full deal
//   multi  : more than one payment; no prior payment_reminder was sent
//   dues   : more than one payment AND a prior payment_reminder had been sent
//
// The HTML shell is intentionally identical to the shell used by
// send-payment-acknowledgement so the brand voice, footer, and regulatory
// block stay consistent across the customer's inbox.
// -----------------------------------------------------------------------------


const MODE_LABEL: Record<string, string> = {
  imps: "IMPS", neft: "NEFT", rtgs: "RTGS", upi: "UPI",
  cheque: "Cheque", cash: "Cash", bank_transfer: "Bank Transfer",
  online_gateway: "Online Gateway", demand_draft: "Demand Draft",
  internal_adjustment: "Internal Adjustment",
};

export type ClosureCase = "single" | "multi" | "dues";

export interface LedgerRow {
  payment_number: string;
  payment_date:   string;   // ISO date
  payment_mode:   string;
  utr_number?:    string | null;
  cheque_number?: string | null;
  amount_inr:     number;
}

export interface ClosureContext {
  clientName:         string;
  confirmationNumber: string;
  transferReference:  string;
  dealAmount:         number;
  totalPaid:          number;
  paymentCount:       number;
  latestPaymentDate:  string | null;
  ledger:             LedgerRow[];
  /*
   * Nullable, like latestPaymentDate above. The column is nullable and fmtDate
   * already renders null as "—", so claiming `string` was the type lying
   * rather than the data being guaranteed.
   */
  transferredAt:      string | null;
  year:               number;
  // SELL: the client sold to us, so money was remitted TO them (no payments
  // collected). Flips the closing copy from "investment executed / received" to
  // "sale executed / remitted".
  isSell?:            boolean;
}

const inr = (n: number): string =>
  "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | null | undefined): string => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
};

// -----------------------------------------------------------------------------
// pickCase — server-side selector; keep in this file so the templates and their
// selection rule live together.
// -----------------------------------------------------------------------------
export function pickCase(paymentCount: number, hadPriorReminder: boolean): ClosureCase {
  if (paymentCount <= 1) return "single";
  return hadPriorReminder ? "dues" : "multi";
}

// -----------------------------------------------------------------------------
// Subject
// -----------------------------------------------------------------------------
export function subjectFor(c: ClosureCase, confirmationNumber: string, isSell = false): string {
  if (isSell) return `Sale successfully executed – ${confirmationNumber}`;
  switch (c) {
    case "single":
      return `Investment successfully executed – ${confirmationNumber}`;
    case "multi":
      return `Investment complete – all payments received – ${confirmationNumber}`;
    case "dues":
      return `Investment complete – outstanding dues settled – ${confirmationNumber}`;
  }
}

// -----------------------------------------------------------------------------
// Plain-text body (for the client's email client's plain-text pane)
// -----------------------------------------------------------------------------
export function renderText(c: ClosureCase, ctx: ClosureContext): string {
  const opener = ctx.isSell
    ? "your sale has been successfully executed and the settlement amount has been remitted to your registered bank account."
    : c === "single" ? "your investment has been successfully executed and settled in full."
    : c === "multi" ? "your investment has been successfully completed. All payments have been received."
    :                 "your investment has been successfully completed and the outstanding dues have been fully settled.";

  // A sell has no client payments — show the amount remitted instead of the
  // received/payment-count rows, and no payment ledger.
  const amountLines = ctx.isSell
    ? `Total Amount: ${inr(ctx.dealAmount)}\nAmount Remitted: ${inr(ctx.dealAmount)}`
    : `Total Amount: ${inr(ctx.dealAmount)}\nTotal Received: ${inr(ctx.totalPaid)}\nPayments: ${ctx.paymentCount}`;

  const ledger =
    ctx.isSell || c === "single"
      ? ""
      : `\n\nPayment Ledger:\n${renderLedgerText(ctx.ledger)}\n`;

  return `Dear ${ctx.clientName},

We are pleased to confirm that ${opener}

Deal Reference: ${ctx.confirmationNumber}
Transaction Reference: ${ctx.transferReference}
${amountLines}
Transaction Closed On: ${fmtDate(ctx.transferredAt)}${ledger}
For your records, this transaction has been formally closed on our books.
Should you have any questions, please reach out to your Relationship Manager.

Warm regards,
Niyom Wealth Distribution LLP

${emailFooterText({ year: ctx.year, ref: `${ctx.confirmationNumber} \u00B7 ${ctx.transferReference}` })}`;
}

function renderLedgerText(rows: LedgerRow[]): string {
  if (!rows.length) return "  —";
  return rows.map((r, i) => {
    const ref = r.utr_number || r.cheque_number || "—";
    return `  ${i + 1}. ${fmtDate(r.payment_date)} · ${MODE_LABEL[r.payment_mode] ?? r.payment_mode} · ${ref} · ${inr(r.amount_inr)}`;
  }).join("\n");
}

// -----------------------------------------------------------------------------
// HTML body
// -----------------------------------------------------------------------------
export function renderHtml(c: ClosureCase, ctx: ClosureContext): string {
  const preheader = ctx.isSell
    ? "Your sale has been executed and the settlement amount remitted."
    : c === "single" ? "Your investment has been successfully executed and settled in full."
    : c === "multi" ? "All payments received. Your investment is now complete."
    :                 "Outstanding dues settled. Your investment is now complete.";

  const opener = ctx.isSell
    ? "your sale has been successfully executed and the settlement amount has been remitted to your registered bank account."
    : c === "single" ? "your investment has been successfully executed and settled in full."
    : c === "multi" ? "your investment has been successfully completed. All payments have been received."
    :                 "your investment has been successfully completed and the outstanding dues have been fully settled.";

  // A sell has no client payments — remitted amount, no ledger.
  const amountRows = ctx.isSell
    ? `${amountRow("Total Amount",      inr(ctx.dealAmount))}
        ${amountRow("Amount Remitted",  inr(ctx.dealAmount))}`
    : `${amountRow("Total Amount",      inr(ctx.dealAmount))}
        ${amountRow("Total Received",   inr(ctx.totalPaid))}
        ${amountRow("Payments",         String(ctx.paymentCount))}`;

  const ledgerBlock = (ctx.isSell || c === "single") ? "" : renderLedgerHtml(ctx.ledger);

  const body = `
    <p style="font-size:15px;font-weight:600;color:#111;margin:0 0 16px;">Dear ${escapeHtml(ctx.clientName)},</p>
    <p style="margin:0 0 14px;">We are pleased to confirm that ${opener}</p>

    <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:6px;margin:14px 0;">
      <tbody>
        ${amountRow("Deal Reference",         escapeHtml(ctx.confirmationNumber),  true)}
        ${amountRow("Transaction Reference",  escapeHtml(ctx.transferReference),   true)}
        ${amountRows}
        ${amountRow("Transaction Closed On",  fmtDate(ctx.transferredAt))}
      </tbody>
    </table>

    ${ledgerBlock}

    <p style="margin:14px 0 0;">For your records, this transaction has been formally closed on our books.</p>
    <p style="margin:8px 0 0;">Should you have any questions, please reach out to your Relationship Manager.</p>
    <p style="margin:18px 0 0;">Warm regards,<br/><strong>Niyom Wealth Distribution LLP</strong></p>`;

  return shellHtml(preheader, body, `${ctx.confirmationNumber} · ${ctx.transferReference}`, ctx.year);
}

function renderLedgerHtml(rows: LedgerRow[]): string {
  if (!rows.length) return "";
  const body = rows.map((r, i) => {
    const ref = escapeHtml(r.utr_number || r.cheque_number || "—");
    return `<tr>
      <td style="padding:6px 10px;color:#666;font-size:12px;border-bottom:1px solid #eee;">${i + 1}</td>
      <td style="padding:6px 10px;color:#111;font-size:12px;border-bottom:1px solid #eee;">${fmtDate(r.payment_date)}</td>
      <td style="padding:6px 10px;color:#111;font-size:12px;border-bottom:1px solid #eee;">${escapeHtml(MODE_LABEL[r.payment_mode] ?? r.payment_mode)}</td>
      <td style="padding:6px 10px;color:#111;font-size:12px;border-bottom:1px solid #eee;font-family:monospace;">${ref}</td>
      <td style="padding:6px 10px;color:#111;font-size:12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${inr(r.amount_inr)}</td>
    </tr>`;
  }).join("");

  return `<div style="margin:14px 0;">
    <p style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#8B7355;margin:0 0 6px;">Payment Ledger</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:6px;overflow:hidden;">
      <thead>
        <tr style="background:#111;color:#fff;">
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">#</th>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">Date</th>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">Mode</th>
          <th style="padding:6px 10px;text-align:left;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">Reference</th>
          <th style="padding:6px 10px;text-align:right;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">Amount</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

// -----------------------------------------------------------------------------
// Presentational helpers
// -----------------------------------------------------------------------------

function amountRow(label: string, value: string, mono = false): string {
  return `<tr>
    <td style="padding:6px 12px;color:#666;font-size:13px;">${label}</td>
    <td style="padding:6px 12px;color:#111;font-size:13px;font-weight:600;text-align:right;${mono ? "font-family:monospace;" : ""}">${value}</td>
  </tr>`;
}

function shellHtml(preheader: string, body: string, refFooter: string, year: number): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#222;line-height:1.7;margin:0;padding:0;background:#f6f6f6;">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#f6f6f6;">
    ${preheader}
  </div>
  <div style="max-width:620px;margin:0 auto;padding:32px 24px;background:#ffffff;">
    <div style="border-bottom:2px solid #D4AF37;padding-bottom:16px;margin-bottom:24px;">
      <div style="font-size:20px;font-weight:700;color:#111;">Niyom Wealth</div>
    </div>
    ${body}
    ${emailFooterHtml({ year, ref: refFooter })}
  </div>
</body></html>`;
}

// -----------------------------------------------------------------------------
// Minimal HTML escape — every field we interpolate above passes through this.
// -----------------------------------------------------------------------------
export function escapeHtml(s: unknown): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
