import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LogoLoader } from '../components/LogoLoader';
import { supabase } from '../lib/supabase';
import { edgeFunctionErrorMessage } from '../lib/edgeFunctionError';
import { NWEmployee } from './types';
import {
  ChevronLeft, Plus, X, Loader2, CheckCircle2, AlertCircle,
  Wallet, IndianRupee, Receipt, Info, FileText, RefreshCw, Eye, Mail, Bell, CreditCard,
  Pencil, Ban,
} from 'lucide-react';
import { renderPaymentReceiptPdf } from './paymentReceipt';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Must mirror nw_deal_payment_summary.payment_status, which returns 'over_paid'
// whenever active payments exceed the settlement amount. Omitting it here left
// STATUS_STYLES without that key, so StatusPill dereferenced undefined and took
// the whole payment ledger down to a blank screen.
type PaymentStatus = 'not_paid' | 'partially_paid' | 'fully_paid' | 'over_paid';

type PaymentMode =
  | 'imps' | 'neft' | 'rtgs' | 'upi' | 'cheque' | 'cash'
  | 'bank_transfer' | 'online_gateway' | 'demand_draft' | 'internal_adjustment';

const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: 'imps',                label: 'IMPS' },
  { value: 'neft',                label: 'NEFT' },
  { value: 'rtgs',                label: 'RTGS' },
  { value: 'upi',                 label: 'UPI' },
  { value: 'bank_transfer',       label: 'Bank Transfer' },
  { value: 'cheque',              label: 'Cheque' },
  { value: 'demand_draft',        label: 'Demand Draft' },
  { value: 'online_gateway',      label: 'Online Gateway' },
  { value: 'cash',                label: 'Cash' },
  { value: 'internal_adjustment', label: 'Internal Adjustment' },
];

const MODE_LABEL: Record<PaymentMode, string> =
  PAYMENT_MODES.reduce((a, m) => ({ ...a, [m.value]: m.label }), {} as Record<PaymentMode, string>);

interface DealBrief {
  id: string;
  client_id: string;
  // 'Buy' | 'Sell', from the deal's own transaction_type. On a Sell the client
  // is the seller and Niyom is the buyer, so the money moves the other way —
  // see DIRECTION COPY below.
  transaction_type: string;
  confirmation_number: string;
  snap_client_name: string;
  snap_pan: string;
  snap_bank_name: string;
  settlement_amount: number;
  employee_id: string;
  // Extra fields needed for the receipt PDF
  deal_date: string;
  security_name: string;
  isin: string;
  quantity: number;
  rate_per_unit: number;
}

interface BankAccountOption {
  bank_name: string;
  account_number: string;
  is_primary: boolean;
}

interface Summary {
  deal_id: string;
  deal_amount: number;
  total_paid_amount: number;
  outstanding_amount: number;
  payment_status: PaymentStatus;
  payment_count: number;
  last_payment_at: string | null;
}

interface PaymentRow {
  id: string;
  payment_number: string;
  receipt_number: string | null;
  amount: number;
  amount_inr: number;
  currency: string;
  direction: 'inflow' | 'refund' | 'adjustment';
  payment_mode: PaymentMode;
  utr_number: string | null;
  cheque_number: string | null;
  cheque_bank: string | null;
  cheque_dated: string | null;
  demand_draft_number: string | null;
  payment_date: string;
  value_date: string | null;
  received_from_name: string;
  received_from_bank: string | null;
  remarks: string;
  status: 'active' | 'cancelled' | 'superseded';
  receipt_pdf_path: string | null;
  receipt_generated_at: string | null;
  receipt_regen_count: number;
  updated_at: string;
  created_at: string;
  // Correction support. `provider` distinguishes a hand-keyed entry (editable)
  // from a gateway capture (not editable — Cashfree's amount is the PSP's
  // record). `row_version` is the optimistic-concurrency token the amend RPC
  // checks, so two people correcting the same row cannot overwrite each other.
  provider: string | null;
  row_version: number;
  cancellation_reason: string | null;
}

interface EmailLogRow {
  id: string;
  payment_id: string | null;
  email_type: 'payment_reminder' | 'payment_partial' | 'payment_final' | 'secure_link' | 'signed_pdf' | 'payment_link';
  status: 'sent' | 'failed' | 'partial';
  sent_at: string;
  metadata: Record<string, unknown> | null;
}

interface Props {
  deal: DealBrief;
  employee: NWEmployee;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const inr = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | null) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const STATUS_STYLES: Record<PaymentStatus, { label: string; bg: string; color: string; border: string }> = {
  not_paid:       { label: 'Not Paid',       bg: 'rgba(107,107,107,0.10)', color: 'var(--text-secondary)', border: 'rgba(107,107,107,0.25)' },
  partially_paid: { label: 'Partially Paid', bg: 'rgba(245,158,11,0.10)',  color: 'var(--warning)',        border: 'rgba(245,158,11,0.25)' },
  fully_paid:     { label: 'Fully Paid',     bg: 'rgba(16,185,129,0.10)',  color: 'var(--success)',        border: 'rgba(16,185,129,0.25)' },
  over_paid:      { label: 'Over Paid',      bg: 'rgba(239,68,68,0.10)',   color: 'var(--danger)',         border: 'rgba(239,68,68,0.25)' },
};

// ---------------------------------------------------------------------------
// Direction copy
//
// A Buy deal collects money FROM the client. A Sell deal is the exact mirror:
// the client is the seller, Niyom is the buyer, and Niyom pays THEM to have the
// shares transferred to us. The ledger arithmetic is identical either way —
// every entry settles part of the same settlement_amount — but the collection
// words ('received', 'outstanding') and, more importantly, the collection
// ACTIONS (a Cashfree collect link, a 'your payment is pending' reminder) are
// wrong on a Sell. Both are switched off the deal's transaction_type below.
// ---------------------------------------------------------------------------

interface DirectionCopy {
  ledgerTitle:           string;
  recordCta:             string;   // header button + form submit
  formTitle:             string;
  correctTitle:          string;
  totalLabel:            string;   // summary card
  outstandingLabel:      string;   // summary card
  counterpartyNameLabel: string;   // received_from_name
  counterpartyBankLabel: string;   // received_from_bank
  counterpartyBankHint:  string;
  counterpartyColumn:    string;   // ledger column header
  docColumn:             string;   // Receipt / Advice column header
  generateCta:           string;
  regenerateTitle:       string;
  emailTitle:            string;
  emailDisabledHint:     string;
  recordedToast:         string;
  emptyTitle:            string;
  emptyHint:             string;
  statusLabel:           Record<PaymentStatus, string>;
}

const COLLECT_COPY: DirectionCopy = {
  ledgerTitle:           'Payment Ledger',
  recordCta:             'Record Payment',
  formTitle:             'Record Payment',
  correctTitle:          'Correct Payment',
  totalLabel:            'Total Paid',
  outstandingLabel:      'Outstanding',
  counterpartyNameLabel: 'Received From (Name)',
  counterpartyBankLabel: 'Payer Bank',
  counterpartyBankHint:  'Defaults to the client\u2019s primary bank; switch if paid from another.',
  counterpartyColumn:    'Received From',
  docColumn:             'Receipt',
  generateCta:           'Generate Receipt',
  regenerateTitle:       'Regenerate the receipt',
  emailTitle:            'Send receipt to client',
  emailDisabledHint:     'Generate the receipt first.',
  recordedToast:         'Payment recorded successfully.',
  emptyTitle:            'No payments recorded yet.',
  emptyHint:             'Record the first payment to begin the receipt ledger.',
  statusLabel: {
    not_paid: 'Not Paid', partially_paid: 'Partially Paid',
    fully_paid: 'Fully Paid', over_paid: 'Over Paid',
  },
};

const PAYOUT_COPY: DirectionCopy = {
  ledgerTitle:           'Payout Ledger',
  recordCta:             'Record Payout',
  formTitle:             'Record Payout',
  correctTitle:          'Correct Payout',
  totalLabel:            'Total Paid Out',
  outstandingLabel:      'Balance Payable',
  counterpartyNameLabel: 'Paid To (Name)',
  counterpartyBankLabel: 'Beneficiary Bank',
  counterpartyBankHint:  'Defaults to the client\u2019s primary bank; switch if paid to another.',
  counterpartyColumn:    'Paid To',
  docColumn:             'Advice',
  generateCta:           'Generate Advice',
  regenerateTitle:       'Regenerate the payment advice',
  emailTitle:            'Send payment advice to client',
  emailDisabledHint:     'Generate the payment advice first.',
  recordedToast:         'Payout recorded successfully.',
  emptyTitle:            'No payouts recorded yet.',
  emptyHint:             'Record the first payout to begin the advice ledger.',
  statusLabel: {
    not_paid: 'Not Paid Out', partially_paid: 'Partially Paid Out',
    fully_paid: 'Fully Paid Out', over_paid: 'Over Paid',
  },
};

function StatusPill({ status, copy }: { status: PaymentStatus; copy: DirectionCopy }) {
  // Fall back rather than crash: a status the DB view gains before this file
  // knows about it should degrade to a plain pill, never blank the page.
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.not_paid;
  const label = copy.statusLabel[status] ?? copy.statusLabel.not_paid;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-lg uppercase tracking-wider"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
    >
      {status === 'fully_paid' && <CheckCircle2 className="w-3.5 h-3.5" />}
      {status === 'partially_paid' && <AlertCircle className="w-3.5 h-3.5" />}
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form controls (kept local; DealConfirmation.tsx patterns without importing)
// ---------------------------------------------------------------------------

function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label}{required && <span className="ml-0.5" style={{ color: 'var(--accent)' }}>*</span>}
      </label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{hint}</p>}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <input {...props}
      className="w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none transition-all"
      style={{ background: 'var(--bg-base)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}` }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: React.ReactNode }) {
  const [focused, setFocused] = useState(false);
  return (
    <select {...props}
      className="w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none transition-all"
      style={{ background: 'var(--bg-base)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}` }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <textarea {...props}
      className="w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none transition-all"
      style={{ background: 'var(--bg-base)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}` }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

// ---------------------------------------------------------------------------
// Record-payment form state
// ---------------------------------------------------------------------------

interface PaymentForm {
  amount: string;
  paymentMode: PaymentMode | '';
  paymentDate: string;
  valueDate: string;
  utrNumber: string;
  chequeNumber: string;
  chequeBank: string;
  chequeDated: string;
  demandDraftNumber: string;
  receivedFromName: string;
  receivedFromBank: string;
  remarks: string;
  // Correction only — mandatory, stored on the payment_updated audit event.
  reason: string;
}

const emptyForm = (defaultName: string, defaultBank = ''): PaymentForm => ({
  amount: '',
  paymentMode: '',
  paymentDate: new Date().toISOString().split('T')[0],
  valueDate: '',
  utrNumber: '',
  chequeNumber: '',
  chequeBank: '',
  chequeDated: '',
  demandDraftNumber: '',
  receivedFromName: defaultName,
  receivedFromBank: defaultBank,
  remarks: '',
  reason: '',
});

// Prefill the same form from an existing ledger row so a correction shows the
// operator exactly what was recorded, not a blank slate they must re-key.
const formFromPayment = (p: PaymentRow): PaymentForm => ({
  amount: String(p.amount ?? ''),
  paymentMode: p.payment_mode,
  paymentDate: p.payment_date,
  valueDate: p.value_date ?? '',
  utrNumber: p.utr_number ?? '',
  chequeNumber: p.cheque_number ?? '',
  chequeBank: p.cheque_bank ?? '',
  chequeDated: p.cheque_dated ?? '',
  demandDraftNumber: p.demand_draft_number ?? '',
  receivedFromName: p.received_from_name ?? '',
  receivedFromBank: p.received_from_bank ?? '',
  remarks: p.remarks ?? '',
  reason: '',
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DealPayments({ deal, employee, onBack }: Props) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  // Sell = client sells to us, so WE pay THEM. Everything collection-shaped is
  // relabelled, and the two collect-only actions are withdrawn entirely.
  const isPayout = (deal.transaction_type || '').trim().toLowerCase() === 'sell';
  const t = isPayout ? PAYOUT_COPY : COLLECT_COPY;

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [emailLog, setEmailLog] = useState<EmailLogRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  // Non-null while correcting an existing ledger entry; the same inline form
  // serves both "record" and "correct" so the two can never drift apart.
  const [editing, setEditing] = useState<PaymentRow | null>(null);
  const [cancelling, setCancelling] = useState<PaymentRow | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccountOption[]>([]);
  const [form, setForm] = useState<PaymentForm>(emptyForm(deal.snap_client_name, deal.snap_bank_name));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [emailBusy, setEmailBusy] = useState<string | null>(null); // paymentId or 'reminder'

  const set = <K extends keyof PaymentForm>(k: K, v: PaymentForm[K]) =>
    setForm(prev => ({ ...prev, [k]: v }));

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const [sumRes, payRes, emailRes, bankRes] = await Promise.all([
      supabase.from('nw_deal_payment_summary')
        .select('deal_id, deal_amount, total_paid_amount, outstanding_amount, payment_status, payment_count, last_payment_at')
        .eq('deal_id', deal.id).maybeSingle(),
      supabase.from('nw_deal_payments')
        .select('id, payment_number, receipt_number, amount, amount_inr, currency, direction, payment_mode, utr_number, cheque_number, cheque_bank, cheque_dated, demand_draft_number, payment_date, value_date, received_from_name, received_from_bank, remarks, status, receipt_pdf_path, receipt_generated_at, receipt_regen_count, updated_at, created_at, provider, row_version, cancellation_reason')
        .eq('deal_confirmation_id', deal.id)
        .order('created_at', { ascending: false }),
      supabase.from('nw_deal_email_log')
        .select('id, payment_id, email_type, status, sent_at, metadata')
        .eq('deal_confirmation_id', deal.id)
        .in('email_type', ['payment_reminder','payment_partial','payment_final','payment_link'])
        .order('sent_at', { ascending: false }),
      deal.client_id
        ? supabase.from('nw_client_bank_accounts')
            .select('bank_name, account_number, is_primary')
            .eq('client_id', deal.client_id)
            .order('is_primary', { ascending: false })
        : Promise.resolve({ data: [] as BankAccountOption[] }),
    ]);
    setBankAccounts((bankRes.data as BankAccountOption[]) ?? []);
    // If no payments yet, the view returns a row with zeros. Fall back to a
    // synthesised summary from the deal amount when maybeSingle returns null.
    setSummary(sumRes.data as Summary ?? {
      deal_id: deal.id,
      deal_amount: deal.settlement_amount,
      total_paid_amount: 0,
      outstanding_amount: deal.settlement_amount,
      payment_status: 'not_paid',
      payment_count: 0,
      last_payment_at: null,
    });
    setPayments((payRes.data as PaymentRow[]) ?? []);
    setEmailLog((emailRes.data as EmailLogRow[]) ?? []);
    setLoading(false);
  }, [deal.id, deal.settlement_amount, deal.client_id]);

  useEffect(() => { load(); }, [load]);

  // -----------------------------------------------------------------------
  // Submit
  // -----------------------------------------------------------------------

  const validate = (): string | null => {
    if (!form.amount) return 'Amount is required.';
    const amt = Number(form.amount);
    if (!Number.isFinite(amt) || amt <= 0) return 'Amount must be a positive number.';
    if (!form.paymentMode) return 'Payment mode is required.';
    if (!form.paymentDate) return 'Payment date is required.';
    if (form.paymentMode === 'cheque' && (!form.chequeNumber.trim() || !form.chequeBank.trim())) {
      return 'Cheque number and bank are required for cheque payments.';
    }
    // The reason is what makes a correction auditable rather than a silent
    // rewrite of a financial record; the RPC rejects a short one too.
    if (editing && form.reason.trim().length < 5) {
      return 'Please give a reason for the correction (at least 5 characters).';
    }
    return null;
  };

  // ---- Correct an existing entry ---------------------------------------
  // Sends only the fields the operator actually changed. The RPC re-validates,
  // rejects a stale row_version, writes the payment_updated audit event with a
  // before/after diff, and recomputes the deal's outstanding balance.
  const submitAmendment = async (target: PaymentRow) => {
    const patch: Record<string, string | null> = {};
    const put = (key: string, next: string | null, prev: string | null) => {
      const a = next === '' ? null : next;
      const b = prev === '' ? null : prev;
      if (a !== b) patch[key] = a;
    };
    if (Number(form.amount) !== Number(target.amount)) patch.amount = String(Number(form.amount));
    put('payment_mode',        form.paymentMode,                 target.payment_mode);
    put('payment_date',        form.paymentDate,                 target.payment_date);
    put('value_date',          form.valueDate,                   target.value_date);
    put('utr_number',          form.utrNumber.trim(),            target.utr_number);
    put('cheque_number',       form.chequeNumber.trim(),         target.cheque_number);
    put('cheque_bank',         form.chequeBank.trim(),           target.cheque_bank);
    put('cheque_dated',        form.chequeDated,                 target.cheque_dated);
    put('demand_draft_number', form.demandDraftNumber.trim(),    target.demand_draft_number);
    put('received_from_name',  form.receivedFromName.trim(),     target.received_from_name);
    put('received_from_bank',  form.receivedFromBank.trim(),     target.received_from_bank);
    put('remarks',             form.remarks.trim(),              target.remarks);

    if (Object.keys(patch).length === 0) {
      setError('Nothing was changed.');
      return;
    }

    const { error: rpcErr } = await supabase.rpc('nw_amend_payment', {
      p_payment_id:  target.id,
      p_patch:       patch,
      p_reason:      form.reason.trim(),
      p_row_version: target.row_version,
    });
    if (rpcErr) throw new Error(rpcErr.message || 'Could not correct the payment.');

    showToast(
      patch.amount !== undefined
        ? `${target.payment_number} corrected to ${inr(Number(patch.amount))}.`
        : `${target.payment_number} updated.`
    );
  };

  const submit = async () => {
    setError('');
    const v = validate();
    if (v) { setError(v); return; }

    if (editing) {
      setSaving(true);
      try {
        await submitAmendment(editing);
        setEditing(null);
        setShowForm(false);
        setForm(emptyForm(deal.snap_client_name, defaultBank));
        await load();
      } catch (err: any) {
        setError(err?.message || 'Could not correct the payment.');
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('record-payment', {
        body: {
          dealId: deal.id,
          amount: Number(form.amount),
          currency: 'INR',
          paymentMode: form.paymentMode,
          paymentDate: form.paymentDate,
          valueDate: form.valueDate || undefined,
          utrNumber: form.utrNumber.trim() || undefined,
          chequeNumber: form.chequeNumber.trim() || undefined,
          chequeBank: form.chequeBank.trim() || undefined,
          chequeDated: form.chequeDated || undefined,
          demandDraftNumber: form.demandDraftNumber.trim() || undefined,
          receivedFromName: form.receivedFromName.trim(),
          receivedFromBank: form.receivedFromBank.trim() || undefined,
          remarks: form.remarks.trim() || undefined,
        },
      });
      if (fnErr || !data?.success) {
        throw new Error(await edgeFunctionErrorMessage(fnErr, data, 'Could not record payment.'));
      }
      showToast(t.recordedToast);
      setForm(emptyForm(deal.snap_client_name, defaultBank));
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not record payment.');
    } finally {
      setSaving(false);
    }
  };

  // -----------------------------------------------------------------------
  // Cancel (void) a ledger entry — admin only, enforced again in the RPC.
  // The row is never deleted: it stays visible as 'cancelled' with its reason,
  // and drops out of the paid total (the summary view counts active rows only).
  // -----------------------------------------------------------------------

  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const confirmCancel = async () => {
    if (!cancelling) return;
    if (cancelReason.trim().length < 5) {
      setCancelError('Please give a reason (at least 5 characters).');
      return;
    }
    setCancelBusy(true);
    setCancelError('');
    const { error: rpcErr } = await supabase.rpc('nw_cancel_payment', {
      p_payment_id: cancelling.id,
      p_reason:     cancelReason.trim(),
    });
    setCancelBusy(false);
    if (rpcErr) { setCancelError(rpcErr.message || 'Could not cancel the payment.'); return; }
    showToast(`${cancelling.payment_number} cancelled.`);
    setCancelling(null);
    setCancelReason('');
    await load();
  };

  const openEdit = (p: PaymentRow) => {
    setEditing(p);
    setForm(formFromPayment(p));
    setError('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
    setError('');
  };

  // -----------------------------------------------------------------------
  // Receipt actions
  // -----------------------------------------------------------------------

  const [receiptBusyId, setReceiptBusyId] = useState<string | null>(null);

  const previewOpen = async (path: string) => {
    const { data, error: err } = await supabase.storage.from('deal-documents')
      .createSignedUrl(path, 120);
    if (err || !data?.signedUrl) { showToast(`Could not open ${isPayout ? 'payment advice' : 'receipt'}.`, false); return; }
    window.open(data.signedUrl, '_blank');
  };

  const buildReceiptInput = (p: PaymentRow, receiptNumberFallback: string) => ({
    deal: {
      confirmation_number: deal.confirmation_number,
      snap_client_name:    deal.snap_client_name,
      snap_pan:            deal.snap_pan,
      deal_date:           deal.deal_date,
      security_name:       deal.security_name,
      isin:                deal.isin,
      quantity:            deal.quantity,
      rate_per_unit:       deal.rate_per_unit,
      settlement_amount:   deal.settlement_amount,
    },
    payment: {
      payment_number:        p.payment_number,
      receipt_number:        p.receipt_number ?? receiptNumberFallback,
      amount_inr:            p.amount_inr,
      payment_mode:          p.payment_mode,
      utr_number:            p.utr_number,
      cheque_number:         p.cheque_number,
      cheque_bank:           p.cheque_bank,
      demand_draft_number:   p.demand_draft_number,
      payment_date:          p.payment_date,
      value_date:            p.value_date,
      received_from_name:    p.received_from_name || null,
      received_from_bank:    p.received_from_bank,
      remarks:               p.remarks || null,
    },
    summary: {
      total_paid_amount:  summary?.total_paid_amount ?? 0,
      outstanding_amount: summary?.outstanding_amount ?? 0,
      payment_status:     summary?.payment_status ?? 'not_paid',
    },
    generatedByName: employee.full_name,
    generatedByRole: employee.role === 'admin' ? 'Admin'
      : employee.role === 'super_admin' ? 'Super Admin'
      : 'Relationship Manager',
    issuedAt: new Date(),
    // A payout cannot be acknowledged as money we received — the PDF renders
    // as a Payment Advice instead of a Payment Receipt.
    payout: isPayout,
  });

  const generateOrRegenerate = async (p: PaymentRow) => {
    setReceiptBusyId(p.id);
    try {
      // The receipt number in the PDF for a fresh generation is a *preview*.
      // The server may allocate a different number under race; on regeneration
      // the existing number is preserved so this is always accurate.
      const receiptNumberFallback =
        p.receipt_number ?? `RCPT-${deal.confirmation_number}-PENDING`;

      const pdfBase64 = await renderPaymentReceiptPdf(
        buildReceiptInput(p, receiptNumberFallback)
      );

      const { data, error: fnErr } = await supabase.functions.invoke('upload-receipt', {
        body: { paymentId: p.id, pdfBase64 },
      });
      if (fnErr || !data?.success) {
        throw new Error(await edgeFunctionErrorMessage(fnErr, data, 'Could not upload receipt.'));
      }

      // If the server allocated a different number than our preview
      // (edge case under concurrent first-generation), re-render + re-upload
      // once so the stored PDF and the receipt_number match.
      if (!p.receipt_number && data.receipt_number && data.receipt_number !== receiptNumberFallback) {
        const fixedPdf = await renderPaymentReceiptPdf(
          buildReceiptInput({ ...p, receipt_number: data.receipt_number }, data.receipt_number)
        );
        await supabase.functions.invoke('upload-receipt', {
          body: { paymentId: p.id, pdfBase64: fixedPdf },
        });
      }

      const docNoun = isPayout ? 'Payment advice' : 'Receipt';
      showToast(p.receipt_number ? `${docNoun} regenerated.` : `${docNoun} generated.`);
      await load();
      if (data.signed_url) window.open(data.signed_url, '_blank');
    } catch (err: any) {
      showToast(err?.message || `Could not generate ${isPayout ? 'the payment advice' : 'receipt'}.`, false);
    } finally {
      setReceiptBusyId(null);
    }
  };

  // -----------------------------------------------------------------------
  // Email actions
  // -----------------------------------------------------------------------

  const sendReminder = async () => {
    setEmailBusy('reminder');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('send-payment-acknowledgement', {
        body: { dealId: deal.id },
      });
      if (fnErr || !data?.success) {
        throw new Error(await edgeFunctionErrorMessage(fnErr, data, 'Could not send reminder.'));
      }
      showToast('Payment reminder sent to client.');
      await load();
    } catch (err: any) {
      showToast(err?.message || 'Could not send reminder.', false);
    } finally {
      setEmailBusy(null);
    }
  };

  const sendPaymentLink = async (amount: number) => {
    setEmailBusy('payment_link');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('send-payment-link', {
        body: { dealId: deal.id, amount },
      });
      if (fnErr || !data?.success) {
        // On a non-2xx, supabase-js nulls `data` and reports only "Edge Function
        // returned a non-2xx status code" — the gateway's real reason (a Cashfree
        // rejection, an outstanding-balance error) is left unread on the response.
        // See lib/edgeFunctionError.
        throw new Error(await edgeFunctionErrorMessage(fnErr, data, 'Could not send payment link.'));
      }
      showToast('Payment link sent to client.');
      await load();
    } catch (err: any) {
      showToast(err?.message || 'Could not send payment link.', false);
    } finally {
      setEmailBusy(null);
    }
  };

  const sendReceipt = async (p: PaymentRow) => {
    setEmailBusy(p.id);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('send-payment-acknowledgement', {
        body: { paymentId: p.id },
      });
      if (fnErr || !data?.success) {
        throw new Error(await edgeFunctionErrorMessage(fnErr, data, 'Could not send receipt.'));
      }
      const type = data.email_type as string;
      const doc  = isPayout ? 'payment advice' : 'receipt';
      showToast(
        type === 'payment_final' ? `Full-settlement ${doc} sent to client.`
        : type === 'payment_partial' ? `Part-settlement ${doc} sent to client.`
        : 'Email sent to client.'
      );
      await load();
    } catch (err: any) {
      showToast(err?.message || `Could not send ${isPayout ? 'the payment advice' : 'receipt'}.`, false);
    } finally {
      setEmailBusy(null);
    }
  };

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const isStale = (p: PaymentRow): boolean => {
    if (!p.receipt_pdf_path || !p.receipt_generated_at) return false;
    return new Date(p.updated_at).getTime() > new Date(p.receipt_generated_at).getTime();
  };

  const lastEmailedFor = (paymentId: string): EmailLogRow | null =>
    emailLog.find(e => e.payment_id === paymentId && e.status === 'sent') ?? null;

  // Default payer bank = the client's PRIMARY account (falls back to the deal
  // snapshot bank). When the client has more than one bank on file the form
  // renders a dropdown instead of a free-text field.
  const defaultBank = useMemo(() => {
    if (bankAccounts.length) {
      const primary = bankAccounts.find(b => b.is_primary) ?? bankAccounts[0];
      return primary.bank_name || deal.snap_bank_name || '';
    }
    return deal.snap_bank_name || '';
  }, [bankAccounts, deal.snap_bank_name]);

  const modeNeedsUtr = useMemo(() => {
    const m = form.paymentMode;
    return m === 'imps' || m === 'neft' || m === 'rtgs' || m === 'upi' || m === 'bank_transfer';
  }, [form.paymentMode]);

  const modeIsCheque = form.paymentMode === 'cheque';
  const modeIsDd    = form.paymentMode === 'demand_draft';

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ChevronLeft className="w-4 h-4" /> Back to Deal
        </button>
        <div className="flex-1" />
        {!showForm && summary && summary.payment_status !== 'fully_paid' && (
          <button
            onClick={() => { setEditing(null); setForm(emptyForm(deal.snap_client_name, defaultBank)); setShowForm(true); }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
          >
            <Plus className="w-4 h-4" /> {t.recordCta}
          </button>
        )}
      </div>

      {/* Title */}
      <div>
        <p className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'var(--accent)' }}>
          {t.ledgerTitle}
        </p>
        <h1 className="text-xl font-bold text-text-primary">
          {deal.confirmation_number} — {deal.snap_client_name}
        </h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>PAN: {deal.snap_pan || '—'}</p>
      </div>

      {/* Summary strip */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <SummaryCard icon={<Receipt className="w-4 h-4" />} label="Deal Amount" value={inr(summary.deal_amount)} />
          <SummaryCard icon={<IndianRupee className="w-4 h-4" />} label={t.totalLabel} value={inr(summary.total_paid_amount)} tone="success" />
          <SummaryCard
            icon={<Wallet className="w-4 h-4" />}
            label={t.outstandingLabel}
            value={inr(summary.outstanding_amount)}
            tone={summary.outstanding_amount > 0 ? 'warning' : summary.outstanding_amount < 0 ? 'danger' : 'success'}
          />
          <div
            className="rounded-2xl px-4 py-3 flex items-center justify-between"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
          >
            <div>
              <p className="text-xs uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Status</p>
              <StatusPill status={summary.payment_status} copy={t} />
            </div>
          </div>
        </div>
      )}

      {/* Excess-payment note. The status pill reads 'Over Paid' in this case;
          this spells out the amount and the refund follow-up. */}
      {summary && summary.outstanding_amount < 0 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2 text-sm"
          style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', color: 'var(--warning)' }}
        >
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {isPayout ? (
              <>
                An excess payout of <strong>{inr(Math.abs(summary.outstanding_amount))}</strong> has been recorded
                against this deal. Recover it from the client and record an adjusting entry once settled.
              </>
            ) : (
              <>
                An excess of <strong>{inr(Math.abs(summary.outstanding_amount))}</strong> has been recorded against this deal.
                Consider recording a refund entry once processed.
              </>
            )}
          </span>
        </div>
      )}

      {/* Payment reminder — only when nothing has been received. A reminder
          asks the CLIENT to pay us, so it belongs to a Buy deal only; on a Sell
          the money is owed by us and the RM gets a plain prompt instead. */}
      {summary?.payment_status === 'not_paid' && (
        isPayout ? (
          <PayoutPendingCard amount={summary.outstanding_amount} />
        ) : (
          <ReminderCard
            lastSentAt={emailLog.find(e => e.email_type === 'payment_reminder' && e.status === 'sent')?.sent_at ?? null}
            busy={emailBusy === 'reminder'}
            onSend={() => sendReminder()}
          />
        )
      )}

      {/* Send Payment Link — collect-only. A Cashfree link charges the client;
          on a Sell we owe them, so there is nothing to collect and the card is
          withdrawn (send-payment-link refuses Sell deals server-side too). */}
      {!isPayout && summary && summary.outstanding_amount > 0 && (
        <PaymentLinkCard
          amount={summary.outstanding_amount}
          lastSentAt={emailLog.find(e => e.email_type === 'payment_link' && e.status === 'sent')?.sent_at ?? null}
          busy={emailBusy === 'payment_link'}
          onSend={(amt) => sendPaymentLink(amt)}
        />
      )}

      {/* Record-payment inline form */}
      {showForm && (
        <div
          className="rounded-2xl p-5 space-y-5"
          style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
              {editing ? `${t.correctTitle} — ${editing.payment_number}` : t.formTitle}
            </h2>
            <button
              onClick={closeForm}
              className="p-1.5 rounded-lg"
              style={{ color: 'var(--text-secondary)' }}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* What is on record right now, so the operator can see the mistake
              they are fixing without leaving the form. */}
          {editing && (
            <div
              className="rounded-xl px-4 py-3 text-sm"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}
            >
              <p style={{ color: 'var(--text-secondary)' }}>
                Currently recorded: <strong style={{ color: 'var(--text-primary)' }}>{inr(editing.amount_inr)}</strong>
                {' '}by {MODE_LABEL[editing.payment_mode]} on {fmtDate(editing.payment_date)}.
              </p>
              {Number(form.amount) > 0 && Number(form.amount) !== Number(editing.amount) && (
                <p className="mt-1" style={{ color: 'var(--warning)' }}>
                  Will be corrected to <strong>{inr(Number(form.amount))}</strong> — the deal’s outstanding
                  balance is recalculated on save.
                </p>
              )}
              {editing.receipt_pdf_path && (
                <p className="mt-1 text-xs" style={{ color: 'var(--warning)' }}>
                  {isPayout
                    ? 'A payment advice has already been issued for this payout. Regenerate it after saving, and re-send it if the client received the old one.'
                    : 'A receipt has already been issued for this payment. Regenerate it after saving, and re-send it if the client received the old one.'}
                </p>
              )}
            </div>
          )}

          {error && (
            <div
              className="rounded-xl px-4 py-3 flex items-start gap-2 text-sm"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger)' }}
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Amount (INR)" required>
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={e => set('amount', e.target.value)}
                placeholder="0.00"
              />
            </Field>
            <Field label="Payment Mode" required>
              <Select
                value={form.paymentMode}
                onChange={e => set('paymentMode', e.target.value as PaymentMode | '')}
              >
                <option value="">Select a mode…</option>
                {PAYMENT_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Select>
            </Field>

            <Field label="Payment Date" required>
              <Input type="date" value={form.paymentDate} onChange={e => set('paymentDate', e.target.value)} />
            </Field>
            <Field label="Value Date" hint="Credit-realised date (optional).">
              <Input type="date" value={form.valueDate} onChange={e => set('valueDate', e.target.value)} />
            </Field>

            {/* Mode-specific instrument fields */}
            {modeNeedsUtr && (
              <Field label="UTR / Transaction Ref No" hint="Bank UTR / RRN / transaction reference.">
                <Input value={form.utrNumber} onChange={e => set('utrNumber', e.target.value.trim())} placeholder="e.g. HDFCN12345678 / RRN" />
              </Field>
            )}
            {modeIsCheque && (
              <>
                <Field label="Cheque Number" required>
                  <Input value={form.chequeNumber} onChange={e => set('chequeNumber', e.target.value.trim())} placeholder="123456" />
                </Field>
                <Field label="Cheque Bank" required>
                  <Input value={form.chequeBank} onChange={e => set('chequeBank', e.target.value)} placeholder="HDFC Bank" />
                </Field>
                <Field label="Cheque Dated">
                  <Input type="date" value={form.chequeDated} onChange={e => set('chequeDated', e.target.value)} />
                </Field>
              </>
            )}
            {modeIsDd && (
              <Field label="Demand Draft Number">
                <Input value={form.demandDraftNumber} onChange={e => set('demandDraftNumber', e.target.value.trim())} />
              </Field>
            )}

            <Field label={t.counterpartyNameLabel}>
              <Input
                value={form.receivedFromName}
                onChange={e => set('receivedFromName', e.target.value)}
                placeholder={isPayout ? 'Beneficiary name' : 'Payer name'}
              />
            </Field>
            <Field
              label={t.counterpartyBankLabel}
              hint={bankAccounts.length > 1 ? t.counterpartyBankHint : undefined}
            >
              {bankAccounts.length > 1 ? (
                <Select value={form.receivedFromBank} onChange={e => set('receivedFromBank', e.target.value)}>
                  {bankAccounts.map(b => (
                    <option key={`${b.bank_name}-${b.account_number}`} value={b.bank_name}>
                      {b.bank_name || 'Bank'}
                      {b.account_number ? ` ••${b.account_number.slice(-4)}` : ''}
                      {b.is_primary ? ' (Primary)' : ''}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={form.receivedFromBank} onChange={e => set('receivedFromBank', e.target.value)} placeholder="e.g. HDFC Bank" />
              )}
            </Field>
          </div>

          <Field label="Remarks">
            <TextArea rows={2} value={form.remarks} onChange={e => set('remarks', e.target.value)} placeholder="Any internal note for this payment…" />
          </Field>

          {editing && (
            <Field label="Reason for correction" required hint="Stored on the audit trail against this payment.">
              <TextArea
                rows={2}
                value={form.reason}
                onChange={e => set('reason', e.target.value)}
                placeholder="e.g. Amount keyed with an extra zero — bank credit was ₹7,30,000."
              />
            </Field>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              onClick={closeForm}
              className="px-4 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent"
              style={{
                background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))',
                opacity: saving ? 0.75 : 1,
              }}
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> {editing ? 'Saving…' : 'Recording…'}</>
                : <>{editing ? 'Save Correction' : t.recordCta}</>}
            </button>
          </div>
        </div>
      )}

      {/* Ledger */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
      >
        <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <h3 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Ledger
          </h3>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {payments.length} {payments.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        {loading ? (
          <div className="p-8">
            <LogoLoader size={44} label="Loading payments…" />
          </div>
        ) : payments.length === 0 ? (
          <div className="p-10 text-center">
            <Info className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {t.emptyTitle}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
              {t.emptyHint}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm nw-table">
              <thead>
                <tr style={{ background: 'var(--bg-base)', color: 'var(--text-muted)' }}>
                  <Th>Date</Th>
                  <Th>Payment #</Th>
                  <Th>Mode</Th>
                  <Th>Reference</Th>
                  <Th>{t.counterpartyColumn}</Th>
                  <Th align="right">Amount</Th>
                  <Th>{t.docColumn}</Th>
                  <Th>Correct</Th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => {
                  const receiptBusy = receiptBusyId === p.id;
                  const mailBusy    = emailBusy === p.id;
                  const hasReceipt  = !!p.receipt_pdf_path && !!p.receipt_number;
                  const canIssue    = p.status === 'active';
                  const stale       = isStale(p);
                  const lastEmail   = lastEmailedFor(p.id);
                  const emailDisabledReason =
                    !hasReceipt ? t.emailDisabledHint
                    : stale     ? `Payment data has changed. Regenerate the ${isPayout ? 'payment advice' : 'receipt'} before emailing.`
                    : null;
                  // A hand-keyed entry can be corrected by whoever can reach
                  // this ledger — the owning RM or an admin (RLS already scopes
                  // who gets here, and nw_amend_payment re-checks). A gateway
                  // capture is the PSP's record and is never rewritten.
                  const isGateway = !!p.provider && p.provider !== 'manual';
                  const canAmend  = canIssue && !isGateway;
                  return (
                    <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <Td>{fmtDate(p.payment_date)}</Td>
                      <Td mono>{p.payment_number}</Td>
                      <Td>{MODE_LABEL[p.payment_mode]}</Td>
                      <Td mono>
                        {p.utr_number ||
                          p.cheque_number ||
                          p.demand_draft_number ||
                          '—'}
                      </Td>
                      <Td>{p.received_from_name || '—'}</Td>
                      <Td align="right" strong>
                        {/* A cancelled entry stays on the ledger but no longer
                            counts towards the amount paid — show it struck out
                            so the column still adds up to the summary strip. */}
                        <span style={canIssue ? undefined : { textDecoration: 'line-through', opacity: 0.5 }}>
                          {p.direction === 'refund' ? '-' : ''}{inr(Math.abs(p.amount_inr))}
                        </span>
                      </Td>
                      <Td>
                        {!canIssue ? (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{p.status}</span>
                        ) : hasReceipt ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                onClick={() => previewOpen(p.receipt_pdf_path!)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold"
                                style={{ background: 'rgba(var(--accent-rgb),0.10)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}
                                title={p.receipt_number ?? undefined}
                              >
                                <Eye className="w-3 h-3" /> View
                              </button>
                              <button
                                onClick={() => generateOrRegenerate(p)}
                                disabled={receiptBusy}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs"
                                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)', opacity: receiptBusy ? 0.6 : 1 }}
                                title={`v${p.receipt_regen_count} → v${p.receipt_regen_count + 1}`}
                              >
                                {receiptBusy
                                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Regen…</>
                                  : <><RefreshCw className="w-3 h-3" /> Regenerate</>}
                              </button>
                              <button
                                onClick={() => sendReceipt(p)}
                                disabled={!!emailDisabledReason || mailBusy}
                                title={emailDisabledReason ?? (lastEmail ? `Resend to client (last sent ${fmtDate(lastEmail.sent_at)})` : t.emailTitle)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold"
                                style={emailDisabledReason
                                  ? { background: 'var(--bg-base)', color: 'var(--text-muted)', border: '1px solid var(--border)', cursor: 'not-allowed', opacity: 0.6 }
                                  : { background: 'rgba(16,185,129,0.10)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.25)', opacity: mailBusy ? 0.6 : 1 }}
                              >
                                {mailBusy
                                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</>
                                  : <><Mail className="w-3 h-3" /> {lastEmail ? 'Resend' : 'Email'}</>}
                              </button>
                            </div>
                            <div className="text-[10px] leading-tight" style={{ color: 'var(--text-faint)' }}>
                              {p.receipt_number ? `${p.receipt_number} · v${p.receipt_regen_count}` : ''}
                              {stale ? <span style={{ color: 'var(--warning)' }}> · out of date</span> : null}
                              {lastEmail ? ` · last emailed ${fmtDate(lastEmail.sent_at)}` : ''}
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => generateOrRegenerate(p)}
                            disabled={receiptBusy}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-on-accent"
                            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', opacity: receiptBusy ? 0.6 : 1 }}
                          >
                            {receiptBusy
                              ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</>
                              : <><FileText className="w-3 h-3" /> {t.generateCta}</>}
                          </button>
                        )}
                      </Td>
                      {/* Correction actions. Edit fixes a mis-keyed entry in
                          place (audited); Cancel voids it outright and is
                          admin-only, as the footnote below has always said. */}
                      <Td>
                        {!canAmend ? (
                          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                            {isGateway ? 'Gateway entry' : p.cancellation_reason || '—'}
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => openEdit(p)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold"
                              style={{ background: 'rgba(96,165,250,0.10)', color: 'rgb(var(--info-soft-rgb))', border: '1px solid rgba(96,165,250,0.25)' }}
                              title="Correct a mis-keyed amount or reference"
                            >
                              <Pencil className="w-3 h-3" /> Edit
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => { setCancelling(p); setCancelReason(''); setCancelError(''); }}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold"
                                style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.22)' }}
                                title="Void this entry (kept in the ledger, excluded from the paid total)"
                              >
                                <Ban className="w-3 h-3" /> Cancel
                              </button>
                            )}
                          </div>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Admin footnote */}
      {!isAdmin && (
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          You may record {isPayout ? 'payouts' : 'payments'}, correct a mis-keyed entry, and view the ledger
          for deals you own. Cancelling a recorded entry outright is restricted to administrators.
        </p>
      )}

      {/* Cancel (void) confirmation */}
      {cancelling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
          <div className="w-full max-w-md rounded-2xl p-6 space-y-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(239,68,68,0.1)' }}>
                <Ban className="w-5 h-5" style={{ color: 'var(--danger)' }} />
              </div>
              <div>
                <p className="text-sm font-bold text-text-primary">{isPayout ? 'Cancel Payout' : 'Cancel Payment'}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {cancelling.payment_number} · {inr(cancelling.amount_inr)}
                </p>
              </div>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              The entry stays in the ledger marked cancelled and stops counting towards the amount
              settled, so this deal’s {isPayout ? 'balance payable' : 'outstanding balance'} goes back up.
              Use this to void an entry for money that never moved — to fix a wrong amount, use{' '}
              <strong>Edit</strong> instead.
            </p>
            <Field label="Reason" required>
              <TextArea
                rows={2}
                value={cancelReason}
                onChange={e => { setCancelReason(e.target.value); setCancelError(''); }}
                placeholder="e.g. Duplicate entry — the same UTR was recorded twice."
              />
            </Field>
            {cancelError && (
              <p className="text-xs" style={{ color: 'var(--danger)' }}>{cancelError}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => { setCancelling(null); setCancelError(''); }}
                disabled={cancelBusy}
                className="flex-1 py-2.5 rounded-xl text-sm"
                style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                Keep it
              </button>
              <button
                onClick={confirmCancel}
                disabled={cancelBusy}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2"
                style={{ background: 'var(--danger)', opacity: cancelBusy ? 0.7 : 1 }}
              >
                {cancelBusy ? <><Loader2 className="w-4 h-4 animate-spin" /> Cancelling…</> : (isPayout ? 'Cancel Payout' : 'Cancel Payment')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 rounded-xl px-4 py-3 text-sm shadow-lg z-50 flex items-center gap-2"
          style={{
            background: toast.ok ? 'rgba(16,185,129,0.95)' : 'rgba(239,68,68,0.95)',
            color: '#fff',
          }}
        >
          {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function ReminderCard({ lastSentAt, busy, onSend }: {
  lastSentAt: string | null;
  busy: boolean;
  onSend: () => void;
}) {
  const fmt = (d: string) => new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  return (
    <div
      className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
      style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start gap-2">
        <Bell className="w-4 h-4 mt-0.5" style={{ color: 'var(--warning)' }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            No payments recorded yet
          </p>
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {lastSentAt
              ? `Reminder last sent to the client on ${fmt(lastSentAt)}.`
              : 'You can send the client a Payment Reminder email.'}
          </p>
        </div>
      </div>
      <button
        onClick={onSend}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold"
        style={{
          background: 'var(--bg-base)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
          : <><Mail className="w-4 h-4" /> {lastSentAt ? 'Resend Reminder' : 'Send Payment Reminder'}</>}
      </button>
    </div>
  );
}

// The Sell-side counterpart of ReminderCard. There is nothing to chase the
// client for — we owe them — so this states the position and stops there.
function PayoutPendingCard({ amount }: { amount: number }) {
  const inrFmt = (n: number) =>
    '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <div
      className="rounded-xl px-4 py-3 flex items-start gap-2"
      style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
    >
      <Bell className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          No payout recorded yet
        </p>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          The client is the seller on this deal. {inrFmt(amount)} is payable by Niyom to their bank
          account — record it here once the transfer is made.
        </p>
      </div>
    </div>
  );
}

function PaymentLinkCard({ amount, lastSentAt, busy, onSend }: {
  amount: number;                       // current outstanding — the single ceiling
  lastSentAt: string | null;
  busy: boolean;
  onSend: (amount: number) => void;
}) {
  const fmt = (d: string) => new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const inrFmt = (n: number) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Sprint 9: employee enters the amount to collect (prefilled with the current
  // outstanding, editable, 2 dp). Outstanding is the single ceiling. The server
  // re-validates authoritatively.
  const [value, setValue] = useState<string>(amount.toFixed(2));
  const parsed = Math.round(Number(value) * 100) / 100;
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= amount;
  const liveError =
    value.trim() === '' ? 'Enter an amount to collect.'
      : (!Number.isFinite(parsed) || parsed <= 0) ? 'Enter an amount greater than 0.'
      : parsed > amount ? `Amount cannot exceed the outstanding balance of ${inrFmt(amount)}.`
      : '';
  return (
    <div
      className="rounded-xl px-4 py-3 flex flex-col gap-3"
      style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start gap-2">
        <CreditCard className="w-4 h-4 mt-0.5" style={{ color: 'var(--accent)' }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Send a payment link
          </p>
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {lastSentAt
              ? `Payment link last sent to the client on ${fmt(lastSentAt)}.`
              : 'Enter the amount to collect, then email the client a secure Cashfree link (UPI / Debit Card) plus bank-transfer details.'}
          </p>
        </div>
      </div>
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
            Amount to collect (max {inrFmt(amount)})
          </label>
          <input
            type="number" step="0.01" min="0.01" max={amount}
            value={value}
            onChange={e => setValue(e.target.value)}
            className="w-44 px-3 py-2 rounded-lg text-sm text-text-primary outline-none"
            style={{ background: 'var(--bg-base)', border: `1px solid ${liveError ? 'var(--danger)' : 'var(--border)'}` }}
          />
        </div>
        <button
          onClick={() => onSend(parsed)}
          disabled={busy || !valid}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50"
          style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        >
          {busy
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
            : <><CreditCard className="w-4 h-4" /> {lastSentAt ? 'Resend Payment Link' : 'Send Payment Link'}</>}
        </button>
      </div>
      {liveError && !busy && <p className="text-xs" style={{ color: 'var(--danger)' }}>{liveError}</p>}
    </div>
  );
}

function SummaryCard({
  icon, label, value, tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'danger';
}) {
  const color =
    tone === 'success' ? 'var(--success)' :
    tone === 'warning' ? 'var(--warning)' :
    tone === 'danger'  ? 'var(--danger)'  : 'var(--text-bright)';
  return (
    <div
      className="rounded-2xl px-4 py-3"
      style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
    >
      <p className="text-xs uppercase tracking-wider mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
        {icon} {label}
      </p>
      <p className="text-lg font-bold" style={{ color }}>{value}</p>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider"
      style={{ textAlign: align ?? 'left' }}
    >
      {children}
    </th>
  );
}

function Td({
  children, align, mono, strong,
}: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean; strong?: boolean }) {
  return (
    <td
      className={`px-4 py-3 ${mono ? 'font-mono text-xs' : ''} ${strong ? 'font-bold' : ''}`}
      style={{ textAlign: align ?? 'left', color: 'var(--text-primary)' }}
    >
      {children}
    </td>
  );
}
