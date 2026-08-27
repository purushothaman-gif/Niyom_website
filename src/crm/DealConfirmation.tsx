import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LogoLoader } from '../components/LogoLoader';
import { supabase } from '../lib/supabase';
import { edgeFunctionErrorMessage } from '../lib/edgeFunctionError';
import type { Insertable } from '../lib/dbJson';
import { NWEmployee, NWClient } from './types';
import {
  FileText, Plus, Search, ChevronDown, Eye, Pencil, Trash2,
  Download, CheckCircle2, AlertCircle, ChevronLeft, Send, Wallet, Lock,
} from 'lucide-react';
import html2pdf from 'html2pdf.js';
import DealDocument from './DealDocument';
import DealPayments from './DealPayments';
import SecuritySearch from './SecuritySearch';

type AcceptanceStatus = 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';


interface Props { employee: NWEmployee; }

// One security line within a deal. A deal is single-direction (Buy or Sell,
// on the header); each line carries its own security + quantity + rate.
interface LineItemForm {
  product_type: string;
  security_name: string;
  isin: string;
  quantity: string;
  base_rate: string;       // raw value user types
  rate_per_unit: string;   // adjusted = base_rate - (base_rate * duty%/100)
  manual: boolean;         // security entered manually → product_type editable
}

interface DealForm {
  client_id: string;
  deal_date: string;
  transaction_type: 'Buy' | 'Sell' | '';
  notes: string;
  lines: LineItemForm[];
}

interface DealRecord {
  id: string;
  confirmation_number: string;
  client_id: string;
  employee_id: string;
  status: 'draft' | 'confirmed';
  deal_date: string;
  transaction_type: string;
  product_type: string;
  security_name: string;
  isin: string;
  quantity: number;
  rate_per_unit: number;
  base_rate: number;
  settlement_amount: number;
  stamp_duty: number;
  snap_client_name: string;
  snap_pan: string;
  snap_dp_name: string;
  snap_demat_account: string;
  snap_depository: string;
  snap_bank_name: string;
  snap_bank_account: string;
  snap_bank_ifsc: string;
  snap_address: string;
  snap_phone: string;
  snap_email: string;
  notes: string;
  created_at: string;
  email_status: 'pending' | 'sent';
  email_sent_at?: string;
  email_sent_by?: string;
  acceptance_status: AcceptanceStatus;
  secure_token?: string | null;
  token_expires_at?: string | null;
  viewed_at?: string | null;
  accepted_at?: string | null;
  rejected_at?: string | null;
  rejection_reason?: string | null;
  signer_email?: string | null;
  signed_pdf_path?: string | null;
  client?: { full_name: string; client_code: string };
  // Internal revenue basis + audit stamps
  landing_cost?: number | null;
  insurance_revenue?: number | null;
  brokerage_amount?: number | null;
  trail_percent?: number | null;
  trail_start_date?: string | null;
  revenue_basis_entered_by?: string | null;
  revenue_basis_entered_at?: string | null;
  revenue_basis_last_modified_by?: string | null;
  revenue_basis_last_modified_at?: string | null;
  // Line items (one row per security). Attached by the list query.
  items?: DealItemRecord[];
}

interface DealItemRecord {
  id: string;
  sort_order: number;
  product_type: string;
  security_name: string;
  isin: string;
  quantity: number;
  base_rate: number;
  rate_per_unit: number;
  line_settlement: number;
  line_stamp_duty: number;
}

// Deal Confirmations are raised ONLY for Unlisted Shares and Bonds (the products
// that need a demat + CML). Mutual Funds, Fixed Deposits and Insurance are never
// dealt through this document.
const PRODUCT_TYPES = [
  'Unlisted Share', 'Secondary Bond', 'Primary Bond',
];

// Map an NSDL security_description (free text) to our product type. NSDL tells
// us the instrument class (equity vs debt) but NOT primary-vs-secondary — that's
// a transaction attribute — so any bond/debenture maps to 'Secondary Bond'; a
// Primary issue is set by switching Step 3 to manual entry. Keyword-based so it
// tolerates NSDL's varied descriptions. Returns '' when it can't classify (the
// form then leaves Product Type editable rather than trapping the operator).
function deriveProductType(securityType: string): string {
  const t = (securityType || '').toUpperCase();
  if (!t) return '';
  if (/DEBENT|BOND|\bNCD\b|COMMERCIAL PAPER|CERTIFICATE OF DEPOSIT|\bSDL\b|G-?SEC|GOVERNMENT SEC|TREASURY|SECURITY RECEIPT|PERPETUAL|\bSLR\b|\bTIER\b/.test(t)) {
    return 'Secondary Bond';
  }
  if (/EQUITY|SHARE|STOCK|SCRIP/.test(t)) return 'Unlisted Share';
  return '';
}

const emptyLine = (): LineItemForm => ({
  product_type: '',
  security_name: '',
  isin: '',
  quantity: '',
  base_rate: '',
  rate_per_unit: '',
  manual: false,
});

const emptyForm = (): DealForm => ({
  client_id: '',
  deal_date: new Date().toISOString().split('T')[0],
  transaction_type: '',
  notes: '',
  lines: [emptyLine()],
});

// Stamp duty rate (percent) by product type.
//
// MUST stay in step with nw_stamp_duty_rate() in the database, which is the
// source of truth — stamp_duty is a generated column and the rate that applied
// is stored per deal (nw_deal_confirmations.stamp_duty_rate), so signed deals
// keep the rate they were signed with. These values only drive this form's
// live preview.
const STAMP_DUTY_RATES: Record<string, number> = {
  'Unlisted Share': 0.015,
  'Secondary Bond': 0.0001,
};
const stampDutyRateFor = (productType: string): number =>
  STAMP_DUTY_RATES[productType] ?? 0;

// The rate the RM enters is the BASE — what the client agreed to pay per unit.
// Stamp duty is carved OUT of that base, so:
//     net (adjusted) rate + stamp duty  ==  base rate
// and therefore the settlement must always come back to qty × base rate.
//
// This must NOT round to 2dp. The adjusted rate is a per-unit figure that then
// gets multiplied by quantity, so any rounding here is multiplied too: 2050
// adjusts to 2049.6925, and rounding that to 2049.69 loses 0.0025/unit — which
// is ₹0.25 over 100 units, and ₹37 over 50,000. The error also flips sign,
// since some rates round up (4.95 → 4.95), which is why it looked random.
//
// Full precision is kept here; every display path already rounds to 2dp for
// presentation (the deal note included), and the settlement is rounded once at
// the end. 8dp is far beyond any rate this desk trades and keeps the value
// free of float artefacts like 2049.6924999999999.
function adjustRate(base: string, dutyRatePercent: number): string {
  const n = parseFloat(base);
  if (!base || isNaN(n) || n <= 0) return '';
  return String(Math.round((n - n * dutyRatePercent / 100) * 1e8) / 1e8);
}

function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Bonds carry a coupon + maturity year in their full name, e.g.
// "12.50% Vedika Credit Capital Limited 2031". We compose that from the plain
// company name + coupon + year on save, and decompose it back when editing.
function buildPdfOpts(confirmationNumber: string, dealDate: string, scale: number) {
  return {
    margin: 0,
    filename: `DEAL-CONFIRMATION-${confirmationNumber}-${dealDate}.pdf`,
    image: { type: 'png' as const, quality: 1 },
    html2canvas: { scale, useCORS: true, logging: false, windowWidth: 794, letterRendering: true },
    jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'portrait' as const },
    pagebreak: { mode: ['css', 'legacy'] as string[] },
  };
}

// ---------- Read-only field ----------
function ROField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <div className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none"
        style={{ background: 'rgba(var(--accent-rgb),0.04)', border: '1px solid rgba(var(--accent-rgb),0.12)', color: 'var(--text-bright)' }}>
        {value || '—'}
      </div>
    </div>
  );
}

// ---------- Editable field ----------
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

// ---------- Acceptance Status Badge ----------
const ACCEPTANCE_STYLES: Record<AcceptanceStatus, { label: string; bg: string; color: string }> = {
  pending:  { label: 'Pending',  bg: 'rgba(107,107,107,0.1)', color: 'var(--text-secondary)' },
  viewed:   { label: 'Viewed',   bg: 'rgba(96,165,250,0.12)', color: 'rgb(var(--info-soft-rgb))' },
  accepted: { label: 'Accepted', bg: 'rgba(16,185,129,0.1)',  color: 'var(--success)' },
  rejected: { label: 'Rejected', bg: 'rgba(239,68,68,0.1)',   color: 'var(--danger)' },
  expired:  { label: 'Expired',  bg: 'rgba(245,158,11,0.1)',  color: 'var(--warning)' },
};

// ---------- Payment Status Pill (deal-list quick entry) ----------
const PAYMENT_STATUS_STYLES: Record<'not_paid' | 'partially_paid' | 'fully_paid' | 'over_paid', { label: string; bg: string; color: string }> = {
  not_paid:       { label: 'Not Paid',       bg: 'rgba(107,107,107,0.10)', color: 'var(--text-secondary)' },
  partially_paid: { label: 'Partially Paid', bg: 'rgba(245,158,11,0.10)',  color: 'var(--warning)' },
  fully_paid:     { label: 'Fully Paid',     bg: 'rgba(16,185,129,0.10)',  color: 'var(--success)' },
  over_paid:      { label: 'Over Paid',      bg: 'rgba(59,130,246,0.10)',  color: 'var(--info)' },
};

// On a Sell the client is the seller and Niyom is the buyer, so the ledger
// tracks money going OUT to them. Same arithmetic, opposite direction — the
// pill must not read "Not Paid" as though the client owed us. Mirrors the
// wording in DealPayments.
const PAYOUT_STATUS_LABEL: Record<'not_paid' | 'partially_paid' | 'fully_paid' | 'over_paid', string> = {
  not_paid:       'Not Paid Out',
  partially_paid: 'Partially Paid Out',
  fully_paid:     'Fully Paid Out',
  over_paid:      'Over Paid',
};

function PaymentStatusPill({
  summary,
  transactionType,
  onClick,
}: {
  summary?: { payment_status: 'not_paid' | 'partially_paid' | 'fully_paid' | 'over_paid'; outstanding_amount: number };
  transactionType: string;
  onClick: () => void;
}) {
  const status = summary?.payment_status ?? 'not_paid';
  const s = PAYMENT_STATUS_STYLES[status] ?? PAYMENT_STATUS_STYLES.not_paid;
  const isPayout = (transactionType || '').trim().toLowerCase() === 'sell';
  const label = isPayout ? (PAYOUT_STATUS_LABEL[status] ?? PAYOUT_STATUS_LABEL.not_paid) : s.label;
  return (
    <button
      onClick={onClick}
      title={isPayout ? 'Open the payout ledger' : 'Open Manage Payments'}
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider transition-transform hover:scale-105"
      style={{ background: s.bg, color: s.color, border: `1px solid color-mix(in srgb, ${s.color} 20%, transparent)` }}
    >
      <Wallet className="w-3 h-3" />
      {label}
    </button>
  );
}

function AcceptanceBadge({ status }: { status: AcceptanceStatus }) {
  const s = ACCEPTANCE_STYLES[status] ?? ACCEPTANCE_STYLES.pending;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg"
      style={{ background: s.bg, color: s.color, border: `1px solid color-mix(in srgb, ${s.color} 20%, transparent)` }}
    >
      {status === 'accepted' && <CheckCircle2 className="w-3 h-3" />}
      {s.label}
    </span>
  );
}

// ============================================================
export default function DealConfirmation({ employee }: Props) {
  const [view, setView] = useState<'list' | 'form' | 'preview' | 'payments'>('list');
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [clients, setClients] = useState<NWClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [form, setForm] = useState<DealForm>(emptyForm());
  const [selectedClient, setSelectedClient] = useState<NWClient | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDrop, setShowClientDrop] = useState(false);
  const [editDeal, setEditDeal] = useState<DealRecord | null>(null);
  const [previewDeal, setPreviewDeal] = useState<DealRecord | null>(null);
  const [deleteDeal, setDeleteDeal] = useState<DealRecord | null>(null);
  const [search, setSearch] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [paySummaries, setPaySummaries] = useState<Record<string, { payment_status: 'not_paid' | 'partially_paid' | 'fully_paid' | 'over_paid'; outstanding_amount: number }>>({});
  const [paySummariesLoaded, setPaySummariesLoaded] = useState(false);

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const clientDropRef = useRef<HTMLDivElement>(null);

  // These MUST mirror the generated columns on nw_deal_confirmations, which are
  // the source of truth — this component never sends stamp_duty or
  // settlement_amount, the database computes both:
  //
  //   stamp_duty        = ROUND(base_rate * quantity * stamp_duty_rate / 100, 2)
  //   settlement_amount = ROUND(base_rate * quantity, 2)
  //
  // Settlement is therefore ALWAYS qty × the rate the RM entered. Stamp duty is
  // carved out of that total, not added to it, and its rate depends on the
  // product type.
  //
  // This preview previously derived the total from the ADJUSTED rate instead
  // (qty × adjRate, then added duty back on), which disagreed with the database
  // and under/over-stated the total on screen — ₹0.25 on 2050×100, and up to
  // ₹37 on large-quantity trades. The stored figure was always correct; only
  // this on-screen preview was wrong.
  // Per-line and deal-level figures. Each line's settlement is qty x base rate;
  // stamp duty is carved out of that per its product's duty rate. The deal
  // totals are the sums — matching the DB (header totals = SUM of line items).
  const lineCalc = (ln: LineItemForm) => {
    const qty = parseFloat(ln.quantity) || 0;
    const baseRate = parseFloat(ln.base_rate) || 0;
    const dutyRate = stampDutyRateFor(ln.product_type);
    return {
      qty,
      baseRate,
      adjRate: parseFloat(ln.rate_per_unit) || 0,
      dutyRate,
      settlement: Math.round(qty * baseRate * 100) / 100,
      stamp: Math.round(qty * baseRate * dutyRate / 100 * 100) / 100,
    };
  };
  const totalSettlement = form.lines.reduce((s, ln) => s + lineCalc(ln).settlement, 0);
  const totalStampDuty = form.lines.reduce((s, ln) => s + lineCalc(ln).stamp, 0);

  // Line mutators.
  const updateLine = (idx: number, patch: Partial<LineItemForm>) =>
    setForm(f => ({ ...f, lines: f.lines.map((ln, i) => (i === idx ? { ...ln, ...patch } : ln)) }));
  const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (idx: number) =>
    setForm(f => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((_, i) => i !== idx) : f.lines }));

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const loadDeals = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('nw_deal_confirmations')
      .select('*, client:nw_clients(full_name, client_code), items:nw_deal_confirmation_items(id, sort_order, product_type, security_name, isin, quantity, base_rate, rate_per_unit, line_settlement, line_stamp_duty)')
      .order('created_at', { ascending: false });
    if (!isAdmin) q = q.eq('employee_id', employee.id);
    const { data } = await q;
    const rows = (data as DealRecord[]) || [];
    // Nested selects don't guarantee order — keep line items in sort_order.
    rows.forEach(r => { if (r.items) r.items.sort((a, b) => a.sort_order - b.sort_order); });
    setDeals(rows);
    setLoading(false);

    // Batch-fetch payment summaries for accepted deals so the list can show
    // a clickable Payment Status pill without extra round-trips per row.
    // Single query with IN() — no N+1. The DB view is the sole source of truth.
    setPaySummariesLoaded(false);
    // Fetch for EVERY listed deal, whatever its acceptance state. Payment is
    // independent of signing: an admin may record payment before the client
    // digitally accepts (out-of-reach clients who have paid), and a signing link
    // can expire — or a deal be rejected — after the money has already arrived.
    // Restricting this to accepted/pending/viewed dropped those deals from the
    // map, so the pill fell back to 'not_paid' and contradicted the payments
    // page, which reads the same view without any acceptance filter.
    const summaryIds = rows.map(r => r.id);
    if (summaryIds.length) {
      const { data: sums } = await supabase
        .from('nw_deal_payment_summary')
        .select('deal_id, payment_status, outstanding_amount')
        .in('deal_id', summaryIds);
      const map: Record<string, { payment_status: any; outstanding_amount: number }> = {};
      (sums ?? []).forEach((s: any) => { map[s.deal_id] = { payment_status: s.payment_status, outstanding_amount: Number(s.outstanding_amount) }; });
      setPaySummaries(map);
    } else {
      setPaySummaries({});
    }
    setPaySummariesLoaded(true);
  }, [isAdmin, employee.id]);

  useEffect(() => { loadDeals(); }, [loadDeals]);

  useEffect(() => {
    let q = supabase
      .from('nw_clients')
      .select('id, client_code, full_name, pan, phone, email, dp_name, demat_account, depository, bank_name, bank_account, bank_ifsc, address, city, state, pincode, employee_id')
      .order('full_name');
    if (!isAdmin) q = (q as any).eq('employee_id', employee.id);
    q.then(({ data }) => setClients((data as unknown as NWClient[]) || []));
  }, [isAdmin, employee.id]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (clientDropRef.current && !clientDropRef.current.contains(e.target as Node)) {
        setShowClientDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredClientOptions = clients.filter(c =>
    c.full_name.toLowerCase().includes(clientSearch.toLowerCase()) ||
    c.client_code.toLowerCase().includes(clientSearch.toLowerCase())
  );

  const openCreate = () => {
    setForm(emptyForm());
    setSelectedClient(null);
    setClientSearch('');
    setEditDeal(null);
    setError('');
    setView('form');
  };

  const openEdit = async (deal: DealRecord) => {
    // A deal that has already been booked into the ledger is edited/removed via
    // its transaction, not here — resetting its acceptance would strand the
    // executed transaction against a "pending" deal.
    const { data: bookedTxn } = await supabase
      .from('nw_transactions')
      .select('id')
      .eq('deal_confirmation_id', deal.id)
      .eq('transfer_stage', 'transferred')
      .limit(1);
    if (bookedTxn && bookedTxn.length) {
      showToast('This deal is already booked as a transaction. Edit or delete that transaction instead.', false);
      return;
    }
    // Non-admins cannot touch a signed/accepted deal; admins may (it resets to
    // pending for re-acceptance — see handleSave).
    if (deal.acceptance_status === 'accepted' && !isAdmin) {
      showToast('Accepted deals are locked. Create a new deal for corrections.', false);
      return;
    }
    setEditDeal(deal);
    // Build the line list from the deal's items; fall back to the header (a
    // legacy deal that somehow has no item rows) so editing never starts empty.
    const items = (deal.items && deal.items.length)
      ? [...deal.items].sort((a, b) => a.sort_order - b.sort_order)
      : [{
          product_type: deal.product_type, security_name: deal.security_name, isin: deal.isin,
          quantity: deal.quantity, base_rate: deal.base_rate ?? deal.rate_per_unit, rate_per_unit: deal.rate_per_unit,
        } as DealItemRecord];
    setForm({
      client_id: deal.client_id,
      deal_date: deal.deal_date,
      transaction_type: deal.transaction_type as 'Buy' | 'Sell',
      notes: deal.notes,
      lines: items.map(it => ({
        product_type: it.product_type,
        security_name: it.security_name,
        isin: it.isin,
        quantity: String(it.quantity),
        base_rate: String(it.base_rate ?? it.rate_per_unit),
        rate_per_unit: String(it.rate_per_unit),
        // Existing product shown locked; operator switches a line to manual to change it.
        manual: false,
      })),
    });
    const c = clients.find(c => c.id === deal.client_id);
    setSelectedClient(c || null);
    setClientSearch(c ? `${c.full_name} (${c.client_code})` : '');
    setError('');
    setView('form');
  };

  const selectClient = (c: NWClient) => {
    setSelectedClient(c);
    setForm(f => ({ ...f, client_id: c.id }));
    setClientSearch(`${c.full_name} (${c.client_code})`);
    setShowClientDrop(false);
  };

  const validate = (): boolean => {
    if (!form.client_id) { setError('Please select a client.'); return false; }
    if (!form.deal_date) { setError('Deal date is required.'); return false; }
    if (!form.transaction_type) { setError('Transaction type is required.'); return false; }
    if (!form.lines.length) { setError('Add at least one product.'); return false; }
    for (let i = 0; i < form.lines.length; i++) {
      const ln = form.lines[i];
      const n = form.lines.length > 1 ? ` (product ${i + 1})` : '';
      if (!ln.product_type.trim()) { setError(`Product type is required${n}.`); return false; }
      if (!ln.security_name.trim()) { setError(`Security / Company name is required${n}.`); return false; }
      if (!ln.isin.trim()) { setError(`ISIN number is required${n}.`); return false; }
      if (!ln.quantity || isNaN(parseFloat(ln.quantity)) || parseFloat(ln.quantity) <= 0) { setError(`Valid quantity is required${n}.`); return false; }
      if (!ln.base_rate || isNaN(parseFloat(ln.base_rate)) || parseFloat(ln.base_rate) <= 0) { setError(`Valid rate per unit is required${n}.`); return false; }
    }
    setError('');
    return true;
  };

  const handleSave = async (status: 'draft' | 'confirmed') => {
    if (!validate()) return;
    if (!selectedClient) return;
    setSaving(true);

    const addr = [selectedClient.address, selectedClient.city, selectedClient.state].filter(Boolean).join(', ');

    // The header mirrors the FIRST line (the DB recompute trigger re-affirms
    // this once items are written); its settlement_amount/stamp_duty become the
    // SUM of the line items. The line items are the source of truth.
    const first = form.lines[0];
    const payload: Record<string, any> = {
      client_id: form.client_id,
      // Own the deal by the client's relationship manager, not the logged-in
      // user. When an admin books a deal for another RM's client, stamping
      // employee.id here would hide the deal from that RM's CRM (the SELECT RLS
      // policy scopes non-admins to their own employee_id). Fall back to the
      // current user only if the client has no owner.
      employee_id: selectedClient.employee_id || employee.id,
      status,
      deal_date: form.deal_date,
      transaction_type: form.transaction_type,
      product_type: first.product_type,
      security_name: first.security_name.trim(),
      isin: first.isin.trim().toUpperCase(),
      quantity: parseFloat(first.quantity),
      base_rate: parseFloat(first.base_rate),
      rate_per_unit: parseFloat(first.rate_per_unit),
      // Snapshot columns are NOT NULL DEFAULT '' — coalesce so a client with no
      // demat (Mutual Funds / FD / Insurance) or any null field can't break the insert.
      snap_client_name: selectedClient.full_name || '',
      snap_pan: selectedClient.pan || '',
      snap_dp_name: selectedClient.dp_name || '',
      snap_demat_account: selectedClient.demat_account || '',
      snap_depository: selectedClient.depository || '',
      snap_bank_name: selectedClient.bank_name || '',
      snap_bank_account: selectedClient.bank_account || '',
      snap_bank_ifsc: selectedClient.bank_ifsc || '',
      snap_address: addr,
      snap_phone: selectedClient.phone || '',
      snap_email: selectedClient.email || '',
      notes: form.notes,
    };

    // One row per line. stamp_duty_rate is defaulted by the DB from product_type.
    const itemRows = (dealId: string) => form.lines.map((ln, idx) => ({
      deal_id: dealId,
      sort_order: idx,
      product_type: ln.product_type,
      security_name: ln.security_name.trim(),
      isin: ln.isin.trim().toUpperCase(),
      quantity: parseFloat(ln.quantity),
      base_rate: parseFloat(ln.base_rate),
      rate_per_unit: parseFloat(ln.rate_per_unit),
    }));

    if (editDeal) {
      const wasSigned = editDeal.acceptance_status === 'accepted';
      if (wasSigned && !isAdmin) {
        setSaving(false);
        setError('Accepted deals are locked and cannot be edited. Create a new deal confirmation.');
        return;
      }
      // Editing invalidates any outstanding secure link and resets the
      // acceptance lifecycle so the client must review the updated deal afresh.
      const wasSent = editDeal.email_status === 'sent' || !!editDeal.secure_token;
      payload.acceptance_status = 'pending';
      payload.secure_token = null;
      payload.token_expires_at = null;
      payload.viewed_at = null;
      payload.rejected_at = null;
      payload.rejection_reason = null;
      payload.email_status = 'pending';
      // An admin editing an already-signed deal fully unwinds the acceptance:
      // the stored signature/PDF no longer matches the amended terms, so it is
      // cleared and the client must re-accept.
      if (wasSigned) {
        payload.accepted_at = null;
        payload.signer_email = null;
        payload.signed_pdf_path = null;
      }

      // Reset the header to pending FIRST (so item RLS/guards permit the rewrite),
      // then replace the line items. The recompute trigger re-derives totals.
      const { error: err } = await supabase.from('nw_deal_confirmations').update(payload).eq('id', editDeal.id);
      if (err) { setSaving(false); setError(err.message); return; }
      const { error: delErr } = await supabase.from('nw_deal_confirmation_items').delete().eq('deal_id', editDeal.id);
      if (delErr) { setSaving(false); setError(delErr.message); return; }
      const { error: insErr } = await supabase.from('nw_deal_confirmation_items').insert(itemRows(editDeal.id) as Insertable<'nw_deal_confirmation_items'>[]);
      setSaving(false);
      if (insErr) { setError(insErr.message); return; }

      if (wasSigned) {
        await supabase.from('nw_deal_confirmation_events').insert([
          { deal_id: editDeal.id, event_type: 'edited', actor: 'employee' },
          { deal_id: editDeal.id, event_type: 'token_invalidated', actor: 'employee' },
        ]);
        showToast('Signed deal amended and reset to pending — the client must review and re-accept.');
      } else if (wasSent) {
        await supabase.from('nw_deal_confirmation_events').insert([
          { deal_id: editDeal.id, event_type: 'edited', actor: 'employee' },
          { deal_id: editDeal.id, event_type: 'token_invalidated', actor: 'employee' },
        ]);
        showToast('Deal updated. The old link is now invalid — resend to the client.');
      } else {
        showToast('Deal confirmation updated.');
      }
    } else {
      const confNum = await supabase.rpc('nw_generate_confirmation_number', { p_employee_id: employee.id });
      payload.confirmation_number = confNum.data || `DC-${Date.now()}`;
      const { data: created, error: err } = await supabase
        .from('nw_deal_confirmations')
        .insert([payload as Insertable<'nw_deal_confirmations'>])
        .select('id')
        .single();
      if (err || !created) { setSaving(false); setError(err?.message || 'Could not create the deal.'); return; }
      const { error: insErr } = await supabase
        .from('nw_deal_confirmation_items')
        .insert(itemRows(created.id) as Insertable<'nw_deal_confirmation_items'>[]);
      setSaving(false);
      if (insErr) {
        // Roll back the orphan header so a failed line insert doesn't leave a
        // zero-total deal behind.
        await supabase.from('nw_deal_confirmations').delete().eq('id', created.id);
        setError(insErr.message); return;
      }
      showToast(status === 'confirmed' ? 'Deal confirmation created.' : 'Draft saved.');
    }

    loadDeals();
    setView('list');
  };

  const handleDelete = async () => {
    if (!deleteDeal) return;
    // Full cascade (server-side, admin/owner-gated): removes the deal's
    // payments, any booked transaction + its holding + DSA coverage line, and
    // returns the deal to the Transfer Queue. Plain DELETE would be blocked by
    // the payment / transaction FK RESTRICTs.
    const { error: err } = await supabase.rpc('nw_delete_deal_cascade', { p_deal_id: deleteDeal.id });
    setDeleteDeal(null);
    if (err) { showToast(err.message || 'Could not delete deal.', false); return; }
    loadDeals();
    showToast('Deleted.');
  };

  // ---------- Send / Resend Secure Link ----------
  // The edge function mints the secure token + 7-day expiry, resets the deal to
  // 'pending', emails the link (no PDF attachment), and logs the event.
  const handleSendSecureLink = async (deal: DealRecord) => {
    if (emailSending) return;
    if (deal.acceptance_status === 'accepted') {
      showToast('Accepted deals are locked and cannot be resent.', false);
      return;
    }
    setEmailSending(true);
    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        'send-deal-confirmation-email',
        { body: { dealId: deal.id } }
      );
      if (fnError || !fnData?.success) {
        throw new Error(await edgeFunctionErrorMessage(fnError, fnData, 'Failed to send secure link'));
      }
      setPreviewDeal(prev =>
        prev && prev.id === deal.id
          ? { ...prev, email_status: 'sent', acceptance_status: 'pending', email_sent_at: new Date().toISOString() }
          : prev
      );
      await loadDeals();
      showToast(deal.email_status === 'sent' ? 'Updated secure link sent.' : 'Secure link sent to client.');
    } catch (err: any) {
      showToast(err?.message || 'Failed to send secure link', false);
    } finally {
      setEmailSending(false);
    }
  };

  // ---------- Download the stored signed PDF (accepted deals) ----------
  const handleDownloadSigned = async (deal: DealRecord) => {
    if (!deal.signed_pdf_path) { showToast('No signed document available yet.', false); return; }
    const { data, error: err } = await supabase
      .storage.from('deal-documents')
      .createSignedUrl(deal.signed_pdf_path, 120);
    if (err || !data?.signedUrl) { showToast('Could not open signed document.', false); return; }
    window.open(data.signedUrl, '_blank');

  };

  const filteredDeals = deals.filter(d =>
    !search ||
    d.confirmation_number.toLowerCase().includes(search.toLowerCase()) ||
    d.snap_client_name.toLowerCase().includes(search.toLowerCase()) ||
    d.security_name.toLowerCase().includes(search.toLowerCase())
  );

  // ===================== PAYMENTS ======================
  if (view === 'payments' && previewDeal) {
    return (
      <DealPayments
        deal={{
          id: previewDeal.id,
          client_id: previewDeal.client_id,
          // Drives the whole payment screen's direction: on a Sell the client
          // is the seller and Niyom pays THEM, so the ledger is a payout.
          transaction_type: previewDeal.transaction_type,
          confirmation_number: previewDeal.confirmation_number,
          snap_client_name: previewDeal.snap_client_name,
          snap_pan: previewDeal.snap_pan,
          snap_bank_name: previewDeal.snap_bank_name,
          settlement_amount: previewDeal.settlement_amount,
          employee_id: previewDeal.employee_id,
          deal_date: previewDeal.deal_date,
          security_name: previewDeal.security_name,
          isin: previewDeal.isin,
          quantity: previewDeal.quantity,
          rate_per_unit: previewDeal.rate_per_unit,
        }}
        employee={employee}
        // Correcting or cancelling a payment moves the deal's outstanding
        // balance, so refresh the list's summaries on the way out — otherwise
        // the Payment Status pill keeps showing the pre-correction state until
        // the whole page is reloaded.
        onBack={() => { setView('preview'); void loadDeals(); }}
      />
    );
  }

  // ===================== PREVIEW ======================
  if (view === 'preview' && previewDeal) {
    const pdfOpt = buildPdfOpts(previewDeal.confirmation_number, previewDeal.deal_date, 3);

    return (
      <div className="space-y-6">
        {/* Top Action Bar */}
        <div className="flex items-center gap-4 flex-wrap">
          <button onClick={() => setView('list')} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <ChevronLeft className="w-4 h-4" /> Back to List
          </button>
          <div className="flex-1" />
          {/* Download PDF */}
          <button
            onClick={() => {
              const element = document.getElementById('deal-confirmation-pdf-content');
              if (!element) return;
              html2pdf().set(pdfOpt).from(element).save();
            }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent"
            style={{ background: 'linear-gradient(135deg, var(--accent-strong), var(--accent-strong-deep))' }}
          >
            <Download className="w-4 h-4" /> Download PDF
          </button>
          {/* Email the deal confirmation to the client, and manage its payments. */}
          <button
            onClick={() => handleSendSecureLink(previewDeal)}
            disabled={emailSending}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent transition-all disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, var(--accent-strong), var(--accent-strong-deep))', opacity: emailSending ? 0.75 : 1 }}
          >
            {emailSending ? (
              <>
                <div className="w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                {previewDeal.email_status === 'sent' ? 'Resend Mail' : 'Send Mail'}
              </>
            )}
          </button>
          <button
            onClick={() => setView('payments')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
          >
            <Wallet className="w-4 h-4" /> Manage Payments
          </button>
        </div>

        {/* ===== Deal Note (shared 2-page A4 layout) ===== */}
        <DealDocument deal={previewDeal} />
      </div>
    );
  }

  // ===================== FORM ======================
  if (view === 'form') {
    return (
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center gap-3">
          <button onClick={() => setView('list')} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div>
            <p className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'var(--accent)' }}>Deal Confirmation</p>
            <h1 className="text-xl font-bold text-text-primary">{editDeal ? 'Edit Deal' : 'Create Deal Confirmation'}</h1>
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-2xl flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle className="w-4 h-4 text-c-red flex-shrink-0" />
            <p className="text-sm text-c-red">{error}</p>
          </div>
        )}

        {/* Client Selection */}
        <div className="rounded-2xl p-6 space-y-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Step 1 — Select Client</p>
          <div ref={clientDropRef} className="relative">
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              Client Code / Name <span style={{ color: 'var(--accent)' }}>*</span>
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-faint)' }} />
              <input
                value={clientSearch}
                onChange={e => { setClientSearch(e.target.value); setShowClientDrop(true); setSelectedClient(null); setForm(f => ({ ...f, client_id: '' })); }}
                onFocus={() => setShowClientDrop(true)}
                placeholder="Search by client name or code..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-text-primary outline-none"
                style={{ background: 'var(--bg-base)', border: `1px solid ${selectedClient ? 'var(--success)' : 'var(--border)'}` }}
              />
              {selectedClient && <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-c-emerald" />}
            </div>
            {showClientDrop && filteredClientOptions.length > 0 && (
              <div className="absolute z-20 w-full mt-1 rounded-xl overflow-hidden shadow-2xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', maxHeight: 220, overflowY: 'auto' }}>
                {filteredClientOptions.slice(0, 30).map(c => (
                  <button key={c.id} onClick={() => selectClient(c)}
                    className="w-full text-left px-4 py-3 text-sm transition-colors"
                    style={{ color: 'var(--text-primary)', borderBottom: '1px solid var(--bg-raised)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span className="font-mono text-xs mr-2" style={{ color: 'var(--accent)' }}>{c.client_code}</span>
                    {c.full_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Auto-filled client details */}
        {selectedClient && (
          <div className="rounded-2xl p-6 space-y-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            {/* On a SELL the client is the Seller (they sell to us); on a BUY
                they are the Buyer. Keep the heading truthful either way. */}
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
              {form.transaction_type === 'Sell' ? 'Seller Details (Auto-filled)' : 'Buyer Details (Auto-filled)'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ROField label="Client Name" value={selectedClient.full_name} />
              <ROField label="PAN Number" value={selectedClient.pan} />
              <ROField label="Mobile Number" value={selectedClient.phone} />
              <ROField label="Email ID" value={selectedClient.email} />
              <ROField label="DP Name" value={selectedClient.dp_name} />
              <ROField label="Demat Account" value={selectedClient.demat_account} />
              <ROField label="DP ID (First 8 digits)" value={selectedClient.demat_account?.slice(0, 8) || '—'} />
              <ROField label="Client ID (Last 8 digits)" value={selectedClient.demat_account?.slice(-8) || '—'} />
              <ROField label="Bank Name" value={selectedClient.bank_name} />
              <ROField label="Bank Account" value={selectedClient.bank_account} />
              <ROField label="IFSC Code" value={selectedClient.bank_ifsc} />
            </div>
            <ROField label="Address" value={[selectedClient.address, selectedClient.city, selectedClient.state].filter(Boolean).join(', ')} />
          </div>
        )}

        {/* Deal Details */}
        <div className="rounded-2xl p-6 space-y-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Step 2 — Deal Information</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Deal Date" required>
              <Input type="date" value={form.deal_date} onChange={e => setForm(f => ({ ...f, deal_date: e.target.value }))} />
            </Field>
            <Field label="Transaction Type" required hint="Applies to every product in this deal — a deal is all-buy or all-sell.">
              <div className="relative">
                <select value={form.transaction_type} onChange={e => setForm(f => ({ ...f, transaction_type: e.target.value as 'Buy' | 'Sell' }))}
                  className="w-full pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
                  style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
                  <option value="">Select type</option>
                  <option value="Buy">Client is Buying</option>
                  <option value="Sell">Client is Selling</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
              </div>
            </Field>
          </div>
        </div>

        {/* Security Details — one card per product line */}
        <div className="rounded-2xl p-6 space-y-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Step 3 — Products</p>
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{form.lines.length} product{form.lines.length !== 1 ? 's' : ''}</span>
          </div>

          {form.lines.map((ln, idx) => {
            const calc = lineCalc(ln);
            const unit = ln.product_type === 'Unlisted Share' ? 'Share' : 'Unit';
            return (
              <div key={`${editDeal?.id ?? 'new'}-${idx}`} className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Product {idx + 1}</p>
                  {form.lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(idx)}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg" style={{ color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.25)' }}>
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </button>
                  )}
                </div>

                {/* NSDL security lookup — auto-fills name + ISIN and derives + locks
                    this line's Product Type. "Can't find it" unlocks it. */}
                <SecuritySearch
                  key={`sec-${editDeal?.id ?? 'new'}-${idx}`}
                  valueName={ln.security_name}
                  valueIsin={ln.isin}
                  onSelect={sec => {
                    const derived = deriveProductType(sec.security_type);
                    updateLine(idx, {
                      security_name: sec.name,
                      isin: sec.isin,
                      manual: derived === '',
                      ...(derived
                        ? { product_type: derived, rate_per_unit: adjustRate(ln.base_rate, stampDutyRateFor(derived)) }
                        : {}),
                    });
                  }}
                  onManualToggle={manual => updateLine(idx, { manual })}
                  onManualChange={patch => updateLine(idx, {
                    ...(patch.security_name !== undefined ? { security_name: patch.security_name } : {}),
                    ...(patch.isin !== undefined ? { isin: patch.isin } : {}),
                  })}
                />

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Product Type" required hint={ln.manual ? undefined : 'Auto-set from the security'}>
                    <div className="relative">
                      <select value={ln.product_type}
                        disabled={!ln.manual}
                        onChange={e => updateLine(idx, { product_type: e.target.value, rate_per_unit: adjustRate(ln.base_rate, stampDutyRateFor(e.target.value)) })}
                        className="w-full pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none disabled:opacity-70 disabled:cursor-not-allowed"
                        style={{ background: ln.manual ? 'var(--bg-base)' : 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                        <option value="">{ln.manual ? 'Select product' : 'Pick a security first'}</option>
                        {PRODUCT_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      {ln.manual
                        ? <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
                        : <Lock className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-faint)' }} />}
                    </div>
                  </Field>
                  <Field label="Quantity" required>
                    <Input type="number" min="0" value={ln.quantity} onChange={e => updateLine(idx, { quantity: e.target.value })} placeholder="0" />
                  </Field>
                  <Field label={`Rate per ${unit} (₹)`} required hint="Adjusted after applicable charges.">
                    <Input
                      type="number" min="0" step="0.01"
                      value={ln.base_rate}
                      onChange={e => updateLine(idx, { base_rate: e.target.value, rate_per_unit: adjustRate(e.target.value, stampDutyRateFor(ln.product_type)) })}
                      placeholder="Enter base rate"
                    />
                    {ln.rate_per_unit && (
                      <p className="text-xs mt-1.5 font-semibold" style={{ color: 'var(--accent)' }}>
                        Adjusted: ₹{parseFloat(ln.rate_per_unit).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    )}
                  </Field>
                </div>

                {(calc.qty > 0 && calc.adjRate > 0) && (
                  <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs pt-1" style={{ color: 'var(--text-muted)' }}>
                    <span>Stamp Duty: <span className="font-semibold" style={{ color: 'var(--accent)' }}>{fmt(calc.stamp)}</span></span>
                    <span>Line Settlement: <span className="font-semibold" style={{ color: 'var(--success)' }}>{fmt(calc.settlement)}</span></span>
                  </div>
                )}
              </div>
            );
          })}

          <button type="button" onClick={addLine}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'rgba(var(--accent-rgb),0.08)', color: 'var(--accent)', border: '1px dashed rgba(var(--accent-rgb),0.4)' }}>
            <Plus className="w-4 h-4" /> Add another product
          </button>

          {/* Deal total across all lines */}
          {totalSettlement > 0 && (
            <div className="rounded-xl p-4 grid grid-cols-2 gap-4 mt-1" style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)' }}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint)' }}>Total Stamp Duty / Charges</p>
                <p className="text-lg font-black" style={{ color: 'var(--accent)' }}>{fmt(totalStampDuty)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint)' }}>Total Settlement Amount</p>
                <p className="text-lg font-black" style={{ color: 'var(--success)' }}>{fmt(totalSettlement)}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--border-stronger)' }}>Sum of all products (duty included)</p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => setView('list')} className="px-4 py-2.5 rounded-xl text-sm" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <div className="flex-1" />
          <button onClick={() => handleSave('draft')} disabled={saving}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: 'var(--bg-raised)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.3)' }}>
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <button onClick={() => handleSave('confirmed')} disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            <CheckCircle2 className="w-4 h-4" />
            {saving ? 'Saving...' : 'Confirm & Save'}
          </button>
        </div>
      </div>
    );
  }

  // ===================== LIST ======================
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Documents</p>
          <h1 className="text-2xl font-bold text-text-primary">Deal Confirmations</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Generate, preview and email deal confirmation notes</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
          <Plus className="w-4 h-4" /> Create Deal Confirmation
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl text-sm font-semibold transition-all ${toast.ok ? 'text-c-emerald' : 'text-c-red'}`}
          style={{ background: 'var(--bg-surface)', border: `1px solid ${toast.ok ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
          {toast.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: deals.length, color: 'var(--accent)' },
          { label: 'Fully Paid', value: deals.filter(d => ['fully_paid', 'over_paid'].includes(paySummaries[d.id]?.payment_status ?? 'not_paid')).length, color: 'var(--success)' },
          { label: 'Partially Paid', value: deals.filter(d => (paySummaries[d.id]?.payment_status ?? 'not_paid') === 'partially_paid').length, color: 'var(--warning)' },
          { label: 'Awaiting Payment', value: deals.filter(d => (paySummaries[d.id]?.payment_status ?? 'not_paid') === 'not_paid').length, color: 'rgb(var(--info-soft-rgb))' },
        ].map(s => (
          <div key={s.label} className="rounded-2xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>{s.label}</p>
            <p className="text-2xl font-black" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-faint)' }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by reference, client or security..."
          className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-text-primary outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        {loading ? (
          <div className="flex justify-center py-16">
            <LogoLoader size={48} />
          </div>
        ) : filteredDeals.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--border-strong)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--text-faint)' }}>No deal confirmations yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--border-strong)' }}>Click "Create Deal Confirmation" to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Reference', 'Client', 'Security', 'Type', 'Date', 'Settlement', 'Deal Status', 'Payment Status', ''].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredDeals.map(d => (
                  <tr key={d.id} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-mono font-bold" style={{ color: 'var(--accent)' }}>{d.confirmation_number}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-text-primary">{d.snap_client_name}</p>
                      <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{(d.client as any)?.client_code}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-text-primary">{d.security_name}</p>
                      {d.items && d.items.length > 1 ? (
                        <p className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>+{d.items.length - 1} more product{d.items.length - 1 !== 1 ? 's' : ''}</p>
                      ) : (
                        <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{d.isin}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-bold px-2 py-1 rounded-lg ${d.transaction_type === 'Buy' ? 'text-c-emerald bg-emerald-900/20' : 'text-c-red bg-red-900/20'}`}>
                        {d.transaction_type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{fmtDate(d.deal_date)}</td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-bold text-text-primary">{fmt(d.settlement_amount || 0)}</p>
                      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Qty: {d.quantity?.toLocaleString('en-IN')}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${d.status === 'confirmed' ? 'text-c-emerald bg-emerald-900/20' : 'text-c-amber bg-amber-900/20'}`}>
                        {d.status === 'confirmed' ? 'Confirmed' : 'Draft'}
                      </span>
                      {/*
                        Whether the CLIENT has accepted, which is a different
                        question from whether we confirmed the deal. It drives
                        real behaviour already — an accepted deal cannot be
                        edited by a non-admin, and re-sending resets it — but
                        until now it was invisible, so an RM had no way to see
                        that a client had signed short of opening the record.
                      */}
                      {d.email_status === 'sent' && (
                        <div className="mt-1">
                          <AcceptanceBadge status={d.acceptance_status} />
                        </div>
                      )}
                    </td>
                    {/* Payment Status — derived from nw_deal_payment_summary.
                        Clicking navigates to Manage Payments to reduce clicks. */}
                    <td className="px-5 py-3.5">
                      {!paySummariesLoaded ? (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wider"
                          style={{ background: 'rgba(107,107,107,0.10)', color: 'var(--text-faint)', border: '1px solid rgba(107,107,107,0.20)' }}
                        >
                          Loading…
                        </span>
                      ) : (
                        <PaymentStatusPill
                          summary={paySummaries[d.id]}
                          transactionType={d.transaction_type}
                          onClick={() => { setPreviewDeal(d); setView('payments'); }}
                        />
                      )}
                    </td>
                    {/* Actions */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => { setPreviewDeal(d); setView('preview'); }}
                          className="p-1.5 rounded-lg transition-colors" title="Preview"
                          style={{ color: 'var(--text-faint)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}>
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleSendSecureLink(d)}
                          disabled={emailSending}
                          className="p-1.5 rounded-lg transition-colors disabled:opacity-40"
                          title={d.email_status === 'sent' ? 'Resend mail' : 'Send mail'}
                          style={{ color: 'var(--text-faint)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}>
                          <Send className="w-4 h-4" />
                        </button>
                        {/*
                          The signed copy. handleDownloadSigned existed with
                          nothing calling it, so a deal the client had signed
                          stored a PDF that could not be opened from anywhere in
                          the CRM. Shown only when there is one to open.
                        */}
                        {d.signed_pdf_path && (
                          <button
                            onClick={() => void handleDownloadSigned(d)}
                            className="p-1.5 rounded-lg transition-colors" title="Open signed copy"
                            style={{ color: 'var(--text-faint)' }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--success)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}>
                            <Download className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(d)}
                          className="p-1.5 rounded-lg transition-colors" title="Edit"
                          style={{ color: 'var(--text-faint)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'rgb(var(--info-soft-rgb))')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}>
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteDeal(d)}
                          className="p-1.5 rounded-lg transition-colors" title="Delete"
                          style={{ color: 'var(--text-faint)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}>
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete confirm modal */}
      {deleteDeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(239,68,68,0.1)' }}>
                <Trash2 className="w-5 h-5 text-c-red" />
              </div>
              <div>
                <p className="text-sm font-bold text-text-primary">Delete Deal Confirmation</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{deleteDeal.confirmation_number}</p>
              </div>
            </div>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              This permanently deletes the deal along with any recorded payments, its booked
              transaction and that transaction's portfolio holding. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteDeal(null)} className="flex-1 py-2.5 rounded-xl text-sm" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
              <button onClick={handleDelete} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white" style={{ background: 'var(--danger)' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

