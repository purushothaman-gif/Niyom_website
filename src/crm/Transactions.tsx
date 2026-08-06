import { useEffect, useState, useCallback } from 'react';
import { LogoLoader } from '../components/LogoLoader';
import { supabase } from '../lib/supabase';
import { NWEmployee, NWTransaction, NWClient, ProductType } from './types';
import { fmt, fmtDate, PRODUCT_LABELS, PRODUCT_COLORS, TXN_LABELS, TXN_COLORS } from './utils';
import { Plus, X, Pencil, Trash2, FileText, ExternalLink, Search, ChevronDown, ChevronRight, Percent, TrendingUp, Shield } from 'lucide-react';

interface Props { employee: NWEmployee; onNavigate?: (page: string, params?: Record<string, string>) => void; }

const PRODUCTS: ProductType[] = ['unlisted_share', 'secondary_bond', 'primary_bond', 'mutual_fund', 'fixed_deposit', 'insurance'];
const TXN_TYPES = ['buy', 'sell'];

// ---------------------------------------------------------------------------
// Book-from-deal
// ---------------------------------------------------------------------------
// A confirmed deal already carries the client, instrument, quantity and rate.
// Picking one here pre-fills those and links the saved transaction back to the
// deal (deal_confirmation_id + transfer_stage), which is the same link the
// Transfer Queue uses — so a deal booked here drops out of that queue and can
// never be booked twice. Only the revenue basis (landing cost / DSA landing)
// is left for the operator to type.

interface EligibleDeal {
  deal_id: string;
  confirmation_number: string;
  client_id: string;
  snap_client_name: string;
  product_type: string;      // deal-side label, e.g. 'Unlisted Share'
  transaction_type: string;  // 'Buy' | 'Sell'
  security_name: string;
  isin: string | null;
  deal_date: string;
  quantity: number | null;
  settlement_amount: number | null;
  landing_cost: number | null;
  base_rate?: number | null; // merged in — not exposed by the view
}

// Deal product labels are the exact values of PRODUCT_LABELS, so invert it
// rather than maintaining a second mapping. 'Other' has no transaction
// equivalent and is intentionally unmapped.
const DEAL_PRODUCT_TO_TYPE: Record<string, ProductType> = Object.fromEntries(
  (Object.entries(PRODUCT_LABELS) as [ProductType, string][]).map(([k, v]) => [v.toLowerCase(), k])
) as Record<string, ProductType>;
const BOND_TYPES: ProductType[] = ['secondary_bond', 'primary_bond', 'fixed_deposit'];
const PAYOUT_FREQ: Record<string, string> = { annual: 'Annual', halfyearly: 'Half-Yearly', quarterly: 'Quarterly', monthly: 'Monthly' };
const PAYOUT_DIVISORS: Record<string, number> = { annual: 1, halfyearly: 2, quarterly: 4, monthly: 12 };

// S6: Smart payout date label/hint based on frequency
function payoutDateLabel(freq: string): { label: string; placeholder: string; hint: string } {
  switch (freq) {
    case 'monthly': return { label: 'Payout Day (DD)', placeholder: 'e.g. 15', hint: 'Day of month (1–31). Next dates auto-calculated.' };
    case 'quarterly': return { label: 'Payout Day/Month (DD/MM)', placeholder: 'e.g. 15/03', hint: 'First quarterly payout. Remaining auto-calculated.' };
    case 'halfyearly': return { label: 'Payout Day/Month (DD/MM)', placeholder: 'e.g. 15/03', hint: 'First half-yearly payout. Second auto-calculated.' };
    default: return { label: 'Payout Day/Month (DD/MM)', placeholder: 'e.g. 15/03', hint: 'Annual payout day/month. Year auto-updates.' };
  }
}

function getNextPayouts(payoutDateStr: string, freq: string, count = 3): string[] {
  if (!payoutDateStr) return [];
  const today = new Date();
  const dates: string[] = [];
  try {
    if (freq === 'monthly') {
      const day = parseInt(payoutDateStr);
      if (isNaN(day) || day < 1 || day > 31) return [];
      for (let i = 0; dates.length < count && i < count + 2; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, day);
        if (d >= today) dates.push(d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
      }
    } else {
      const parts = payoutDateStr.split('/');
      if (parts.length < 2) return [];
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      if (isNaN(day) || isNaN(month)) return [];
      const intervalMonths = PAYOUT_DIVISORS[freq] ? 12 / PAYOUT_DIVISORS[freq] : 12;
      let d = new Date(today.getFullYear(), month, day);
      if (d < today) d = new Date(today.getFullYear() + 1, month, day);
      for (let i = 0; dates.length < count && i < count * 4; i++) {
        dates.push(d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
        d = new Date(d.getFullYear(), d.getMonth() + intervalMonths, d.getDate());
      }
    }
  } catch { return []; }
  return dates.slice(0, count);
}
const SCHEME_TYPES: Record<string, string> = { equity: 'Equity', debt: 'Debt', hybrid: 'Hybrid', index: 'Index Fund', elss: 'ELSS (Tax Saving)', liquid: 'Liquid', others: 'Others' };
const INS_TYPES: Record<string, string> = { term: 'Term Insurance', ulip: 'ULIP', traditional: 'Traditional Insurance', medical: 'Medical Insurance', vehicle: 'Vehicle Insurance' };
const PREM_FREQ: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', halfyearly: 'Half-Yearly', annual: 'Annual', single: 'Single Premium' };

function calcPayout(fv: number, rate: number, qty: number, freq: string) {
  return (fv * (rate / 100) * qty) / (PAYOUT_DIVISORS[freq] || 1);
}

function patternToNextISODate(pattern: string, freq: string): string | null {
  if (!pattern) return null;
  try {
    const today = new Date();
    if (freq === 'monthly') {
      const day = parseInt(pattern);
      if (isNaN(day) || day < 1 || day > 31) return null;
      let d = new Date(today.getFullYear(), today.getMonth(), day);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, day);
      return d.toISOString().split('T')[0];
    } else {
      const parts = pattern.split('/');
      if (parts.length < 2) return null;
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      if (isNaN(day) || isNaN(month) || month < 0 || month > 11) return null;
      let d = new Date(today.getFullYear(), month, day);
      if (d < today) d = new Date(today.getFullYear() + 1, month, day);
      return d.toISOString().split('T')[0];
    }
  } catch { return null; }
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)' }}>
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden max-h-[92vh] flex flex-col" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="px-6 py-4 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-bold text-text-primary">{title}</h3>
          <button onClick={onClose} style={{ color: 'var(--text-faint)' }}><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

const iS = { background: 'var(--bg-base)', border: '1px solid var(--border)' };
const iC = "w-full px-3 py-2.5 rounded-xl text-sm text-text-primary outline-none transition-all";

function Field({ label, children, span2 }: { label: string; children: React.ReactNode; span2?: boolean }) {
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
    </div>
  );
}
function I(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={iC} style={{ ...iS, ...(p.style || {}) }} />;
}
function S({ value, onChange, children, disabled }: { value: string; onChange: (v: string) => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
      className={iC} style={{ ...iS, ...(disabled ? { opacity: 0.65, cursor: 'not-allowed' } : null) }}>
      {children}
    </select>
  );
}
function SecHead({ icon: Icon, label, color }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; label: string; color: string }) {
  return (
    <div className="col-span-2 flex items-center gap-2 pt-1">
      <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
        <Icon className="w-3.5 h-3.5" style={{ color }} />
      </div>
      <p className="text-xs font-bold uppercase tracking-widest" style={{ color }}>{label}</p>
      <div className="flex-1 h-px" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }} />
    </div>
  );
}

const DSA_PRICE_TYPES: ProductType[] = ['unlisted_share', 'secondary_bond', 'primary_bond'];

interface TxnForm {
  client_id: string; txn_type: string; product_type: ProductType;
  product_name: string; quantity: string; per_unit_price: string;
  consolidated_amount: string; txn_date: string; notes: string;
  dsa_price: string; client_price: string;
  landing_cost: string; insurance_revenue: string; trail_percent: string; trail_start_date: string;
  isin: string; face_value: string; coupon_rate: string; interest_payout_date: string;
  payout_frequency: string; issuer_name: string;
  folio_number: string; fund_house: string; scheme_type: string; nav_date: string; purchase_nav: string;
  policy_number: string; insurance_type: string; insurer_name: string;
  sum_assured: string; premium_amount: string; premium_frequency: string;
}

const emptyForm = (): TxnForm => ({
  client_id: '', txn_type: 'buy', product_type: 'unlisted_share',
  product_name: '', quantity: '', per_unit_price: '', consolidated_amount: '',
  txn_date: new Date().toISOString().split('T')[0], notes: '',
  dsa_price: '', client_price: '',
  landing_cost: '', insurance_revenue: '', trail_percent: '', trail_start_date: '',
  isin: '', face_value: '', coupon_rate: '', interest_payout_date: '', payout_frequency: 'annual', issuer_name: '',
  folio_number: '', fund_house: '', scheme_type: 'equity', nav_date: '', purchase_nav: '',
  policy_number: '', insurance_type: 'term', insurer_name: '', sum_assured: '', premium_amount: '', premium_frequency: 'annual',
});

// Upsert holding in portfolio when a new transaction is saved
async function syncTransactionToHolding(txn: Record<string, any>) {
  if (txn.txn_type !== 'buy') return; // only sync buy transactions

  const qty = txn.quantity || 0;
  const price = txn.per_unit_price || (txn.purchase_nav) || 0;
  // Secondary Bonds: the client's invested amount is client_price × qty. consolidated_amount
  // carries the firm's acquisition/landing total, so use client_price when present. All other
  // product types are unchanged.
  const amount = (txn.product_type === 'secondary_bond' && txn.client_price)
    ? (txn.client_price * qty)
    : (txn.consolidated_amount || 0);

  // Find existing holding for same client + product_name + product_type
  const { data: existing } = await supabase
    .from('nw_holdings')
    .select('*')
    .eq('client_id', txn.client_id)
    .eq('product_name', txn.product_name)
    .eq('product_type', txn.product_type)
    .maybeSingle();

  if (existing) {
    // Weighted avg cost update
    const newQty = (existing.quantity || 0) + qty;
    const newInvested = (existing.invested_amount || 0) + amount;
    const newAvgCost = newQty > 0 ? newInvested / newQty : price;
    await supabase.from('nw_holdings').update({
      quantity: newQty,
      avg_cost: newAvgCost,
      invested_amount: newInvested,
      current_value: newInvested, // default current = invested until updated manually
      isin: txn.isin || existing.isin || null,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id);
  } else {
    // Create new holding
    const holdingPayload: Record<string, any> = {
      client_id: txn.client_id,
      product_type: txn.product_type,
      product_name: txn.product_name,
      txn_date: txn.txn_date,
      isin: txn.isin || null,
      quantity: qty,
      avg_cost: price,
      invested_amount: amount,
      current_value: amount,
      notes: txn.notes || '',
      landing_cost: txn.landing_cost || null,
      dsa_price: txn.dsa_price || null,
      client_price: txn.client_price || null,
    };
    if (txn.product_type === 'mutual_fund') {
      Object.assign(holdingPayload, {
        folio_number: txn.folio_number || null,
        fund_house: txn.fund_house || null,
        scheme_type: txn.scheme_type || null,
        nav_date: txn.nav_date || null,
        purchase_nav: txn.purchase_nav || null,
        current_nav: txn.purchase_nav || null,
        trail_percent: txn.trail_percent || null,
        trail_start_date: txn.trail_start_date || null,
      });
    }
    if (['secondary_bond', 'primary_bond', 'fixed_deposit'].includes(txn.product_type)) {
      Object.assign(holdingPayload, {
        face_value: txn.face_value || null,
        coupon_rate: txn.coupon_rate || null,
        payout_date_pattern: txn.payout_date_pattern || null,
        interest_payout_date: txn.interest_payout_date || null,
        payout_frequency: txn.payout_frequency || 'annual',
        issuer_name: txn.issuer_name || null,
        maturity_date: txn.maturity_date || null,
      });
    }
    if (txn.product_type === 'insurance') {
      Object.assign(holdingPayload, {
        policy_number: txn.policy_number || null,
        insurance_type: txn.insurance_type || null,
        insurer_name: txn.insurer_name || null,
        sum_assured: txn.sum_assured || null,
        premium_amount: txn.premium_amount || null,
        premium_frequency: txn.premium_frequency || 'annual',
        insurance_revenue: txn.insurance_revenue || null,
      });
    }
    await supabase.from('nw_holdings').insert([holdingPayload]);
  }

  // Recalculate portfolio_value for client
  const { data: allHoldings } = await supabase.from('nw_holdings').select('current_value').eq('client_id', txn.client_id);
  const total = (allHoldings || []).reduce((s: number, h: any) => s + (h.current_value || 0), 0);
  await supabase.from('nw_clients').update({ portfolio_value: total }).eq('id', txn.client_id);
}

// Reverse a previously-synced BUY transaction out of its holding. The inverse of
// syncTransactionToHolding: it subtracts this transaction's quantity/amount from
// the matched holding (deleting the holding if nothing is left) and recomputes
// the client's portfolio_value. Returns true if a holding was found and
// adjusted — the caller uses that to decide whether to re-apply new values on an
// edit (transactions that never produced a holding, e.g. sells or Transfer-Queue
// bookings, must not spawn a new one). Mirrors nw_unwind_txn_holding() in SQL.
async function reverseTransactionFromHolding(txn: Record<string, any>): Promise<boolean> {
  if (txn.txn_type !== 'buy') return false;

  const qty = txn.quantity || 0;
  const amount = (txn.product_type === 'secondary_bond' && txn.client_price)
    ? (txn.client_price * qty)
    : (txn.consolidated_amount || 0);

  const { data: existing } = await supabase
    .from('nw_holdings')
    .select('*')
    .eq('client_id', txn.client_id)
    .eq('product_name', txn.product_name)
    .eq('product_type', txn.product_type)
    .maybeSingle();

  if (!existing) return false;

  const newQty = (existing.quantity || 0) - qty;
  const newInvested = (existing.invested_amount || 0) - amount;

  if (newQty <= 0 || newInvested <= 0) {
    await supabase.from('nw_holdings').delete().eq('id', existing.id);
  } else {
    await supabase.from('nw_holdings').update({
      quantity: newQty,
      invested_amount: newInvested,
      avg_cost: newInvested / newQty,
      current_value: newInvested,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id);
  }

  const { data: allHoldings } = await supabase.from('nw_holdings').select('current_value').eq('client_id', txn.client_id);
  const total = (allHoldings || []).reduce((s: number, h: any) => s + (h.current_value || 0), 0);
  await supabase.from('nw_clients').update({ portfolio_value: total }).eq('id', txn.client_id);
  return true;
}

// Look up the holding a transaction would net against (same client + product).
// Used before booking a SELL to decide whether to offer a holding reduction.
async function findMatchingHolding(txn: Record<string, any>) {
  const { data } = await supabase
    .from('nw_holdings')
    .select('*')
    .eq('client_id', txn.client_id)
    .eq('product_name', txn.product_name)
    .eq('product_type', txn.product_type)
    .maybeSingle();
  return data || null;
}

// Reduce a client's holding when they SELL shares/bonds back to us (disposal).
// Unlike a buy, a sell removes units from the portfolio: subtract the sold
// quantity and its cost basis (avg_cost × soldQty) so the remaining avg_cost is
// preserved; delete the holding when nothing is left. Recomputes portfolio_value.
// Only ever called after the operator approves (approval-if-held per the spec).
async function reduceHoldingForSell(txn: Record<string, any>) {
  const soldQty = txn.quantity || 0;
  const existing = await findMatchingHolding(txn);
  if (!existing || soldQty <= 0) return;

  const avgCost = existing.avg_cost
    || (existing.quantity ? (existing.invested_amount || 0) / existing.quantity : 0);
  const newQty = (existing.quantity || 0) - soldQty;

  if (newQty <= 0) {
    await supabase.from('nw_holdings').delete().eq('id', existing.id);
  } else {
    const newInvested = avgCost * newQty;
    await supabase.from('nw_holdings').update({
      quantity: newQty,
      invested_amount: newInvested,
      avg_cost: avgCost,
      current_value: newInvested,
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id);
  }

  const { data: allHoldings } = await supabase.from('nw_holdings').select('current_value').eq('client_id', txn.client_id);
  const total = (allHoldings || []).reduce((s: number, h: any) => s + (h.current_value || 0), 0);
  await supabase.from('nw_clients').update({ portfolio_value: total }).eq('id', txn.client_id);
}

export default function Transactions({ employee, onNavigate }: Props) {
  const [txns, setTxns] = useState<NWTransaction[]>([]);
  const [clients, setClients] = useState<NWClient[]>([]);
  const [empList, setEmpList] = useState<{ id: string; full_name: string; employee_code: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [empFilter, setEmpFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editTxn, setEditTxn] = useState<NWTransaction | null>(null);
  const [deleteTxn, setDeleteTxn] = useState<NWTransaction | null>(null);
  const [viewTxn, setViewTxn] = useState<NWTransaction | null>(null);
  const [form, setForm] = useState<TxnForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // SELL disposal approval — when booking a sell for a client who already holds
  // the security, we ask the operator whether to reduce the portfolio holding.
  const [sellApproval, setSellApproval] = useState<{ payload: Record<string, any>; holding: any } | null>(null);

  // Book-from-deal picker
  const [eligibleDeals, setEligibleDeals] = useState<EligibleDeal[]>([]);
  const [dealSearch, setDealSearch] = useState('');
  const [showDealDrop, setShowDealDrop] = useState(false);
  const [pickedDeal, setPickedDeal] = useState<EligibleDeal | null>(null);

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';

  const loadTxns = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('nw_transactions')
      .select('*, client:nw_clients(full_name, client_code, employee_id), employee:nw_employees!nw_transactions_employee_id_fkey(full_name, employee_code), documents:nw_txn_documents(*)')
      .order('txn_date', { ascending: false });
    if (typeFilter !== 'all') query = query.eq('txn_type', typeFilter);
    if (productFilter !== 'all') query = query.eq('product_type', productFilter);
    const { data } = await query;
    let list = (data as NWTransaction[]) || [];
    if (search) list = list.filter(t => t.product_name.toLowerCase().includes(search.toLowerCase()) || (t.client as any)?.full_name?.toLowerCase().includes(search.toLowerCase()));
    if (!isAdmin) {
      list = list.filter(t => (t.client as any)?.employee_id === employee.id);
    } else if (empFilter !== 'all') {
      list = list.filter(t => (t.client as any)?.employee_id === empFilter);
    }
    setTxns(list);
    setLoading(false);
  }, [typeFilter, productFilter, empFilter, search, isAdmin, employee.id]);

  useEffect(() => {
    supabase.from('nw_clients').select('id, full_name, client_code, sourced_via, dsa_id, employee_id').then(({ data }) => setClients((data as NWClient[]) || []));
    if (isAdmin) {
      supabase.from('nw_employees').select('id, full_name, employee_code').eq('status', 'active').order('full_name')
        .then(({ data }) => setEmpList((data as any[]) || []));
    }
  }, [isAdmin]);
  useEffect(() => { loadTxns(); }, [loadTxns]);

  // Deals ready to be booked: accepted + fully paid + not already booked.
  // nw_deal_transfer_eligible already encodes exactly that predicate, so reuse
  // it rather than restating the rule here. It does not expose base_rate, so
  // that is merged in from the deals table in a second read.
  const loadEligibleDeals = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('nw_deal_transfer_eligible')
      .select('deal_id, confirmation_number, client_id, snap_client_name, product_type, transaction_type, security_name, isin, deal_date, quantity, settlement_amount, landing_cost');
    if (e || !data?.length) { setEligibleDeals([]); return; }
    const deals = data as EligibleDeal[];
    const { data: rates } = await supabase
      .from('nw_deal_confirmations')
      .select('id, base_rate')
      .in('id', deals.map(d => d.deal_id));
    const rateById = new Map((rates ?? []).map((r: any) => [r.id, r.base_rate]));
    setEligibleDeals(deals.map(d => ({ ...d, base_rate: rateById.get(d.deal_id) ?? null })));
  }, []);

  useEffect(() => { if (showAdd) loadEligibleDeals(); }, [showAdd, loadEligibleDeals]);

  const isBond = BOND_TYPES.includes(form.product_type);
  const isMF = form.product_type === 'mutual_fund';
  const isIns = form.product_type === 'insurance';

  const setF = (k: keyof TxnForm, v: any) => {
    setForm(prev => {
      const next = { ...prev, [k]: v };
      // Client Price defaults to the same value as Per Unit Price. Keep mirroring
      // until the operator manually diverges the client price from the unit price.
      if (k === 'per_unit_price' && (prev.client_price === '' || prev.client_price === prev.per_unit_price)) {
        next.client_price = v;
      }
      const qty = parseFloat(next.quantity) || 0;
      if (next.product_type === 'unlisted_share') {
        const price = parseFloat(next.per_unit_price) || 0;
        if (qty > 0 && price > 0) next.consolidated_amount = (qty * price).toFixed(2);
      } else if (next.product_type === 'mutual_fund') {
        const nav = parseFloat(next.purchase_nav) || 0;
        if (qty > 0 && nav > 0) next.consolidated_amount = (qty * nav).toFixed(2);
      } else if (BOND_TYPES.includes(next.product_type)) {
        const price = parseFloat(next.per_unit_price) || parseFloat(next.face_value) || 0;
        if (qty > 0 && price > 0) next.consolidated_amount = (qty * price).toFixed(2);
      }
      return next;
    });
  };

  // Pre-fill the form from a confirmed deal. Everything the deal already
  // states is copied and then locked; the operator only supplies the revenue
  // basis. per_unit_price takes the deal's BASE rate (the raw rate the RM
  // entered) — that matches how this desk actually books business.
  const selectDeal = (d: EligibleDeal) => {
    const mapped = DEAL_PRODUCT_TO_TYPE[(d.product_type || '').trim().toLowerCase()];
    if (!mapped) {
      setError(`Deal ${d.confirmation_number} is product type "${d.product_type}", which has no matching business product. Book it manually.`);
      return;
    }
    const qty = d.quantity != null ? String(d.quantity) : '';
    const rate = d.base_rate != null ? String(d.base_rate) : '';
    setPickedDeal(d);
    setDealSearch(`${d.confirmation_number} — ${d.snap_client_name}`);
    setShowDealDrop(false);
    setError('');
    setForm(prev => ({
      ...prev,
      client_id: d.client_id,
      txn_type: (d.transaction_type || 'Buy').toLowerCase() === 'sell' ? 'sell' : 'buy',
      product_type: mapped,
      product_name: d.security_name || '',
      isin: d.isin || '',
      quantity: qty,
      per_unit_price: rate,
      txn_date: d.deal_date || prev.txn_date,
      // Trust the deal's settlement figure rather than recomputing qty × rate:
      // the signed note is the source of truth for what the client owed.
      consolidated_amount: d.settlement_amount != null ? String(d.settlement_amount) : '',
      landing_cost: d.landing_cost != null ? String(d.landing_cost) : prev.landing_cost,
    }));
  };

  const clearPickedDeal = () => {
    setPickedDeal(null);
    setDealSearch('');
    setForm(emptyForm());
    setError('');
  };

  const dealOptions = eligibleDeals.filter(d => {
    const q = dealSearch.trim().toLowerCase();
    if (!q || pickedDeal) return true;
    return [d.confirmation_number, d.snap_client_name, d.security_name, d.isin]
      .some(v => (v || '').toString().toLowerCase().includes(q));
  });

  const interest = (() => {
    if (!isBond) return null;
    const fv = parseFloat(form.face_value) || 0;
    const rate = parseFloat(form.coupon_rate) || 0;
    const qty = parseFloat(form.quantity) || 0;
    if (!fv || !rate || !qty) return null;
    return { perPeriod: calcPayout(fv, rate, qty, form.payout_frequency), annual: fv * (rate / 100) * qty };
  })();

  const openAdd = () => {
    setForm(emptyForm()); setError('');
    setPickedDeal(null); setDealSearch(''); setShowDealDrop(false);
    setShowAdd(true);
  };
  const openEdit = (t: NWTransaction) => {
    setForm({
      client_id: t.client_id, txn_type: t.txn_type, product_type: t.product_type,
      product_name: t.product_name, quantity: t.quantity?.toString() || '',
      per_unit_price: t.per_unit_price?.toString() || '',
      consolidated_amount: t.consolidated_amount.toString(),
      txn_date: t.txn_date, notes: t.notes || '',
      dsa_price: (t as any).dsa_price?.toString() || '', client_price: (t as any).client_price?.toString() || '',
      landing_cost: (t as any).landing_cost?.toString() || '', insurance_revenue: (t as any).insurance_revenue?.toString() || '',
      trail_percent: (t as any).trail_percent?.toString() || '', trail_start_date: (t as any).trail_start_date || '',
      isin: (t as any).isin || '',
      face_value: t.face_value?.toString() || '', coupon_rate: t.coupon_rate?.toString() || '',
      interest_payout_date: (t as any).payout_date_pattern || '', payout_frequency: t.payout_frequency || 'annual', issuer_name: t.issuer_name || '',
      folio_number: t.folio_number || '', fund_house: t.fund_house || '', scheme_type: t.scheme_type || 'equity',
      nav_date: t.nav_date || '', purchase_nav: t.purchase_nav?.toString() || '',
      policy_number: t.policy_number || '', insurance_type: t.insurance_type || 'term', insurer_name: t.insurer_name || '',
      sum_assured: t.sum_assured?.toString() || '', premium_amount: t.premium_amount?.toString() || '', premium_frequency: t.premium_frequency || 'annual',
    });
    setError(''); setEditTxn(t);
  };

  const handleSave = async () => {
    if (!form.client_id) { setError('Please select a client.'); return; }
    if (!form.product_name.trim()) { setError('Product name is required.'); return; }
    if (!form.consolidated_amount || parseFloat(form.consolidated_amount) <= 0) { setError('Amount is required.'); return; }
    if (isIns && !form.policy_number.trim()) { setError('Policy number is required.'); return; }
    // Landing cost drives MIS revenue for unlisted shares & bonds — require it so
    // MIS never shows the whole settlement as profit.
    if (['unlisted_share', 'secondary_bond', 'primary_bond'].includes(form.product_type)
        && (form.landing_cost === '' || form.landing_cost == null)) {
      setError('Landing cost per unit is required — it determines the MIS revenue for this business.');
      return;
    }
    setError(''); setSaving(true);

    const selectedClient = clients.find(c => c.id === form.client_id);
    const isClientDSA = selectedClient?.sourced_via === 'dsa';
    const isDSAPriceType = DSA_PRICE_TYPES.includes(form.product_type);

    const payload: Record<string, any> = {
      client_id: form.client_id, employee_id: employee.id, txn_type: form.txn_type,
      product_type: form.product_type, product_name: form.product_name.trim(),
      quantity: form.quantity ? parseFloat(form.quantity) : null,
      per_unit_price: form.per_unit_price ? parseFloat(form.per_unit_price) : null,
      consolidated_amount: parseFloat(form.consolidated_amount),
      txn_date: form.txn_date, notes: form.notes,
      isin: (form.product_type === 'unlisted_share' || isBond) ? (form.isin.trim().toUpperCase() || null) : null,
    };

    if (isClientDSA && isDSAPriceType) {
      Object.assign(payload, {
        dsa_price: form.dsa_price ? parseFloat(form.dsa_price) : null,
        client_price: form.client_price ? parseFloat(form.client_price) : null,
      });
    }
    const isLandingCostType = ['unlisted_share', 'secondary_bond', 'primary_bond'].includes(form.product_type);
    if (isLandingCostType) {
      Object.assign(payload, { landing_cost: form.landing_cost ? parseFloat(form.landing_cost) : null });
    }
    if (isMF) {
      Object.assign(payload, {
        trail_percent: form.trail_percent ? parseFloat(form.trail_percent) : null,
        trail_start_date: form.trail_start_date || null,
      });
    }
    if (isIns) {
      Object.assign(payload, { insurance_revenue: form.insurance_revenue ? parseFloat(form.insurance_revenue) : null });
    }
    if (isBond) Object.assign(payload, {
      isin: form.isin || null,
      face_value: form.face_value ? parseFloat(form.face_value) : null,
      coupon_rate: form.coupon_rate ? parseFloat(form.coupon_rate) : null,
      payout_date_pattern: form.interest_payout_date || null,
      interest_payout_date: patternToNextISODate(form.interest_payout_date, form.payout_frequency),
      payout_frequency: form.payout_frequency, issuer_name: form.issuer_name,
    });
    if (isMF) Object.assign(payload, {
      folio_number: form.folio_number, fund_house: form.fund_house, scheme_type: form.scheme_type,
      nav_date: form.nav_date || null, purchase_nav: form.purchase_nav ? parseFloat(form.purchase_nav) : null,
    });
    if (isIns) Object.assign(payload, {
      policy_number: form.policy_number, insurance_type: form.insurance_type, insurer_name: form.insurer_name,
      sum_assured: form.sum_assured ? parseFloat(form.sum_assured) : null,
      premium_amount: form.premium_amount ? parseFloat(form.premium_amount) : null,
      premium_frequency: form.premium_frequency,
    });

    // Booked from a confirmed deal: carry the same link the Transfer Queue
    // writes. This is what removes the deal from that queue, and the existing
    // uq_nw_transactions_deal unique index makes booking the same deal twice
    // impossible from either path.
    if (!editTxn && pickedDeal) {
      Object.assign(payload, {
        deal_confirmation_id: pickedDeal.deal_id,
        transfer_stage: 'transferred',
        transferred_at: new Date().toISOString(),
        transferred_by: employee.id,
        transfer_remarks: 'Booked via Add New Business',
      });
    }

    // SELL disposal: if this is a NEW sell and the client already holds this
    // security, pause and ask the operator whether to reduce the holding. If they
    // hold nothing, just book it (no holding to touch). Buys and edits are
    // unaffected and commit straight through.
    if (!editTxn && payload.txn_type === 'sell') {
      const holding = await findMatchingHolding(payload);
      if (holding) {
        setSaving(false);
        setSellApproval({ payload, holding });
        return;
      }
    }

    await commitSave(payload, false);
  };

  // Performs the actual DB write + holding sync. Split out of handleSave so the
  // SELL approval dialog can call it with the operator's reduce decision.
  const commitSave = async (payload: Record<string, any>, reduceSellHolding: boolean) => {
    setError(''); setSaving(true);
    if (editTxn) {
      // A transferred transaction only allows the revenue-basis fields, the date
      // and notes to change (DB immutability guard). Send ONLY those — sending
      // the full payload would falsely trip the guard, because setF recomputes
      // consolidated_amount (qty × per-unit-price), which differs from the stored
      // settlement (base rate / stamp-duty rounding). Non-transferred rows keep
      // the full edit, minus employee_id (never reassign ownership).
      let updatePayload: Record<string, any>;
      if ((editTxn as any).transfer_stage === 'transferred' && !isAdmin) {
        updatePayload = {};
        for (const k of ['landing_cost', 'insurance_revenue', 'trail_percent', 'trail_start_date', 'txn_date', 'notes'] as const) {
          if (k in payload) updatePayload[k] = payload[k];
        }
      } else {
        // Admins may fully amend any transaction (including a transferred one).
        // Ownership is never reassigned on edit.
        const { employee_id: _keepOwner, ...rest } = payload;
        updatePayload = rest;
      }
      const { error: err } = await supabase.from('nw_transactions').update({ ...updatePayload, updated_at: new Date().toISOString() }).eq('id', editTxn.id);
      if (err) { setError(err.message); setSaving(false); return; }

      // Keep portfolio holdings in step with the amended figures: reverse the
      // pre-edit contribution, then re-apply the new one — but only if this
      // transaction was actually holding-tracked (reverse returns false for
      // sells and Transfer-Queue bookings, which must not spawn a holding here).
      const hadHolding = await reverseTransactionFromHolding(editTxn as any);
      if (hadHolding) await syncTransactionToHolding(payload);
    } else {
      const { error: err } = await supabase.from('nw_transactions').insert([payload]).select().single();
      if (err) {
        // 23505 = unique violation on uq_nw_transactions_one_transferred_per_deal:
        // someone booked this deal first. Say so plainly instead of leaking the
        // constraint name.
        setError(err.code === '23505' && pickedDeal
          ? `Deal ${pickedDeal.confirmation_number} has already been booked as business. Refresh the deal list.`
          : err.message);
        setSaving(false);
        return;
      }
      await supabase.from('nw_activity_logs').insert([{
        employee_id: employee.id, client_id: form.client_id, action: 'Transaction Added',
        description: `${TXN_LABELS[form.txn_type]} ${form.product_name} — ${fmt(parseFloat(form.consolidated_amount))}`,
      }]);
    }

    // Auto-sync to portfolio holdings (only for new transactions, not edits).
    // syncTransactionToHolding handles buys (no-op for sells). A sell reduces the
    // holding only when the operator approved it in the disposal dialog.
    if (!editTxn) {
      await syncTransactionToHolding(payload);
      if (payload.txn_type === 'sell' && reduceSellHolding) {
        await reduceHoldingForSell(payload);
      }
    }

    setSaving(false); setShowAdd(false); setEditTxn(null); setSellApproval(null); loadTxns();
  };

  const handleDelete = async () => {
    if (!deleteTxn) return;
    setSaving(true);
    // Server-side cascade (admin/owner-gated): reverses the portfolio holding,
    // removes any DSA debit-note coverage line, deletes the row (documents
    // cascade) and — if it was booked from a deal — returns that deal to the
    // Transfer Queue. A plain DELETE would drift the holding and be blocked by
    // the DSA line / transfer guards.
    const { error: err } = await supabase.rpc('nw_delete_transaction_cascade', { p_txn_id: deleteTxn.id });
    setSaving(false);
    if (err) { setError(err.message || 'Could not delete transaction.'); return; }
    setDeleteTxn(null); loadTxns();
  };

  const selectedClientForForm = clients.find(c => c.id === form.client_id);
  const showDsaPrice = !!(selectedClientForForm?.sourced_via === 'dsa' && DSA_PRICE_TYPES.includes(form.product_type));

  // Fields the deal already states are locked once a deal is picked — the
  // signed note is the source of truth, so they must not drift here.
  const locked = !!pickedDeal;

  const txnFormJsx = (
    <div className="p-6 space-y-5">
      {error && <div className="p-3 rounded-xl text-sm text-c-red" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{error}</div>}

      {editTxn && (editTxn as any).transfer_stage === 'transferred' && isAdmin && (
        <div className="p-3 rounded-xl text-sm" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: 'var(--warning)' }}>
          This is a transferred (executed-ledger) transaction. As an admin you may amend any field; its
          portfolio holding will re-sync automatically. If it is covered by a DSA debit note, update that
          note separately — editing here does not adjust an already-computed DSA payout.
        </div>
      )}

      {/* Book from a confirmed deal. Open to every employee who can already
          add business here — this grants no new authority, it just removes the
          re-typing. Visibility is scoped by the database, not by this form:
          nw_deal_transfer_eligible is security_invoker, so an RM only ever
          sees deals belonging to their own clients.
          Only shown when creating, never when editing an existing row. */}
      {!editTxn && (
        <div className="rounded-xl p-4" style={{ background: 'rgba(var(--accent-rgb),0.04)', border: '1px solid rgba(var(--accent-rgb),0.15)' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Book from a Confirmed Deal</p>
            {pickedDeal && (
              <button type="button" onClick={clearPickedDeal}
                className="text-xs flex items-center gap-1 px-2 py-1 rounded-lg"
                style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                <X className="w-3 h-3" /> Clear
              </button>
            )}
          </div>

          {!pickedDeal && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-faint)' }} />
              <input
                value={dealSearch}
                onChange={e => { setDealSearch(e.target.value); setShowDealDrop(true); }}
                onFocus={() => setShowDealDrop(true)}
                placeholder="Search deal reference, client, security or ISIN…"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-text-primary outline-none"
                style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}
                autoComplete="off"
              />
              {showDealDrop && (
                <div className="absolute z-30 w-full mt-1 rounded-xl overflow-hidden shadow-2xl"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', maxHeight: 260, overflowY: 'auto' }}>
                  {dealOptions.length === 0 ? (
                    <div className="px-4 py-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
                      No deals awaiting booking. Deals appear here once they are fully paid.
                    </div>
                  ) : dealOptions.map(d => (
                    <button key={d.deal_id} type="button" onClick={() => selectDeal(d)}
                      className="w-full text-left px-4 py-3 transition-colors"
                      style={{ borderBottom: '1px solid var(--bg-raised)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.08)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{d.confirmation_number}</span>
                        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {d.settlement_amount != null ? fmt(Number(d.settlement_amount)) : '—'}
                        </span>
                      </div>
                      <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--text-primary)' }}>{d.snap_client_name}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-faint)' }}>
                        {d.security_name}{d.quantity != null ? ` · Qty ${d.quantity}` : ''}{d.isin ? ` · ${d.isin}` : ''}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
                Optional — pick a deal to pre-fill and link it, or leave blank and enter the business manually.
              </p>
            </div>
          )}

          {pickedDeal && (
            <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              <span className="font-mono text-xs mr-2" style={{ color: 'var(--accent)' }}>{pickedDeal.confirmation_number}</span>
              {pickedDeal.snap_client_name} · {pickedDeal.security_name}
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                Deal details are locked below. Add the landing cost{showDsaPrice ? ' and DSA landing' : ''} to finish.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="Client *"><S value={form.client_id} onChange={v => setF('client_id', v)} disabled={locked}>
          <option value="">Select client...</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.full_name} ({c.client_code})</option>)}
        </S></Field>
        <Field label="Transaction Type"><S value={form.txn_type} onChange={v => setF('txn_type', v)} disabled={locked}>
          {TXN_TYPES.map(t => <option key={t} value={t}>{TXN_LABELS[t]}</option>)}
        </S></Field>
        <Field label="Product Type"><S value={form.product_type} onChange={v => setF('product_type', v as ProductType)} disabled={locked}>
          {PRODUCTS.map(p => <option key={p} value={p}>{PRODUCT_LABELS[p]}</option>)}
        </S></Field>
        <Field label="Product Name *">
          <I value={form.product_name} onChange={e => setF('product_name', e.target.value)} readOnly={locked}
            style={locked ? { opacity: 0.65 } : undefined}
            placeholder={isBond ? 'e.g. HDFC NCD 2024' : isMF ? 'e.g. HDFC Flexi Cap Fund' : isIns ? 'e.g. LIC Jeevan Anand' : 'e.g. Reliance Industries'} />
        </Field>
        {(form.product_type === 'unlisted_share' || isBond) && (
          <Field label="ISIN" span2={false}>
            <I value={form.isin} onChange={e => setF('isin', e.target.value.toUpperCase())} readOnly={locked}
              placeholder="e.g. INE001A01036" style={{ fontFamily: 'monospace', letterSpacing: '0.05em', textTransform: 'uppercase', ...(locked ? { opacity: 0.65 } : null) }} />
          </Field>
        )}
        <Field label="Transaction Date"><I type="date" value={form.txn_date} onChange={e => setF('txn_date', e.target.value)} readOnly={locked} style={locked ? { opacity: 0.65 } : undefined} /></Field>
        {!isIns && <Field label={isMF ? 'Units' : 'Quantity'}><I type="number" value={form.quantity} onChange={e => setF('quantity', e.target.value)} readOnly={locked} style={locked ? { opacity: 0.65 } : undefined} placeholder="0" /></Field>}
        {!isIns && <Field label={isMF ? 'Purchase NAV (₹)' : isBond ? 'Purchase Price / Unit (₹)' : 'Per Unit Price (₹)'}>
          <I type="number" value={isMF ? form.purchase_nav : form.per_unit_price}
            onChange={e => setF(isMF ? 'purchase_nav' : 'per_unit_price', e.target.value)}
            readOnly={locked && !isMF} style={locked && !isMF ? { opacity: 0.65 } : undefined} placeholder="0.00" />
        </Field>}
        <Field label="Total Amount (₹) *">
          <I type="number" value={form.consolidated_amount} onChange={e => setF('consolidated_amount', e.target.value)}
            readOnly={locked || form.product_type === 'unlisted_share' || isMF || isBond}
            style={{ opacity: (locked || form.product_type === 'unlisted_share' || isMF || isBond) ? 0.65 : 1 }}
            placeholder={isIns ? 'Total premium paid' : 'Auto-calculated'} />
        </Field>
      </div>

      {/* DSA Pricing — only for DSA clients on applicable product types */}
      {showDsaPrice && (
        <div className="grid grid-cols-2 gap-4 rounded-xl p-4" style={{ background: 'rgba(var(--accent-rgb),0.05)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
          <div className="col-span-2">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>DSA Pricing</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>DSA price is internal only. Client price appears in portfolio print.</p>
          </div>
          <Field label="DSA Price / Unit (₹)">
            <I type="number" value={form.dsa_price} onChange={e => setF('dsa_price', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Client Price / Unit (₹)">
            <I type="number" value={form.client_price} onChange={e => setF('client_price', e.target.value)} placeholder="0.00" />
          </Field>
        </div>
      )}

      {/* Landing cost for unlisted shares and bonds */}
      {['unlisted_share', 'secondary_bond', 'primary_bond'].includes(form.product_type) && (
        <div className="grid grid-cols-2 gap-4 rounded-xl p-4" style={{ background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.15)' }}>
          <div className="col-span-2">
            <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--success)' }}>MIS Revenue</p>
            {/* Direction-aware: on a SELL the client sells to us, so revenue is our
                resale/exit value (Landing Cost) minus the price we pay the client. */}
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
              {form.txn_type === 'sell'
                ? 'Revenue = (Landing Cost − Price) × Quantity'
                : 'Revenue = (Price − Landing Cost) × Quantity'}
            </p>
          </div>
          <Field label="Landing Cost / Unit (₹)" span2>
            <I type="number" value={form.landing_cost} onChange={e => setF('landing_cost', e.target.value)}
              placeholder={form.txn_type === 'sell' ? 'Internal resale / exit value per unit' : 'Internal acquisition cost per unit'} />
          </Field>
        </div>
      )}

      {isBond && (() => {
        const pdInfo = payoutDateLabel(form.payout_frequency);
        const nextPayouts = form.interest_payout_date ? getNextPayouts(form.interest_payout_date, form.payout_frequency) : [];
        return (
          <div className="grid grid-cols-2 gap-4">
            <SecHead icon={Percent} label="Fixed Coupon Details" color="var(--success)" />
            <Field label="Issuer Name"><I value={form.issuer_name} onChange={e => setF('issuer_name', e.target.value)} placeholder="e.g. HDFC Ltd" /></Field>
            <Field label="Face Value / Unit (₹)"><I type="number" value={form.face_value} onChange={e => setF('face_value', e.target.value)} placeholder="1000" /></Field>
            <Field label="Coupon / Interest Rate (% p.a.)"><I type="number" value={form.coupon_rate} onChange={e => setF('coupon_rate', e.target.value)} placeholder="8.50" /></Field>
            <Field label="Payout Type"><S value={form.payout_frequency} onChange={v => setF('payout_frequency', v)}>
              {Object.entries(PAYOUT_FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </S></Field>
            <Field label={pdInfo.label}>
              <I value={form.interest_payout_date} onChange={e => setF('interest_payout_date', e.target.value)} placeholder={pdInfo.placeholder} />
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{pdInfo.hint}</p>
            </Field>
            {interest && (
              <div className="col-span-2 rounded-xl p-4" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--success)' }}>Auto-Calculated Interest</p>
                <div className="grid grid-cols-3 gap-4">
                  <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Annual Interest</p><p className="text-base font-bold text-text-primary mt-0.5">{fmt(interest.annual)}</p></div>
                  <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{PAYOUT_FREQ[form.payout_frequency]} Payout</p><p className="text-base font-bold mt-0.5" style={{ color: 'var(--success)' }}>{fmt(interest.perPeriod)}</p></div>
                  <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Yield</p><p className="text-base font-bold text-text-primary mt-0.5">{form.coupon_rate}% p.a.</p></div>
                </div>
                {nextPayouts.length > 0 && (
                  <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(16,185,129,0.15)' }}>
                    <p className="text-xs mb-2" style={{ color: 'var(--text-faint)' }}>Next Payout Dates</p>
                    <div className="flex flex-wrap gap-2">
                      {nextPayouts.map((d, i) => (
                        <span key={i} className="text-xs px-2 py-1 rounded-lg font-semibold" style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--success)' }}>{d}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {isMF && (
        <div className="grid grid-cols-2 gap-4">
          <SecHead icon={TrendingUp} label="Mutual Fund Details" color="var(--chart-4)" />
          <Field label="Fund House / AMC"><I value={form.fund_house} onChange={e => setF('fund_house', e.target.value)} placeholder="e.g. HDFC Asset Management" /></Field>
          <Field label="Folio Number"><I value={form.folio_number} onChange={e => setF('folio_number', e.target.value)} placeholder="e.g. 1234567890" /></Field>
          <Field label="Scheme Type"><S value={form.scheme_type} onChange={v => setF('scheme_type', v)}>
            {Object.entries(SCHEME_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </S></Field>
          <Field label="NAV Date"><I type="date" value={form.nav_date} onChange={e => setF('nav_date', e.target.value)} /></Field>
          <SecHead icon={TrendingUp} label="MIS Trail Commission" color="var(--success)" />
          <Field label="Trail Commission (% p.a.)">
            <I type="number" value={form.trail_percent} onChange={e => setF('trail_percent', e.target.value)} placeholder="e.g. 1.00" />
          </Field>
          <Field label="Investment Date">
            <I type="date" value={form.trail_start_date} onChange={e => setF('trail_start_date', e.target.value)} />
          </Field>
        </div>
      )}

      {isIns && (
        <div className="grid grid-cols-2 gap-4">
          <SecHead icon={Shield} label="Insurance Policy Details" color="var(--chart-6)" />
          <Field label="Policy Number *"><I value={form.policy_number} onChange={e => setF('policy_number', e.target.value)} placeholder="e.g. LIC-2024-001234" /></Field>
          <Field label="Insurance Type"><S value={form.insurance_type} onChange={v => setF('insurance_type', v)}>
            {Object.entries(INS_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </S></Field>
          <Field label="Insurance Company"><I value={form.insurer_name} onChange={e => setF('insurer_name', e.target.value)} placeholder="e.g. LIC of India" /></Field>
          <Field label="Sum Assured / Cover (₹)"><I type="number" value={form.sum_assured} onChange={e => setF('sum_assured', e.target.value)} placeholder="0" /></Field>
          <Field label="Premium Amount (₹)"><I type="number" value={form.premium_amount} onChange={e => setF('premium_amount', e.target.value)} placeholder="0" /></Field>
          <Field label="Premium Frequency"><S value={form.premium_frequency} onChange={v => setF('premium_frequency', v)}>
            {Object.entries(PREM_FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </S></Field>
          <SecHead icon={Shield} label="MIS Revenue" color="var(--success)" />
          <Field label="Insurance Revenue (₹)" span2>
            <I type="number" value={form.insurance_revenue} onChange={e => setF('insurance_revenue', e.target.value)} placeholder="One-time revenue from this policy" />
          </Field>
        </div>
      )}

      <div className="space-y-4">
        <Field label="Notes">
          <textarea value={form.notes} onChange={e => setF('notes', e.target.value)} rows={2} placeholder="Optional notes..."
            className="w-full px-3 py-2.5 rounded-xl text-sm text-text-primary outline-none resize-none" style={iS} />
        </Field>
      </div>
      <div className="flex justify-end gap-3 pt-1">
        <button onClick={() => { setShowAdd(false); setEditTxn(null); }} className="px-4 py-2 rounded-xl text-sm" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
        <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
          {saving ? 'Saving...' : editTxn ? 'Save Changes' : 'Add New Business'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Finance</p>
          <h1 className="text-2xl font-bold text-text-primary">Transactions</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>New business — current transactions added here appear in MIS</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => onNavigate?.('portfolio', { addHolding: '1' })}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            title="Record a client's pre-existing holding for their portfolio — does not affect MIS revenue">
            <Plus className="w-4 h-4" /> Add Existing Business
          </button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-on-accent" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            <Plus className="w-4 h-4" /> Add New Business
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-faint)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search product or client..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-text-primary outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
        </div>
        {isAdmin && (
          <div className="relative">
            <select value={empFilter} onChange={e => setEmpFilter(e.target.value)}
              className="pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(var(--accent-rgb),0.4)' }}>
              <option value="all">All Employees</option>
              {empList.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--accent)' }} />
          </div>
        )}
        <div className="flex gap-2 flex-wrap">
          {[['all', 'All Types'], ...TXN_TYPES.map(t => [t, TXN_LABELS[t]])].map(([val, label]) => (
            <button key={val} onClick={() => setTypeFilter(val)} className="px-3 py-2 rounded-xl text-xs font-semibold transition-all"
              style={typeFilter === val ? { background: 'rgba(var(--accent-rgb),0.15)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.3)' } : { background: 'var(--bg-raised)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <select value={productFilter} onChange={e => setProductFilter(e.target.value)}
            className="pl-3 pr-8 py-2.5 rounded-xl text-xs font-semibold text-text-primary outline-none appearance-none"
            style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
            <option value="all">All Products</option>
            {PRODUCTS.map(p => <option key={p} value={p}>{PRODUCT_LABELS[p]}</option>)}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full nw-table">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['Date', 'Client', 'Type', 'Product', 'Details', 'Amount', 'Actions'].map(h => (
                  <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12"><LogoLoader size={40} /></td></tr>
              ) : txns.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-sm" style={{ color: 'var(--text-faint)' }}>No transactions found</td></tr>
              ) : txns.map(t => {
                const isB = BOND_TYPES.includes(t.product_type);
                const isMFt = t.product_type === 'mutual_fund';
                const isIt = t.product_type === 'insurance';
                const payout = isB && t.face_value && t.coupon_rate && t.quantity ? calcPayout(t.face_value, t.coupon_rate, t.quantity, t.payout_frequency || 'annual') : null;
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                    <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(t.txn_date)}</td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-text-primary">{(t.client as any)?.full_name || '—'}</p>
                      <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{(t.client as any)?.client_code}</p>
                    </td>
                    <td className="px-5 py-3.5"><span className={`text-xs font-bold px-2 py-1 rounded-lg ${TXN_COLORS[t.txn_type]}`}>{TXN_LABELS[t.txn_type]}</span></td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-text-primary">{t.product_name}</p>
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${PRODUCT_COLORS[t.product_type]}`}>{PRODUCT_LABELS[t.product_type]}</span>
                    </td>
                    <td className="px-5 py-3.5 min-w-[140px]">
                      {isB && <div className="space-y-0.5">
                        {t.coupon_rate && <p className="text-xs font-bold" style={{ color: 'var(--success)' }}>{t.coupon_rate}% p.a.</p>}
                        {t.payout_frequency && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{PAYOUT_FREQ[t.payout_frequency]}</p>}
                        {payout !== null && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{fmt(payout)}/payout</p>}
                        {t.issuer_name && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{t.issuer_name}</p>}
                      </div>}
                      {isMFt && <div className="space-y-0.5">
                        {t.fund_house && <p className="text-xs text-text-primary">{t.fund_house}</p>}
                        {t.folio_number && <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{t.folio_number}</p>}
                        {t.scheme_type && <p className="text-xs" style={{ color: 'var(--chart-4)' }}>{SCHEME_TYPES[t.scheme_type] || t.scheme_type}</p>}
                      </div>}
                      {isIt && <div className="space-y-0.5">
                        {t.policy_number && <p className="text-xs font-mono" style={{ color: 'var(--chart-6)' }}>{t.policy_number}</p>}
                        {t.insurance_type && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{INS_TYPES[t.insurance_type] || t.insurance_type}</p>}
                        {t.insurer_name && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{t.insurer_name}</p>}
                      </div>}
                      {!isB && !isMFt && !isIt && t.quantity && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Qty: {t.quantity}</p>}
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-bold text-text-primary">{fmt(t.consolidated_amount)}</p>
                      {isIt && t.sum_assured && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Cover: {fmt(t.sum_assured)}</p>}
                      {!isIt && t.documents && t.documents.length > 0 && (
                        <a href={t.documents[0].file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs mt-0.5" style={{ color: 'var(--accent)' }}>
                          <FileText className="w-3 h-3" /> Doc <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setViewTxn(t)} className="p-1.5 rounded-lg" style={{ color: 'var(--text-faint)' }} onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}><ChevronRight className="w-4 h-4" /></button>
                        <button onClick={() => openEdit(t)} className="p-1.5 rounded-lg" style={{ color: 'var(--text-faint)' }} onMouseEnter={e => (e.currentTarget.style.color = 'rgb(var(--info-soft-rgb))')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => { setError(''); setDeleteTxn(t); }} className="p-1.5 rounded-lg" style={{ color: 'var(--text-faint)' }} onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <Modal title="Add New Business" onClose={() => setShowAdd(false)}>{txnFormJsx}</Modal>}
      {editTxn && <Modal title="Edit Transaction" onClose={() => setEditTxn(null)}>{txnFormJsx}</Modal>}

      {viewTxn && (
        <Modal title="Transaction Details" onClose={() => setViewTxn(null)}>
          <div className="p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-bold text-text-primary">{viewTxn.product_name}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${TXN_COLORS[viewTxn.txn_type]}`}>{TXN_LABELS[viewTxn.txn_type]}</span>
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${PRODUCT_COLORS[viewTxn.product_type]}`}>{PRODUCT_LABELS[viewTxn.product_type]}</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xl font-bold" style={{ color: 'var(--accent)' }}>{fmt(viewTxn.consolidated_amount)}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(viewTxn.txn_date)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Client</p><p className="text-sm font-medium text-text-primary">{(viewTxn.client as any)?.full_name || '—'}</p></div>
              <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Code</p><p className="text-sm font-mono text-text-primary">{(viewTxn.client as any)?.client_code || '—'}</p></div>
              {viewTxn.quantity != null && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Quantity</p><p className="text-sm font-medium text-text-primary">{viewTxn.quantity.toLocaleString('en-IN')}</p></div>}
              {viewTxn.per_unit_price != null && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Unit Price</p><p className="text-sm font-medium text-text-primary">{fmt(viewTxn.per_unit_price)}</p></div>}
            </div>
            {BOND_TYPES.includes(viewTxn.product_type) && (viewTxn.coupon_rate || viewTxn.face_value) && (
              <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)' }}>
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--success)' }}>Fixed Coupon Details</p>
                <div className="grid grid-cols-2 gap-3">
                  {viewTxn.issuer_name && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Issuer</p><p className="text-sm text-text-primary">{viewTxn.issuer_name}</p></div>}
                  {viewTxn.face_value != null && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Face Value</p><p className="text-sm text-text-primary">{fmt(viewTxn.face_value)}</p></div>}
                  {viewTxn.coupon_rate != null && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Coupon Rate</p><p className="text-sm font-bold text-text-primary">{viewTxn.coupon_rate}% p.a.</p></div>}
                  {viewTxn.payout_frequency && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Payout Type</p><p className="text-sm text-text-primary">{PAYOUT_FREQ[viewTxn.payout_frequency] || viewTxn.payout_frequency}</p></div>}
                  {viewTxn.interest_payout_date && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Payout Date</p><p className="text-sm text-text-primary">{fmtDate(viewTxn.interest_payout_date)}</p></div>}
                  {viewTxn.face_value && viewTxn.coupon_rate && viewTxn.quantity && (
                    <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>{PAYOUT_FREQ[viewTxn.payout_frequency || 'annual']} Interest</p>
                    <p className="text-sm font-bold" style={{ color: 'var(--success)' }}>{fmt(calcPayout(viewTxn.face_value, viewTxn.coupon_rate, viewTxn.quantity, viewTxn.payout_frequency || 'annual'))}</p></div>
                  )}
                </div>
              </div>
            )}
            {viewTxn.product_type === 'mutual_fund' && (viewTxn.fund_house || viewTxn.folio_number) && (
              <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(236,72,153,0.05)', border: '1px solid rgba(236,72,153,0.2)' }}>
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--chart-4)' }}>Mutual Fund Details</p>
                <div className="grid grid-cols-2 gap-3">
                  {viewTxn.fund_house && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Fund House</p><p className="text-sm text-text-primary">{viewTxn.fund_house}</p></div>}
                  {viewTxn.folio_number && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Folio No.</p><p className="text-sm font-mono text-text-primary">{viewTxn.folio_number}</p></div>}
                  {viewTxn.scheme_type && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Scheme</p><p className="text-sm text-text-primary">{SCHEME_TYPES[viewTxn.scheme_type] || viewTxn.scheme_type}</p></div>}
                  {viewTxn.purchase_nav != null && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Purchase NAV</p><p className="text-sm text-text-primary">₹{viewTxn.purchase_nav}</p></div>}
                </div>
              </div>
            )}
            {viewTxn.product_type === 'insurance' && viewTxn.policy_number && (
              <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(249,115,22,0.05)', border: '1px solid rgba(249,115,22,0.2)' }}>
                <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--chart-6)' }}>Insurance Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Policy No.</p><p className="text-sm font-mono text-text-primary">{viewTxn.policy_number}</p></div>
                  {viewTxn.insurance_type && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Type</p><p className="text-sm text-text-primary">{INS_TYPES[viewTxn.insurance_type] || viewTxn.insurance_type}</p></div>}
                  {viewTxn.insurer_name && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Insurer</p><p className="text-sm text-text-primary">{viewTxn.insurer_name}</p></div>}
                  {viewTxn.sum_assured != null && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sum Assured</p><p className="text-sm text-text-primary">{fmt(viewTxn.sum_assured)}</p></div>}
                  {viewTxn.premium_amount != null && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Premium</p><p className="text-sm text-text-primary">{fmt(viewTxn.premium_amount)}</p></div>}
                  {viewTxn.premium_frequency && <div><p className="text-xs" style={{ color: 'var(--text-muted)' }}>Frequency</p><p className="text-sm text-text-primary">{PREM_FREQ[viewTxn.premium_frequency] || viewTxn.premium_frequency}</p></div>}
                </div>
              </div>
            )}
            {viewTxn.notes && <div className="rounded-xl p-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}><p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Notes</p><p className="text-sm text-text-primary">{viewTxn.notes}</p></div>}
            {viewTxn.documents && viewTxn.documents.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Documents</p>
                {viewTxn.documents.map(d => (
                  <a key={d.id} href={d.file_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 p-3 rounded-xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                    <FileText className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    <span className="text-sm text-text-primary flex-1">{d.file_name}</span>
                    <ExternalLink className="w-3.5 h-3.5" style={{ color: 'var(--text-faint)' }} />
                  </a>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}

      {deleteTxn && (
        <Modal title="Delete Transaction" onClose={() => setDeleteTxn(null)}>
          <div className="p-6 space-y-4">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Delete transaction for <span className="text-text-primary font-semibold">{deleteTxn.product_name}</span> ({fmt(deleteTxn.consolidated_amount)})? This also reverses its portfolio holding{(deleteTxn as any).transfer_stage === 'transferred' ? ' and permanently deletes the source deal confirmation along with its payments' : ''}. This cannot be undone.</p>
            {error && <div className="p-3 rounded-xl text-sm text-c-red" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{error}</div>}
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteTxn(null)} className="px-4 py-2 rounded-xl text-sm" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
              <button onClick={handleDelete} disabled={saving} className="px-5 py-2 rounded-xl text-sm font-bold text-text-primary disabled:opacity-50" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* SELL disposal — the client is selling to us and already holds this
          security. Ask whether to reduce their portfolio holding. */}
      {sellApproval && (
        <Modal title="Reduce Client Holding?" onClose={() => setSellApproval(null)}>
          <div className="p-6 space-y-4">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              This is a <span className="font-bold text-text-primary">SELL</span> and the client
              currently holds{' '}
              <span className="font-bold text-text-primary">
                {Number(sellApproval.holding.quantity || 0).toLocaleString('en-IN')}
              </span>{' '}
              unit(s) of <span className="font-semibold text-text-primary">{sellApproval.payload.product_name}</span>.
            </p>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Reduce their portfolio by the{' '}
              <span className="font-bold text-text-primary">
                {Number(sellApproval.payload.quantity || 0).toLocaleString('en-IN')}
              </span>{' '}
              unit(s) being sold? The holding is deleted if nothing remains. The transaction
              is booked either way.
            </p>
            {error && <div className="p-3 rounded-xl text-sm text-c-red" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{error}</div>}
            <div className="flex justify-end gap-3 flex-wrap">
              <button
                onClick={() => setSellApproval(null)}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-sm disabled:opacity-50"
                style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { const p = sellApproval.payload; commitSave(p, false); }}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: 'var(--bg-raised)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              >
                Save Without Reducing
              </button>
              <button
                onClick={() => { const p = sellApproval.payload; commitSave(p, true); }}
                disabled={saving}
                className="px-5 py-2 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                {saving ? 'Saving...' : 'Reduce Holding & Save'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
