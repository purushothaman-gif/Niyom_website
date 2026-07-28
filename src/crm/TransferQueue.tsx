import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LogoLoader } from '../components/LogoLoader';
import { supabase } from '../lib/supabase';
import { NWEmployee } from './types';
import {
  Send, Search, ChevronLeft, ChevronRight,
  CheckCircle2, AlertCircle, Loader2, X,
  ShieldCheck, Info, RefreshCw,
} from 'lucide-react';

// ===========================================================================
// Transfer Queue — admin-only Operations screen.
//
// Lists deals that are CONFIRMED (booked) and PAID (settled within ±₹50),
// lets an admin review the full deal + payment ledger, then approve the
// transfer — which creates the official nw_transactions row, closes the deal
// and sends the closure email.
//
// Eligibility (which deals appear) is enforced authoritatively by the
// nw_deal_transfer_eligible view; this component only renders it and drives
// the transfer via the `transfer-deal` edge function (→ nw_transfer_deal RPC).
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  employee: NWEmployee;
}

// Row shape from the nw_deal_transfer_eligible view.
interface EligibleDeal {
  deal_id: string;
  confirmation_number: string;
  client_id: string;
  employee_id: string;
  snap_client_name: string;
  snap_pan: string;
  snap_email: string;
  snap_phone: string;
  snap_dp_name: string;
  snap_demat_account: string;
  snap_bank_name: string;
  snap_bank_account: string;
  snap_bank_ifsc: string;
  snap_address: string;
  product_type: string;
  transaction_type: string;
  security_name: string;
  isin: string;
  deal_date: string;
  quantity: number;
  rate_per_unit: number;
  settlement_amount: number;
  stamp_duty: number;
  notes: string;
  accepted_at: string | null;
  signer_email: string | null;
  signed_pdf_path: string | null;
  landing_cost: number | null;
  insurance_revenue: number | null;
  trail_percent: number | null;
  trail_start_date: string | null;
  brokerage_amount: number | null;
  total_paid_amount: number;
  outstanding_amount: number;
  payment_count: number;
  last_payment_at: string | null;
}

// Payment ledger row — read from nw_deal_payments when a preview opens.
interface LedgerRow {
  id: string;
  payment_number: string;
  payment_date: string;
  payment_mode: string;
  amount_inr: number;
  utr_number: string | null;
  cheque_number: string | null;
}

// Short-label map for payment_mode (used only in the ledger table).
const MODE_LABEL: Record<string, string> = {
  imps: 'IMPS', neft: 'NEFT', rtgs: 'RTGS', upi: 'UPI',
  cheque: 'Cheque', cash: 'Cash', bank_transfer: 'Bank Transfer',
  online_gateway: 'Online Gateway', demand_draft: 'Demand Draft',
  internal_adjustment: 'Internal Adjustment',
};

// ---------------------------------------------------------------------------
// Formatting helpers (locally scoped to keep this module self-contained)
// ---------------------------------------------------------------------------

const inr = (n: number | null | undefined) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return '₹' + Number(n).toLocaleString('en-IN', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
};

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

const fmtDateTime = (d: string | null | undefined) => {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

// ---------------------------------------------------------------------------
// Demat account parser — Business rule:
//   NSDL format: "IN" + 6-digit DP ID + 8-digit Client ID (16 chars total)
//   CDSL format: 16 digits, first 8 = DP ID, last 8 = Client ID
// Returns null when the account doesn't match either convention — the UI
// then shows only the full account as a source of truth (graceful fallback).
// ---------------------------------------------------------------------------
function parseDemat(
  account: string | null | undefined,
  depository: string | null | undefined,
): { dpId: string; clientId: string } | null {
  if (!account) return null;
  const clean = String(account).replace(/\s+/g, '').toUpperCase();
  const dep = String(depository || '').toUpperCase();

  // NSDL: "IN" prefix + 14 digits
  if ((dep === 'NSDL' || clean.startsWith('IN')) && /^IN\d{14}$/.test(clean)) {
    return {
      dpId:     clean.slice(0, 8),   // "IN" + 6 digits
      clientId: clean.slice(8, 16),  // 8 digits
    };
  }

  // CDSL: 16 digits
  if ((dep === 'CDSL' || /^\d{16}$/.test(clean)) && /^\d{16}$/.test(clean)) {
    return {
      dpId:     clean.slice(0, 8),
      clientId: clean.slice(8, 16),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Confirmation checklist — the six-item verification checklist
// ---------------------------------------------------------------------------

const CHECKLIST_ITEMS = [
  { key: 'kyc',        label: 'Client KYC verified' },
  { key: 'payment',    label: 'Payment received (settled within ₹50 tolerance)' },
  { key: 'ledger',     label: 'Ledger verified' },
  { key: 'docs',       label: 'Documents verified' },
  { key: 'investment', label: 'Investment details verified' },
  { key: 'attest',     label: 'I confirm this deal is ready for official transfer and closure.' },
] as const;

type ChecklistKey = typeof CHECKLIST_ITEMS[number]['key'];

const PAGE_SIZE = 10;

// A deal is settled for transfer when |outstanding| <= this (INR). Must stay in
// sync with the nw_deal_transfer_eligible view + nw_transfer_deal RPC.
const SETTLEMENT_TOLERANCE = 50;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = (() => { const y = new Date().getFullYear(); return [y, y - 1, y - 2, y - 3]; })();

// ===========================================================================
// Main component
// ===========================================================================

export default function TransferQueue({ employee }: Props) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';

  const [view, setView] = useState<'list' | 'preview' | 'success'>('list');
  const [loading, setLoading] = useState(true);
  const [deals, setDeals] = useState<EligibleDeal[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [filterMonth, setFilterMonth] = useState<string>(''); // '' = all, else '0'..'11'
  const [filterYear, setFilterYear] = useState<string>('');   // '' = all, else e.g. '2026'

  const [preview, setPreview] = useState<EligibleDeal | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [depository, setDepository] = useState<string | null>(null);

  const [showConfirm, setShowConfirm] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [checks, setChecks] = useState<Record<ChecklistKey, boolean>>({
    kyc: false, payment: false, ledger: false, docs: false, investment: false, attest: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [successResult, setSuccessResult] = useState<{
    transfer_reference: string;
    transaction_id: string;
    transferred_at: string;
    email_status: string;
    email_error: string | null;
    deal: EligibleDeal;
  } | null>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // -------------------------------------------------------------------------
  // Guard: this page is admin-only. The nav already hides it for RMs, but in
  // case someone deep-links to /crm/transfer_queue we degrade gracefully.
  // -------------------------------------------------------------------------
  if (!isAdmin) {
    return (
      <div className="p-8 text-center">
        <ShieldCheck className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          The Transfer Queue is available to administrators only.
        </p>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Data loading — the nw_deal_transfer_eligible view already restricts rows
  // to confirmed + paid (within ₹50) + not-yet-transferred deals.
  // -------------------------------------------------------------------------

  const loadList = useCallback(async () => {
    setLoading(true);
    const from = page * PAGE_SIZE;
    const to   = from + PAGE_SIZE - 1;

    let q = supabase
      .from('nw_deal_transfer_eligible')
      .select('*', { count: 'exact' })
      .order('deal_date', { ascending: false })
      .range(from, to);

    if (search.trim()) {
      const s = `%${search.trim()}%`;
      q = q.or([
        `confirmation_number.ilike.${s}`,
        `snap_client_name.ilike.${s}`,
        `security_name.ilike.${s}`,
        `isin.ilike.${s}`,
      ].join(','));
    }
    // Month + Year filter on deal date. Year alone = whole year; Year+Month = that month.
    if (filterYear) {
      const y = Number(filterYear);
      const pad = (n: number) => String(n).padStart(2, '0');
      if (filterMonth !== '') {
        const m = Number(filterMonth); // 0-11
        const lastDay = new Date(y, m + 1, 0).getDate();
        q = q.gte('deal_date', `${y}-${pad(m + 1)}-01`)
             .lte('deal_date', `${y}-${pad(m + 1)}-${pad(lastDay)}`);
      } else {
        q = q.gte('deal_date', `${y}-01-01`).lte('deal_date', `${y}-12-31`);
      }
    }

    const { data, count: c } = await q;
    setDeals((data as EligibleDeal[]) ?? []);
    setCount(c ?? 0);
    setLoading(false);
  }, [page, search, filterMonth, filterYear]);

  useEffect(() => { loadList(); }, [loadList]);

  // -------------------------------------------------------------------------
  // Open preview — fetch:
  //   (a) the full Payment Ledger (chronological) for the Payment Details section
  //   (b) snap_depository (not part of the view; used by the Demat parser).
  // -------------------------------------------------------------------------

  const openPreview = async (d: EligibleDeal) => {
    setPreview(d);
    setView('preview');
    setChecks({ kyc: false, payment: false, ledger: false, docs: false, investment: false, attest: false });
    setRemarks('');
    setError('');
    setLedger([]);
    setDepository(null);

    const [ledgerRes, depRes] = await Promise.all([
      supabase.from('nw_deal_payments')
        .select('id, payment_number, payment_date, payment_mode, amount_inr, utr_number, cheque_number')
        .eq('deal_confirmation_id', d.deal_id)
        .eq('status', 'active')
        .order('payment_date', { ascending: true }),
      supabase.from('nw_deal_confirmations')
        .select('snap_depository')
        .eq('id', d.deal_id)
        .maybeSingle(),
    ]);
    setLedger((ledgerRes.data as LedgerRow[]) ?? []);
    setDepository((depRes.data as { snap_depository: string | null } | null)?.snap_depository ?? null);
  };

  const closePreview = () => {
    setPreview(null);
    setLedger([]);
    setDepository(null);
    setView('list');
  };

  // -------------------------------------------------------------------------
  // Approve Transfer
  // -------------------------------------------------------------------------

  const allChecked = useMemo(
    () => CHECKLIST_ITEMS.every(i => checks[i.key]),
    [checks]
  );

  const submit = async () => {
    if (!preview || !allChecked || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('transfer-deal', {
        // Digital acceptance is not part of this flow; always transfer a
        // confirmed, paid deal. The view + RPC enforce eligibility.
        body: { dealId: preview.deal_id, remarks: remarks.trim() || null, override: true },
      });
      if (fnErr || !data?.success) {
        throw new Error(data?.error || fnErr?.message || 'Could not complete transfer.');
      }
      setSuccessResult({
        transfer_reference: data.transfer_reference,
        transaction_id:     data.transaction_id,
        transferred_at:     data.transferred_at,
        email_status:       data.email_status,
        email_error:        data.email_error,
        deal:               preview,
      });
      setShowConfirm(false);
      setView('success');
    } catch (err: any) {
      setError(err?.message || 'Could not complete transfer.');
    } finally {
      setSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Retry closure email — direct admin call to send-deal-closure-email
  // -------------------------------------------------------------------------
  const resendClosureEmail = async () => {
    if (!successResult) return;
    setResending(true);
    setResendMessage(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('send-deal-closure-email', {
        body: { dealId: successResult.deal.deal_id },
      });
      if (fnErr || !data?.success) {
        throw new Error(data?.error || fnErr?.message || 'Could not resend closure email.');
      }
      setSuccessResult(prev => prev ? { ...prev, email_status: 'sent', email_error: null } : prev);
      setResendMessage({ ok: true, text: 'Closure email resent successfully.' });
    } catch (err: any) {
      setResendMessage({ ok: false, text: err?.message || 'Could not resend closure email.' });
    } finally {
      setResending(false);
    }
  };

  // =========================================================================
  // Render
  // =========================================================================

  // ---- SUCCESS SCREEN ------------------------------------------------------
  if (view === 'success' && successResult) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <div className="rounded-2xl p-6" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
          <div className="flex items-start gap-4">
            <div className="rounded-full p-2" style={{ background: 'rgba(16,185,129,0.15)' }}>
              <CheckCircle2 className="w-6 h-6" style={{ color: 'var(--success)' }} />
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-text-primary">Transfer Approved</h1>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                The deal has been closed and the official transaction has been recorded.
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <SummaryTile label="Transfer Reference"     value={successResult.transfer_reference} mono strong />
            <SummaryTile label="Transferred On"         value={fmtDateTime(successResult.transferred_at)} />
            <SummaryTile label="Deal Number"            value={successResult.deal.confirmation_number} mono />
            <SummaryTile label="Client"                 value={successResult.deal.snap_client_name} />
            <SummaryTile label="Settlement Amount"      value={inr(successResult.deal.settlement_amount)} />
            <SummaryTile
              label="Client Notification"
              value={
                successResult.email_status === 'sent'
                  ? 'Sent'
                  : successResult.email_status === 'skipped'
                    ? 'Skipped (idempotent)'
                    : `Failed — ${successResult.email_error ?? 'unknown error'}`
              }
              tone={successResult.email_status === 'sent' ? 'success' :
                    successResult.email_status === 'failed' ? 'warning' : 'muted'}
            />
          </div>

          {resendMessage && (
            <div
              className="mt-4 rounded-xl px-4 py-3 flex items-start gap-2 text-sm"
              style={
                resendMessage.ok
                  ? { background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', color: 'var(--success)' }
                  : { background: 'rgba(239,68,68,0.08)',  border: '1px solid rgba(239,68,68,0.25)',  color: 'var(--danger)'  }
              }
            >
              {resendMessage.ok
                ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                : <AlertCircle  className="w-4 h-4 mt-0.5 shrink-0" />}
              <span>{resendMessage.text}</span>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
            <button
              onClick={() => { setSuccessResult(null); setResendMessage(null); setPreview(null); setView('list'); setPage(0); loadList(); }}
              className="text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              ← Back to Transfer Queue
            </button>
            {successResult.email_status !== 'sent' && (
              <button
                onClick={resendClosureEmail}
                disabled={resending}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
                style={{
                  background: 'var(--bg-base)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  opacity: resending ? 0.6 : 1,
                }}
              >
                {resending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Resending…</>
                  : <><RefreshCw className="w-4 h-4" /> Retry Send</>}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---- PREVIEW SCREEN ------------------------------------------------------
  // Operations Verification Screen. Shows the fields the employee needs while
  // entering the transfer into the external Transfer / Registrar portal.
  if (view === 'preview' && preview) {
    const demat        = parseDemat(preview.snap_demat_account, depository);
    const outstanding  = Number(preview.outstanding_amount);
    // SELL: the client is selling to us, so money flows Niyom → client — there is
    // no client payment to collect. Such deals are transfer-eligible without the
    // settlement gate (mirrors the view + nw_transfer_deal RPC bypass).
    const isSell       = (preview.transaction_type || '').trim().toLowerCase() === 'sell';
    const isSettled    = isSell || Math.abs(outstanding) <= SETTLEMENT_TOLERANCE;
    const isExact      = outstanding === 0;

    return (
      <div className="space-y-5 pb-24">
        {/* Header — minimal cross-reference */}
        <div className="flex items-center gap-3">
          <button onClick={closePreview} className="flex items-center gap-2 text-sm"
            style={{ color: 'var(--text-secondary)' }}>
            <ChevronLeft className="w-4 h-4" /> Back to Queue
          </button>
        </div>
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>
            Transfer Preview
          </p>
          <h1 className="text-xl font-bold text-text-primary font-mono">
            {preview.confirmation_number}
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Deal Date: {fmtDate(preview.deal_date)}
          </p>
        </div>

        {/* --- Section 1: Client Details --- */}
        <Section title="Client Details">
          <FieldRow label="Client Name" value={preview.snap_client_name || '—'} />
          <FieldRow label="PAN Number"  value={preview.snap_pan || '—'} mono />
        </Section>

        {/* --- Section 2: Product Details --- */}
        <Section title="Product Details">
          <FieldRow label="Product Name" value={preview.security_name || '—'} />
          <FieldRow label="Quantity"     value={preview.quantity ?? '—'} mono />
          <FieldRow label="ISIN Number"  value={preview.isin || '—'} mono />
          <FieldRow
            label="Total Settlement Amount"
            value={inr(preview.settlement_amount)}
            emphasis
          />
        </Section>

        {/* --- Section 3: Demat Details --- */}
        <Section title="Demat Details">
          {demat ? (
            <>
              <FieldRow label="DP ID"                        value={demat.dpId}     mono strong />
              <FieldRow label="Client ID (Demat Client ID)"  value={demat.clientId} mono strong />
            </>
          ) : (
            <div className="rounded-lg px-3 py-2 text-xs italic"
              style={{ background: 'rgba(245,158,11,0.06)', color: 'var(--warning)', border: '1px solid rgba(245,158,11,0.20)' }}>
              DP ID / Client ID could not be parsed automatically from the demat account.
              Use the full account number below as the source of truth.
            </div>
          )}
          {depository && (
            <FieldRow label="Depository" value={depository} />
          )}
          <FieldRow
            label="Full Demat Account (source of truth)"
            value={preview.snap_demat_account || '—'}
            mono
          />
        </Section>

        {/* --- Section 4: Bank Details --- */}
        <Section title="Bank Details">
          <FieldRow label="Bank Name"           value={preview.snap_bank_name || '—'} />
          <FieldRow label="Bank Account Number" value={preview.snap_bank_account || '—'} mono />
          <FieldRow label="IFSC Code"           value={preview.snap_bank_ifsc || '—'} mono />
        </Section>

        {/* --- Section 5: Payment Details --- */}
        <Section title={isSell ? 'Payment Details (Remitted to Client)' : 'Payment Details'}>
          {isSell ? (
            <div className="flex items-center gap-3 rounded-xl px-5 py-4"
              style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.30)' }}>
              <Info className="w-8 h-8 shrink-0" style={{ color: 'var(--success)' }} />
              <div>
                <p className="text-lg font-black uppercase tracking-wider" style={{ color: 'var(--success)' }}>
                  No Client Payment Required
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  This is a SELL — the client is selling to Niyom, so {inr(preview.settlement_amount)} is
                  remitted to the client. No settlement gate applies.
                </p>
              </div>
            </div>
          ) : (
          <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SummaryTile label="Total Settlement Amount" value={inr(preview.settlement_amount)}   strong />
            <SummaryTile label="Total Amount Paid"        value={inr(preview.total_paid_amount)}  strong tone="success" />
            <SummaryTile
              label="Outstanding Amount"
              value={isExact ? '₹0.00' : inr(outstanding)}
              strong
              tone={isSettled ? 'success' : 'warning'}
            />
          </div>

          <div className="mt-4">
            {isSettled ? (
              <div className="flex items-center gap-3 rounded-xl px-5 py-4"
                style={{
                  background: 'rgba(16,185,129,0.08)',
                  border: '1px solid rgba(16,185,129,0.30)',
                }}>
                <CheckCircle2 className="w-8 h-8 shrink-0" style={{ color: 'var(--success)' }} />
                <div>
                  <p className="text-lg font-black uppercase tracking-wider" style={{ color: 'var(--success)' }}>
                    {isExact ? 'Fully Paid' : 'Settled'}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {isExact
                      ? 'Outstanding: ₹0.00'
                      : `Within ₹${SETTLEMENT_TOLERANCE} tolerance · Outstanding: ${inr(outstanding)}`}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl px-5 py-4"
                style={{
                  background: 'rgba(245,158,11,0.08)',
                  border: '1px solid rgba(245,158,11,0.30)',
                }}>
                <AlertCircle className="w-8 h-8 shrink-0" style={{ color: 'var(--warning)' }} />
                <div>
                  <p className="text-lg font-black uppercase tracking-wider" style={{ color: 'var(--warning)' }}>
                    Outstanding
                  </p>
                  <p className="text-xs mt-0.5 font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Outstanding: {inr(outstanding)}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Payment Ledger — chronological */}
          <div className="mt-4 rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border)' }}>
            <div className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider flex items-center justify-between"
              style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
              <span>Payment Ledger</span>
              <span style={{ color: 'var(--text-muted)' }}>
                {ledger.length} {ledger.length === 1 ? 'entry' : 'entries'}
              </span>
            </div>
            {ledger.length === 0 ? (
              <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                No payments recorded.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm nw-table">
                  <thead>
                    <tr style={{ background: 'var(--bg-base)', color: 'var(--text-muted)' }}>
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase tracking-wider">Payment No.</th>
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase tracking-wider">Payment Date</th>
                      <th className="px-4 py-2 text-right text-xs font-bold uppercase tracking-wider">Payment Amount</th>
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase tracking-wider">Payment Mode</th>
                      <th className="px-4 py-2 text-left text-xs font-bold uppercase tracking-wider">Transaction No. / UTR / Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map(p => {
                      const ref = p.utr_number || p.cheque_number || '—';
                      return (
                        <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap"
                            style={{ color: 'var(--accent)' }}>
                            {p.payment_number}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                            {fmtDate(p.payment_date)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold whitespace-nowrap"
                            style={{ color: 'var(--text-primary)' }}>
                            {inr(p.amount_inr)}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap"
                            style={{ color: 'var(--text-primary)' }}>
                            {MODE_LABEL[p.payment_mode] ?? p.payment_mode}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs">
                            {ref}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </>
          )}
        </Section>

        {/* --- Approve action bar (sticky) --- */}
        {/* Defence-in-depth: the eligibility view already restricts this list to
             confirmed, settled deals, but the ledger could change between list
             load and click, so we re-check the same tolerance here. The RPC
             re-checks confirmed + tolerance again authoritatively under the lock. */}
        <div className="sticky bottom-0 z-10 rounded-2xl px-5 py-4 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', backdropFilter: 'blur(6px)' }}>
          <div className="flex items-center gap-2 text-xs" style={{ color: isSettled ? 'var(--text-secondary)' : 'var(--warning)' }}>
            {isSettled ? (
              <>
                <Info className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                Verification only. Approval creates the official transaction and sends the closure email.
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4" style={{ color: 'var(--warning)' }} />
                Transfer is available only once the balance is settled (within ₹{SETTLEMENT_TOLERANCE}).
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={closePreview}
              className="px-4 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              Cancel
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!isSettled}
              title={isSettled ? undefined : `Transfer is available only once the balance is settled (within ₹${SETTLEMENT_TOLERANCE}).`}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold disabled:cursor-not-allowed"
              style={
                isSettled
                  ? { background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', color: 'var(--on-accent, #000)' }
                  : { background: 'var(--bg-base)', color: 'var(--text-muted)', border: '1px solid var(--border)', opacity: 0.6 }
              }
            >
              <Send className="w-4 h-4" /> Approve Transfer
            </button>
          </div>
        </div>

        {/* --- Confirmation dialog (6-item checklist) --- */}
        {showConfirm && (
          <ConfirmDialog
            deal={preview}
            checks={checks}
            setChecks={setChecks}
            remarks={remarks}
            setRemarks={setRemarks}
            error={error}
            submitting={submitting}
            allChecked={allChecked}
            onCancel={() => { if (!submitting) { setShowConfirm(false); setError(''); } }}
            onConfirm={submit}
          />
        )}
      </div>
    );
  }

  // ---- LIST SCREEN ---------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Operations</p>
        <h1 className="text-2xl font-bold text-text-primary">Transfer Queue</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Confirmed deals, paid (settled within ₹{SETTLEMENT_TOLERANCE}), awaiting review &amp; transfer.
        </p>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2 relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: 'var(--text-faint)' }} />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search by reference, client, security or ISIN…"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-text-primary outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
            style={{ color: 'var(--text-secondary)' }}>Accepted Month</label>
          <select value={filterMonth} onChange={e => { setFilterMonth(e.target.value); setPage(0); }}
            className="w-full px-3.5 py-2 rounded-xl text-sm text-text-primary outline-none appearance-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <option value="">All Months</option>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1"
            style={{ color: 'var(--text-secondary)' }}>Accepted Year</label>
          <select value={filterYear} onChange={e => { setFilterYear(e.target.value); setPage(0); }}
            className="w-full px-3.5 py-2 rounded-xl text-sm text-text-primary outline-none appearance-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <option value="">All Years</option>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        {loading ? (
          <div className="flex justify-center py-16">
            <LogoLoader size={48} />
          </div>
        ) : deals.length === 0 ? (
          <div className="text-center py-16">
            <ShieldCheck className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--border-strong)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--text-faint)' }}>
              No deals awaiting transfer
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--border-strong)' }}>
              Deals appear here once confirmed and their payment is settled (within ₹{SETTLEMENT_TOLERANCE}).
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full nw-table">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Deal Number', 'Client', 'Security', 'Type', 'Settlement', 'Accepted', 'Last Payment', ''].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider"
                      style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deals.map(d => (
                  <tr key={d.deal_id} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-mono font-bold" style={{ color: 'var(--accent)' }}>
                        {d.confirmation_number}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-text-primary">{d.snap_client_name}</p>
                      <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{d.snap_pan}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-text-primary">{d.security_name}</p>
                      <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{d.isin || '—'}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-semibold px-2 py-1 rounded-lg"
                        style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}>
                        {d.transaction_type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-bold text-text-primary">{inr(d.settlement_amount)}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{fmtDate(d.accepted_at)}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{fmtDate(d.last_payment_at)}</p>
                      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{d.payment_count} pmt(s)</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <button onClick={() => openPreview(d)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-on-accent"
                        style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                        Review <ChevronRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {count > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, count)} of {count}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              Previous
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={(page + 1) * PAGE_SIZE >= count}
              className="px-3 py-1.5 rounded-lg text-xs disabled:opacity-40"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Small subcomponents
// ===========================================================================

function SummaryTile({
  label, value, mono, strong, tone,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  strong?: boolean;
  tone?: 'success' | 'warning' | 'danger' | 'muted';
}) {
  const color =
    tone === 'success' ? 'var(--success)' :
    tone === 'warning' ? 'var(--warning)' :
    tone === 'danger'  ? 'var(--danger)' :
    tone === 'muted'   ? 'var(--text-muted)' :
    'var(--text-bright)';
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}
    >
      <p className="text-xs uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p
        className={`text-sm ${mono ? 'font-mono' : ''} ${strong ? 'font-bold' : 'font-semibold'}`}
        style={{ color }}
      >
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simplified read-only section — used by the Transfer Preview.
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl overflow-hidden"
      style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
      <div className="px-5 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <h3 className="text-sm font-bold uppercase tracking-wider"
          style={{ color: 'var(--text-secondary)' }}>{title}</h3>
      </div>
      <div className="px-5 py-4 space-y-3">
        {children}
      </div>
    </div>
  );
}

function FieldRow({
  label, value, mono, strong, emphasis,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  strong?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4">
      <p className="text-xs uppercase tracking-wider sm:w-56 sm:shrink-0"
        style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p
        className={`${mono ? 'font-mono' : ''} ${strong || emphasis ? 'font-bold' : 'font-medium'} ${emphasis ? 'text-lg' : 'text-sm'}`}
        style={{ color: emphasis ? 'var(--accent)' : 'var(--text-primary)' }}
      >
        {value ?? '—'}
      </p>
    </div>
  );
}

function ConfirmDialog({
  deal, checks, setChecks, remarks, setRemarks,
  error, submitting, allChecked, onCancel, onConfirm,
}: {
  deal: EligibleDeal;
  checks: Record<ChecklistKey, boolean>;
  setChecks: React.Dispatch<React.SetStateAction<Record<ChecklistKey, boolean>>>;
  remarks: string;
  setRemarks: (v: string) => void;
  error: string;
  submitting: boolean;
  allChecked: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onCancel}>
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl overflow-hidden"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            <h2 className="text-lg font-bold text-text-primary">Confirm Deal Closure</h2>
          </div>
          <button onClick={onCancel} disabled={submitting}
            className="p-1.5 rounded-lg" style={{ color: 'var(--text-muted)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              You are about to close deal <strong className="font-mono" style={{ color: 'var(--accent)' }}>{deal.confirmation_number}</strong>{' '}
              for <strong>{deal.snap_client_name}</strong>. Approving this Transfer will:
            </p>
            <ul className="mt-3 space-y-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--success)' }} />
                Create the official transaction (with a new Transfer Reference).
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--success)' }} />
                Close the deal and mark it non-editable.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--success)' }} />
                Record the full audit trail (event, actor, timestamp, remarks).
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--success)' }} />
                Trigger the client notification email.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--success)' }} />
                Make the transaction available for MIS Revenue.
              </li>
            </ul>
            <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              This action cannot be easily reversed.
            </p>
          </div>

          <div className="rounded-xl p-4 space-y-2"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold uppercase tracking-wider mb-1"
              style={{ color: 'var(--text-secondary)' }}>Transfer Checklist</p>
            {CHECKLIST_ITEMS.map(item => (
              <label key={item.key} className="flex items-start gap-2 cursor-pointer text-sm">
                <input
                  type="checkbox"
                  checked={checks[item.key]}
                  onChange={e => setChecks(prev => ({ ...prev, [item.key]: e.target.checked }))}
                  disabled={submitting}
                  className="mt-0.5"
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span style={{ color: 'var(--text-primary)' }}>
                  {item.label}
                </span>
              </label>
            ))}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
              style={{ color: 'var(--text-secondary)' }}>Remarks (optional)</label>
            <textarea rows={2} value={remarks} onChange={e => setRemarks(e.target.value)}
              maxLength={500}
              placeholder="Any internal note for this closure…"
              disabled={submitting}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }} />
          </div>

          {error && (
            <div className="rounded-xl px-4 py-3 flex items-start gap-2 text-sm"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger)' }}>
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 flex items-center justify-end gap-2"
          style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-raised)' }}>
          <button onClick={onCancel} disabled={submitting}
            className="px-4 py-2.5 rounded-xl text-sm"
            style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={!allChecked || submitting}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:cursor-not-allowed"
            style={{
              background: allChecked && !submitting
                ? 'linear-gradient(135deg, var(--accent), var(--accent-strong))'
                : 'var(--bg-base)',
              color: allChecked && !submitting ? undefined : 'var(--text-muted)',
              opacity: allChecked && !submitting ? 1 : 0.6,
              border: allChecked && !submitting ? 'none' : '1px solid var(--border)',
            }}>
            {submitting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Approving…</>
              : <><Send className="w-4 h-4" /> Approve Transfer</>}
          </button>
        </div>
      </div>
    </div>
  );
}
