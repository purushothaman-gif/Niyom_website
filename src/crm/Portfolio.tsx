import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { LogoLoader } from '../components/LogoLoader';
import { CasHoldingsPanel } from './CasHoldingsPanel';
import { SchemePicker } from './SchemePicker';
import { supabase } from '../lib/supabase';
import { NWEmployee, NWHolding, NWClient, ProductType } from './types';
import { fmt, fmtDate, PRODUCT_LABELS, PRODUCT_COLORS, PRODUCT_CHART_COLORS } from './utils';
import { Plus, X, Pencil, Trash2, ChevronDown, Printer, TrendingUp, Percent, Shield, ArrowLeft, ArrowUp, ArrowDown, Search, Download } from 'lucide-react';
import type { Insertable } from '../lib/dbJson';

interface Props {
  employee: NWEmployee;
  onNavigate?: (page: string, params?: Record<string, string>) => void;
  pageParams?: Record<string, string>;
}

const PRODUCTS: ProductType[] = ['unlisted_share', 'secondary_bond', 'primary_bond', 'mutual_fund', 'fixed_deposit', 'insurance'];
const BOND_TYPES: ProductType[] = ['secondary_bond', 'primary_bond', 'fixed_deposit'];
const ISIN_TYPES: ProductType[] = ['secondary_bond', 'primary_bond'];
const PAYOUT_FREQ: Record<string, string> = { annual: 'Annual', halfyearly: 'Half-Yearly', quarterly: 'Quarterly', monthly: 'Monthly' };
const PAYOUT_DIVISORS: Record<string, number> = { annual: 1, halfyearly: 2, quarterly: 4, monthly: 12 };
const SCHEME_TYPES = ['equity', 'debt', 'hybrid', 'index', 'elss', 'liquid', 'others'];
const SCHEME_LABELS: Record<string, string> = { equity: 'Equity', debt: 'Debt', hybrid: 'Hybrid', index: 'Index', elss: 'ELSS', liquid: 'Liquid', others: 'Others' };
const INS_TYPES = ['term', 'ulip', 'traditional', 'medical', 'vehicle'];
const INS_LABELS: Record<string, string> = { term: 'Term Insurance', ulip: 'ULIP', traditional: 'Traditional Insurance', medical: 'Medical Insurance', vehicle: 'Vehicle Insurance' };
const PREM_FREQ: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', halfyearly: 'Half-Yearly', annual: 'Annual', single: 'Single Premium' };

// --- Client-level roll-up (landing view) -------------------------------------
type ClientView = 'clients' | 'detail';
type ClientSortKey = 'name' | 'employee' | 'invested' | 'aum' | 'unlisted' | 'bonds' | 'mf' | 'pl';

// Bonds column = primary + secondary only. fixed_deposit is a BOND_TYPE for
// payout maths but is not a bond for AUM reporting, so it lands in the
// unbucketed remainder (along with insurance) inside total AUM.
const AUM_BOND_TYPES: ProductType[] = ['primary_bond', 'secondary_bond'];

interface ClientRow {
  id: string;
  name: string;
  code: string;
  employeeName: string;
  invested: number;
  aum: number;
  unlisted: number;
  bonds: number;
  mf: number;
  pl: number;
  plPct: number;
}

// Payout date label & placeholder depending on frequency
function payoutDateLabel(freq: string): { label: string; placeholder: string; pattern: string; hint: string } {
  switch (freq) {
    case 'monthly': return { label: 'Payout Day (DD)', placeholder: 'e.g. 15', pattern: '[0-9]{1,2}', hint: 'Enter day of month (1–31). Future dates auto-calculated.' };
    case 'quarterly': return { label: 'Payout Day/Month (DD/MM)', placeholder: 'e.g. 15/03', pattern: '[0-9]{1,2}/[0-9]{1,2}', hint: 'First quarterly payout day/month. Others auto-calculated.' };
    case 'halfyearly': return { label: 'Payout Day/Month (DD/MM)', placeholder: 'e.g. 15/03', pattern: '[0-9]{1,2}/[0-9]{1,2}', hint: 'First half-yearly payout day/month. Second payout auto-calculated.' };
    case 'annual':
    default: return { label: 'Payout Day/Month (DD/MM)', placeholder: 'e.g. 15/03', pattern: '[0-9]{1,2}/[0-9]{1,2}', hint: 'Annual payout day and month. Year auto-updates each year.' };
  }
}

// Generate next N payout dates from DD/MM or DD pattern
function getNextPayouts(payoutDateStr: string, freq: string, count = 3): string[] {
  if (!payoutDateStr) return [];
  const today = new Date();
  const dates: string[] = [];
  try {
    if (freq === 'monthly') {
      const day = parseInt(payoutDateStr);
      if (isNaN(day) || day < 1 || day > 31) return [];
      for (let i = 0; i < count; i++) {
        const d = new Date(today.getFullYear(), today.getMonth() + i, day);
        if (d < today) { /* skip past */ } else dates.push(d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
        if (dates.length >= count) break;
      }
    } else {
      const parts = payoutDateStr.split('/');
      if (parts.length < 2) return [];
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1;
      if (isNaN(day) || isNaN(month)) return [];
      const intervalMonths = PAYOUT_DIVISORS[freq] ? 12 / PAYOUT_DIVISORS[freq] : 12;
      let year = today.getFullYear();
      let d = new Date(year, month, day);
      if (d < today) d = new Date(year + 1, month, day);
      for (let i = 0; i < count * 4; i++) {
        dates.push(d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
        d = new Date(d.getFullYear(), d.getMonth() + intervalMonths, d.getDate());
        if (dates.length >= count) break;
      }
    }
  } catch { return []; }
  return dates.slice(0, count);
}

function calcPayout(fv: number, rate: number, qty: number, freq: string) {
  return (fv * (rate / 100) * qty) / (PAYOUT_DIVISORS[freq] || 1);
}

// Convert DD/MM or DD pattern to next ISO date (YYYY-MM-DD) for DB storage
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}>
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden max-h-[90vh] flex flex-col" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="px-6 py-4 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-bold text-text-primary">{title}</h3>
          <button onClick={onClose} style={{ color: 'var(--text-faint)' }}><X className="w-5 h-5" /></button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
}

const inputClass = "w-full px-3 py-2.5 rounded-xl text-sm text-text-primary outline-none";
const inputStyle = { background: 'var(--bg-base)', border: '1px solid var(--border)' };

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{hint}</p>}
    </div>
  );
}

// All helper components defined at module level to prevent remount-on-render (cursor loss)
function I(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputClass} style={{ ...inputStyle, ...(props.style || {}) }} />;
}
function Sel({ value, onChange, children }: { value: string; onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void; children: React.ReactNode }) {
  return <select value={value} onChange={onChange} className={inputClass} style={inputStyle}>{children}</select>;
}
function SecHead({ icon: Icon, label, color }: { icon: React.ElementType; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <Icon className="w-4 h-4" style={{ color }} />
      <span className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: `color-mix(in srgb, ${color} 19%, transparent)` }} />
    </div>
  );
}

// Simple SVG pie chart
function PieChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div className="w-48 h-48 rounded-full mx-auto flex items-center justify-center" style={{ background: 'var(--bg-raised)' }}><p className="text-xs" style={{ color: 'var(--text-faint)' }}>No data</p></div>;

  let startAngle = 0;
  const slices = data.filter(d => d.value > 0).map(d => {
    const angle = (d.value / total) * 360;
    const slice = { ...d, startAngle, endAngle: startAngle + angle };
    startAngle += angle;
    return slice;
  });

  const polarToCartesian = (cx: number, cy: number, r: number, angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  return (
    <svg width="200" height="200" viewBox="0 0 200 200" className="mx-auto">
      {slices.map((s, i) => {
        const start = polarToCartesian(100, 100, 80, s.startAngle);
        const end = polarToCartesian(100, 100, 80, s.endAngle);
        const largeArc = s.endAngle - s.startAngle > 180 ? 1 : 0;
        const d = `M 100 100 L ${start.x} ${start.y} A 80 80 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
        return <path key={i} d={d} fill={s.color} stroke="var(--bg-elevated)" strokeWidth="2" />;
      })}
      <circle cx="100" cy="100" r="45" fill="var(--bg-elevated)" />
    </svg>
  );
}

const DSA_PRICE_TYPES: ProductType[] = ['unlisted_share', 'secondary_bond', 'primary_bond'];

interface HoldingForm {
  client_id: string;
  product_type: ProductType;
  product_name: string;
  txn_date: string;
  quantity: string;
  avg_cost: string;
  current_price: string;  // S7: for unlisted share current price input
  current_value: string;
  invested_amount: string;
  maturity_date: string;
  notes: string;
  // DSA pricing
  dsa_price: string;
  client_price: string;
  // MIS revenue
  landing_cost: string;
  insurance_revenue: string;
  trail_percent: string;
  trail_start_date: string;
  // Bond / Fixed Income
  isin: string;
  face_value: string;
  coupon_rate: string;
  interest_payout_date: string;
  payout_frequency: string;
  issuer_name: string;
  interest_payout_amount: string;
  // Mutual Fund
  folio_number: string;
  fund_house: string;
  scheme_type: string;
  nav_date: string;
  purchase_nav: string;
  current_nav: string;
  // Insurance
  policy_number: string;
  insurance_type: string;
  insurer_name: string;
  sum_assured: string;
  premium_amount: string;
  premium_frequency: string;
  policy_start_date: string;
  premium_due_date: string;
  nominee_name: string;
}

const emptyForm = (): HoldingForm => ({
  client_id: '', product_type: 'unlisted_share', product_name: '',
  txn_date: new Date().toISOString().split('T')[0],
  quantity: '', avg_cost: '', current_price: '', current_value: '', invested_amount: '',
  maturity_date: '', notes: '',
  dsa_price: '', client_price: '',
  landing_cost: '', insurance_revenue: '', trail_percent: '', trail_start_date: '',
  isin: '', face_value: '', coupon_rate: '', interest_payout_date: '', payout_frequency: 'annual',
  issuer_name: '', interest_payout_amount: '',
  folio_number: '', fund_house: '', scheme_type: 'equity', nav_date: '', purchase_nav: '', current_nav: '',
  policy_number: '', insurance_type: 'term', insurer_name: '', sum_assured: '',
  premium_amount: '', premium_frequency: 'annual', policy_start_date: '', premium_due_date: '', nominee_name: '',
});

export default function Portfolio({ employee, pageParams }: Props) {
  const [holdings, setHoldings] = useState<NWHolding[]>([]);
  const [clients, setClients] = useState<NWClient[]>([]);
  const [empList, setEmpList] = useState<{ id: string; full_name: string; employee_code: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [empFilter, setEmpFilter] = useState('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editHolding, setEditHolding] = useState<NWHolding | null>(null);
  const [deleteHolding, setDeleteHolding] = useState<NWHolding | null>(null);
  const [form, setForm] = useState<HoldingForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // 'clients' = one row per client (the book); 'detail' = one client's full portfolio.
  // clientFilter stays the single source of truth for *which* client is open.
  const [view, setView] = useState<ClientView>('clients');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<ClientSortKey>('aum');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Deep-link from Transactions' "Add Existing Business" button: open the Add
  // Holding form straight away. A holding is a portfolio-only record (no
  // transaction), so it never touches MIS revenue.
  useEffect(() => {
    if (pageParams?.addHolding === '1') {
      setForm(emptyForm());
      setError('');
      setShowAdd(true);
    }
  }, [pageParams?.addHolding]);

  const toggleGroup = (key: string) => setExpandedGroups(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  // Drill-down: clientFilter drives loadHoldings(), so setting it refetches
  // scoped to that one client automatically.
  const openClient = (clientId: string) => {
    setClientFilter(clientId);
    setProductFilter('all');
    setExpandedGroups(new Set());
    setView('detail');
  };

  const backToClients = () => {
    setClientFilter('all');
    setProductFilter('all');
    setExpandedGroups(new Set());
    setView('clients');
  };

  const toggleSort = (key: ClientSortKey) => {
    if (sortKey === key) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return; }
    setSortKey(key);
    // Text sorts read best A→Z; money sorts read best biggest-first.
    setSortDir(key === 'name' || key === 'employee' ? 'asc' : 'desc');
  };

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const isBond = BOND_TYPES.includes(form.product_type);
  const isMF = form.product_type === 'mutual_fund';
  const isIns = form.product_type === 'insurance';
  const isUnlisted = form.product_type === 'unlisted_share';

  useEffect(() => {
    supabase.from('nw_clients').select('id, full_name, client_code, sourced_via, dsa_id, employee_id, employee:nw_employees(full_name, employee_code)').then(({ data }) => setClients((data as unknown as NWClient[]) || []));
    if (isAdmin) {
      supabase.from('nw_employees').select('id, full_name, employee_code').eq('status', 'active').order('full_name')
        .then(({ data }) => setEmpList((data as any[]) || []));
    }
  }, [isAdmin]);

  const loadHoldings = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('nw_holdings').select('*, client:nw_clients(full_name, client_code, employee_id)').order('created_at', { ascending: false });
    if (clientFilter !== 'all') query = query.eq('client_id', clientFilter);
    if (productFilter !== 'all') query = query.eq('product_type', productFilter);
    const { data } = await query;
    let list = (data as (NWHolding & { client: any })[]) || [];
    if (!isAdmin) {
      list = list.filter(h => h.client?.employee_id === employee.id);
    } else if (empFilter !== 'all') {
      list = list.filter(h => h.client?.employee_id === empFilter);
    }
    setHoldings(list);
    setLoading(false);
  }, [clientFilter, productFilter, empFilter, isAdmin, employee.id]);

  useEffect(() => { loadHoldings(); }, [loadHoldings]);

  const updatePortfolioValue = async (clientId: string) => {
    const { data } = await supabase.from('nw_holdings').select('current_value').eq('client_id', clientId);
    const total = (data || []).reduce((s: number, h: any) => s + (h.current_value || 0), 0);
    await supabase.from('nw_clients').update({ portfolio_value: total }).eq('id', clientId);
  };

  const setF = (k: keyof HoldingForm, v: string) => {
    setForm(prev => {
      const next = { ...prev, [k]: v };
      // S7: Unlisted share — qty × avg_cost = invested, qty × current_price = current_value
      if (next.product_type === 'unlisted_share') {
        const qty = parseFloat(next.quantity) || 0;
        const cost = parseFloat(next.avg_cost) || 0;
        const cprice = parseFloat(next.current_price) || 0;
        if (qty > 0 && cost > 0) next.invested_amount = (qty * cost).toFixed(2);
        if (qty > 0 && cprice > 0) next.current_value = (qty * cprice).toFixed(2);
      }
      // MF: units × purchase_nav = invested_amount, units × current_nav = current_value
      if (next.product_type === 'mutual_fund') {
        const qty = parseFloat(next.quantity) || 0;
        const pnav = parseFloat(next.purchase_nav) || 0;
        const cnav = parseFloat(next.current_nav) || 0;
        if (qty > 0 && pnav > 0) next.invested_amount = (qty * pnav).toFixed(2);
        if (qty > 0 && cnav > 0) next.current_value = (qty * cnav).toFixed(2);
      }
      // Bond: qty × avg_cost = invested_amount
      if (BOND_TYPES.includes(next.product_type)) {
        const qty = parseFloat(next.quantity) || 0;
        const cost = parseFloat(next.avg_cost) || 0;
        if (qty > 0 && cost > 0) next.invested_amount = (qty * cost).toFixed(2);
        const fv = parseFloat(next.face_value) || 0;
        const rate = parseFloat(next.coupon_rate) || 0;
        const freq = next.payout_frequency || 'annual';
        if (fv > 0 && rate > 0 && qty > 0) {
          next.interest_payout_amount = calcPayout(fv, rate, qty, freq).toFixed(2);
        }
      }
      return next;
    });
  };

  const openEdit = (h: NWHolding) => {
    setForm({
      client_id: h.client_id, product_type: h.product_type, product_name: h.product_name,
      txn_date: (h as any).txn_date || h.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
      quantity: h.quantity?.toString() || '', avg_cost: h.avg_cost?.toString() || '',
      current_price: '', // not stored, re-entered if needed
      current_value: h.current_value?.toString() || '', invested_amount: h.invested_amount?.toString() || '',
      maturity_date: h.maturity_date || '', notes: h.notes || '',
      dsa_price: h.dsa_price?.toString() || '', client_price: h.client_price?.toString() || '',
      landing_cost: h.landing_cost?.toString() || '', insurance_revenue: h.insurance_revenue?.toString() || '',
      trail_percent: h.trail_percent?.toString() || '', trail_start_date: h.trail_start_date || '',
      isin: (h as any).isin || '',
      face_value: h.face_value?.toString() || '', coupon_rate: h.coupon_rate?.toString() || '',
      interest_payout_date: h.payout_date_pattern || '', payout_frequency: h.payout_frequency || 'annual',
      issuer_name: h.issuer_name || '', interest_payout_amount: h.interest_payout_amount?.toString() || '',
      folio_number: h.folio_number || '', fund_house: h.fund_house || '',
      scheme_type: h.scheme_type || 'equity', nav_date: h.nav_date || '',
      purchase_nav: h.purchase_nav?.toString() || '', current_nav: h.current_nav?.toString() || '',
      policy_number: h.policy_number || '', insurance_type: h.insurance_type || 'term',
      insurer_name: h.insurer_name || '', sum_assured: h.sum_assured?.toString() || '',
      premium_amount: h.premium_amount?.toString() || '', premium_frequency: h.premium_frequency || 'annual',
      policy_start_date: h.policy_start_date || '', premium_due_date: h.premium_due_date || '',
      nominee_name: h.nominee_name || '',
    });
    setError('');
    setEditHolding(h);
  };

  const handleSave = async () => {
    if (!form.client_id) { setError('Select a client.'); return; }
    if (!form.product_name.trim()) { setError('Product name required.'); return; }
    setError('');
    setSaving(true);

    const isBondSave = BOND_TYPES.includes(form.product_type);
    const isMFSave = form.product_type === 'mutual_fund';
    const isInsSave = form.product_type === 'insurance';

    const isDSAPriceSave = DSA_PRICE_TYPES.includes(form.product_type);
    const selectedClient = clients.find(c => c.id === form.client_id);
    const isClientDSA = selectedClient?.sourced_via === 'dsa';

    const payload: Record<string, unknown> = {
      client_id: form.client_id,
      product_type: form.product_type,
      product_name: form.product_name.trim(),
      txn_date: form.txn_date || null,
      /*
       * Mutual funds now carry an ISIN too. It is what the nightly NAV refresh
       * joins on, so without it a fund holding ages at whatever price was typed
       * on the day it was entered.
       */
      isin:
        (form.product_type === 'unlisted_share' || isBondSave || isMFSave)
          ? (form.isin.trim().toUpperCase() || null)
          : null,
      quantity: parseFloat(form.quantity) || 0,
      avg_cost: parseFloat(form.avg_cost) || 0,
      current_value: parseFloat(form.current_value) || 0,
      invested_amount: parseFloat(form.invested_amount) || 0,
      maturity_date: form.product_type === 'unlisted_share' ? null : (form.maturity_date || null),
      notes: form.notes,
    };

    if (isDSAPriceSave && isClientDSA) {
      Object.assign(payload, {
        dsa_price: parseFloat(form.dsa_price) || null,
        client_price: parseFloat(form.client_price) || null,
      });
    }

    const isLandingCostType = ['unlisted_share', 'secondary_bond', 'primary_bond'].includes(form.product_type);
    if (isLandingCostType) {
      Object.assign(payload, { landing_cost: parseFloat(form.landing_cost) || null });
    }
    if (isMFSave) {
      Object.assign(payload, {
        trail_percent: parseFloat(form.trail_percent) || null,
        trail_start_date: form.trail_start_date || null,
      });
    }
    if (isInsSave) {
      Object.assign(payload, { insurance_revenue: parseFloat(form.insurance_revenue) || null });
    }

    if (isBondSave) {
      Object.assign(payload, {
        isin: form.isin || null,
        face_value: parseFloat(form.face_value) || null,
        coupon_rate: parseFloat(form.coupon_rate) || null,
        payout_date_pattern: form.interest_payout_date || null,
        interest_payout_date: patternToNextISODate(form.interest_payout_date, form.payout_frequency),
        payout_frequency: form.payout_frequency || 'annual',
        interest_payout_amount: parseFloat(form.interest_payout_amount) || null,
        issuer_name: form.issuer_name || null,
      });
    }
    if (isMFSave) {
      Object.assign(payload, {
        folio_number: form.folio_number || null,
        fund_house: form.fund_house || null,
        scheme_type: form.scheme_type || null,
        nav_date: form.nav_date || null,
        purchase_nav: parseFloat(form.purchase_nav) || null,
        current_nav: parseFloat(form.current_nav) || null,
      });
    }
    if (isInsSave) {
      Object.assign(payload, {
        policy_number: form.policy_number || null,
        insurance_type: form.insurance_type || null,
        insurer_name: form.insurer_name || null,
        sum_assured: parseFloat(form.sum_assured) || null,
        premium_amount: parseFloat(form.premium_amount) || null,
        premium_frequency: form.premium_frequency || 'annual',
        policy_start_date: form.policy_start_date || null,
        premium_due_date: form.premium_due_date || null,
        nominee_name: form.nominee_name || null,
      });
    }

    if (editHolding) {
      const { error: err } = await supabase.from('nw_holdings').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editHolding.id);
      if (err) { setError(err.message); setSaving(false); return; }
    } else {
      const { error: err } = await supabase.from('nw_holdings').insert([payload as Insertable<'nw_holdings'>]);
      if (err) { setError(err.message); setSaving(false); return; }
    }

    await updatePortfolioValue(form.client_id);
    setSaving(false);
    setShowAdd(false);
    setEditHolding(null);
    loadHoldings();
  };

  const handleDelete = async () => {
    if (!deleteHolding) return;
    setSaving(true);
    await supabase.from('nw_holdings').delete().eq('id', deleteHolding.id);
    await updatePortfolioValue(deleteHolding.client_id);
    setSaving(false);
    setDeleteHolding(null);
    loadHoldings();
  };

  const clientMap = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);

  // Search applies on the client list only; on the detail view we are already
  // scoped to one client.
  const searchQ = view === 'clients' ? search.trim().toLowerCase() : '';
  const matchesSearch = useCallback((name?: string, code?: string) =>
    !searchQ || (name || '').toLowerCase().includes(searchQ) || (code || '').toLowerCase().includes(searchQ), [searchQ]);

  // The search narrows the holdings that every total below derives from, so the
  // KPI cards, the pie chart and the table always agree.
  const scopedHoldings = useMemo(() => {
    if (!searchQ) return holdings;
    return holdings.filter(h => {
      const c = clientMap.get(h.client_id);
      return matchesSearch(c?.full_name, c?.client_code);
    });
  }, [holdings, clientMap, searchQ, matchesSearch]);

  // Chart data
  const chartData = PRODUCTS.map(p => ({
    label: PRODUCT_LABELS[p],
    value: scopedHoldings.filter(h => h.product_type === p).reduce((s, h) => s + (h.current_value || 0), 0),
    color: PRODUCT_CHART_COLORS[p],
  })).filter(d => d.value > 0);

  const totalValue = scopedHoldings.reduce((s, h) => s + (h.current_value || 0), 0);
  const totalInvested = scopedHoldings.reduce((s, h) => s + (h.invested_amount || 0), 0);
  const gainLoss = totalValue - totalInvested;
  const annualInterest = scopedHoldings
    .filter(h => BOND_TYPES.includes(h.product_type))
    .reduce((s, h) => {
      if (h.face_value && h.coupon_rate && h.quantity) {
        return s + calcPayout(h.face_value, h.coupon_rate, h.quantity, 'annual');
      }
      return s + (h.interest_payout_amount || 0);
    }, 0);

  // One row per client, including clients with no holdings (shown as zeros).
  const clientRows = useMemo(() => {
    const buckets = new Map<string, ClientRow>();
    const blank = (id: string, name: string, code: string, emp?: string): ClientRow => ({
      id, name, code: code || '—', employeeName: emp || 'Unassigned',
      invested: 0, aum: 0, unlisted: 0, bonds: 0, mf: 0, pl: 0, plPct: 0,
    });

    // Seed from the client book so zero-holding clients still get a row.
    // nw_clients RLS already limits employees to their own clients; these
    // filters mirror the ones loadHoldings() applies so both halves agree.
    for (const c of clients) {
      if (!isAdmin && c.employee_id !== employee.id) continue;
      if (isAdmin && empFilter !== 'all' && c.employee_id !== empFilter) continue;
      if (!matchesSearch(c.full_name, c.client_code)) continue;
      buckets.set(c.id, blank(c.id, c.full_name, c.client_code, c.employee?.full_name));
    }

    for (const h of scopedHoldings) {
      let row = buckets.get(h.client_id);
      if (!row) {
        // Holding whose client the clients query didn't return — fall back to
        // the join on the holding itself rather than dropping the money.
        const c = clientMap.get(h.client_id);
        const j = (h as any).client;
        row = blank(h.client_id, c?.full_name || j?.full_name || 'Unknown Client', c?.client_code || j?.client_code || '', c?.employee?.full_name);
        buckets.set(h.client_id, row);
      }
      const value = h.current_value || 0;
      row.invested += h.invested_amount || 0;
      row.aum += value;
      if (h.product_type === 'unlisted_share') row.unlisted += value;
      else if (AUM_BOND_TYPES.includes(h.product_type)) row.bonds += value;
      else if (h.product_type === 'mutual_fund') row.mf += value;
    }

    const rows = [...buckets.values()].map(r => ({
      ...r,
      pl: r.aum - r.invested,
      plPct: r.invested > 0 ? ((r.aum - r.invested) / r.invested) * 100 : 0,
    }));

    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      if (sortKey === 'employee') return a.employeeName.localeCompare(b.employeeName) * dir;
      return (a[sortKey] - b[sortKey]) * dir;
    });
    return rows;
  }, [scopedHoldings, clients, clientMap, isAdmin, employee.id, empFilter, matchesSearch, sortKey, sortDir]);

  const exportClientsCsv = () => {
    const headers = ['Client Name', 'Client Code', 'Employee', 'Total Invested', 'Current AUM', 'Unlisted', 'Bonds', 'Mutual Fund', 'P&L', 'P&L %'];
    const rows = clientRows.map(r => [
      r.name, r.code, r.employeeName,
      r.invested.toFixed(2), r.aum.toFixed(2), r.unlisted.toFixed(2), r.bonds.toFixed(2), r.mf.toFixed(2),
      r.pl.toFixed(2), r.plPct.toFixed(2),
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v ?? ''}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv,' + encodeURIComponent(csv);
    a.download = 'client-portfolio-summary.csv';
    a.click();
  };

  const detailClient = view === 'detail' ? clientMap.get(clientFilter) : undefined;

  const printPortfolio = () => {
    // Open window immediately (synchronous) to avoid popup blocker
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write('<html><head><title>Loading...</title></head><body style="font-family:Arial;padding:40px;color:#555">Generating report...</body></html>');

    const clientInfo = clientFilter !== 'all' ? clients.find(c => c.id === clientFilter) : null;

    // Convert logo to base64 so it embeds correctly in the print window
    const getLogoBase64 = (): Promise<string> => new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 120;
        canvas.height = img.naturalHeight || 120;
        const ctx = canvas.getContext('2d');
        if (ctx) { ctx.drawImage(img, 0, 0); resolve(canvas.toDataURL('image/png')); }
        else resolve('');
      };
      img.onerror = () => resolve('');
      img.src = '/niyomlogo.png';
    });

    getLogoBase64().then(logoBase64 => {

    // Product section color map for print
    const sectionColors: Record<string, string> = {
      unlisted_share: '#7C3AED', secondary_bond: '#0891B2', primary_bond: '#0E7490',
      mutual_fund: '#DB2777', fixed_deposit: '#D97706', insurance: '#EA580C',
    };

    const productSectionsHtml = PRODUCTS.map(pt => {
      const group = holdings.filter(h => h.product_type === pt);
      if (group.length === 0) return '';
      const groupValue = group.reduce((s, h) => s + (h.current_value || 0), 0);
      const groupInvested = group.reduce((s, h) => s + (h.invested_amount || 0), 0);
      const groupPL = groupValue - groupInvested;
      const color = sectionColors[pt] || '#555';

      const extraCols = BOND_TYPES.includes(pt)
        ? '<th>Coupon</th><th>Maturity</th>'
        : pt === 'mutual_fund' ? '<th>Folio No.</th><th>NAV</th>'
        : pt === 'insurance' ? '<th>Policy No.</th><th>Cover</th>'
        : '';

      const rows = group.map((h, i) => {
        const clientForHolding = clients.find(c => c.id === h.client_id);
        const isDsaHolding = clientForHolding?.sourced_via === 'dsa' && DSA_PRICE_TYPES.includes(pt);
        // For DSA clients on applicable types, print shows client_price; otherwise avg_cost
        const displayPrice = isDsaHolding && h.client_price ? h.client_price : (h.avg_cost || 0);
        const pl = (h.current_value || 0) - (h.invested_amount || 0);
        const extraTds = BOND_TYPES.includes(pt)
          ? `<td>${h.coupon_rate ? h.coupon_rate + '% ' + (PAYOUT_FREQ[h.payout_frequency || 'annual'] || '') : '&mdash;'}</td><td>${h.maturity_date ? fmtDate(h.maturity_date) : '&mdash;'}</td>`
          : pt === 'mutual_fund'
          ? `<td>${h.folio_number || '&mdash;'}</td><td>${h.current_nav ? '&#8377;' + h.current_nav : '&mdash;'}</td>`
          : pt === 'insurance'
          ? `<td>${(h as any).policy_number || '&mdash;'}</td><td>${h.sum_assured ? '&#8377;' + (h.sum_assured as number).toLocaleString('en-IN') : '&mdash;'}</td>`
          : '';
        return `<tr>
          <td>${i + 1}</td>
          <td><strong>${h.product_name}</strong>${(h as any).client ? `<br><span style="color:#888;font-size:11px">${(h as any).client.full_name}</span>` : ''}</td>
          <td>${h.quantity || '&mdash;'}</td>
          <td>&#8377;${displayPrice.toLocaleString('en-IN')}</td>
          <td>&#8377;${(h.invested_amount || 0).toLocaleString('en-IN')}</td>
          <td>&#8377;${(h.current_value || 0).toLocaleString('en-IN')}</td>
          <td class="${pl >= 0 ? 'green' : 'red'}">${pl >= 0 ? '+' : ''}&#8377;${Math.abs(pl).toLocaleString('en-IN')}</td>
          ${extraTds}
        </tr>`;
      }).join('');

      return `
        <div class="section-header" style="border-left:4px solid ${color}">
          <span class="section-title" style="color:${color}">${PRODUCT_LABELS[pt]}</span>
          <span class="section-summary">${group.length} holding${group.length > 1 ? 's' : ''} &nbsp;&middot;&nbsp; Value: &#8377;${groupValue.toLocaleString('en-IN')} &nbsp;&middot;&nbsp; <span class="${groupPL >= 0 ? 'green' : 'red'}">${groupPL >= 0 ? '+' : ''}&#8377;${Math.abs(groupPL).toLocaleString('en-IN')}</span></span>
        </div>
        <table>
          <thead><tr><th>#</th><th>Product</th><th>Qty</th><th>Price / Unit</th><th>Invested</th><th>Current Value</th><th>P&amp;L</th>${extraCols}</tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }).join('');

    const logoHtml = logoBase64
      ? `<img src="${logoBase64}" style="width:56px;height:56px;object-fit:contain;" />`
      : `<div style="width:56px;height:56px;background:linear-gradient(135deg,#d4af37,#b8961e);border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:26px;color:#000;font-family:Georgia,serif;">N</div>`;

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Niyom Wealth - Portfolio Report</title>
  <style>
    @page { margin: 20mm 15mm; }
    body { font-family: Arial, sans-serif; background: #fff; color: #111; margin: 0; padding: 0; font-size: 13px; }
    .header { display: flex; align-items: center; gap: 14px; padding-bottom: 16px; border-bottom: 3px solid #d4af37; margin-bottom: 20px; }
    .logo-box { flex-shrink: 0; }
    .brand { font-size: 24px; font-weight: 900; color: #111; letter-spacing: -0.5px; }
    .sub { font-size: 11px; color: #888; margin-top: 2px; letter-spacing: 0.03em; }
    .client-bar { background: #f5f5f5; border-radius: 6px; padding: 10px 14px; margin-bottom: 18px; font-size: 13px; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 24px; }
    .stat { background: #f8f8f8; border-radius: 8px; padding: 12px 14px; border-top: 3px solid #eee; }
    .stat-label { font-size: 9px; color: #999; text-transform: uppercase; letter-spacing: 0.08em; }
    .stat-value { font-size: 17px; font-weight: 800; margin-top: 4px; }
    .section-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #fafafa; margin: 20px 0 0; border-left: 4px solid #ccc; }
    .section-title { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.07em; }
    .section-summary { font-size: 11px; color: #666; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th { background: #f2f2f2; padding: 7px 10px; text-align: left; font-size: 10px; text-transform: uppercase; color: #777; letter-spacing: 0.04em; border-bottom: 1px solid #e0e0e0; }
    td { padding: 8px 10px; border-bottom: 1px solid #f0f0f0; font-size: 12px; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .gold { color: #b8961e; }
    .green { color: #059669; }
    .red { color: #DC2626; }
    .footer { margin-top: 32px; text-align: center; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; }
    .alloc-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .alloc-table td { padding: 6px 10px; font-size: 12px; border-bottom: 1px solid #f5f5f5; }
    .alloc-bar { height: 6px; border-radius: 3px; margin-top: 3px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo-box">${logoHtml}</div>
    <div>
      <div class="brand">Niyom Wealth</div>
      <div class="sub">Portfolio Report &nbsp;&middot;&nbsp; ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
    </div>
  </div>

  ${clientInfo ? `<div class="client-bar"><strong>${clientInfo.full_name}</strong> &nbsp;&middot;&nbsp; Code: ${clientInfo.client_code}</div>` : ''}

  <div class="stats">
    <div class="stat" style="border-top-color:#d4af37"><div class="stat-label">Total Value</div><div class="stat-value gold">&#8377;${totalValue.toLocaleString('en-IN')}</div></div>
    <div class="stat" style="border-top-color:#6b7280"><div class="stat-label">Total Invested</div><div class="stat-value">&#8377;${totalInvested.toLocaleString('en-IN')}</div></div>
    <div class="stat" style="border-top-color:${gainLoss >= 0 ? '#059669' : '#DC2626'}"><div class="stat-label">Gain / Loss</div><div class="stat-value ${gainLoss >= 0 ? 'green' : 'red'}">${gainLoss >= 0 ? '+' : ''}&#8377;${Math.abs(gainLoss).toLocaleString('en-IN')}</div></div>
    <div class="stat" style="border-top-color:#0891B2"><div class="stat-label">Annual Interest</div><div class="stat-value" style="color:#0891B2">&#8377;${annualInterest.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div></div>
  </div>

  ${productSectionsHtml}

  <div class="footer">Niyom Wealth Distribution &nbsp;&middot;&nbsp; Confidential &nbsp;&middot;&nbsp; Generated ${new Date().toLocaleString('en-IN')}</div>
</body>
</html>`;

      w.document.open();
      w.document.write(html);
      w.document.close();
      setTimeout(() => w.print(), 500);
    });
  };

  // interest calc preview for bonds
  const bondInterest = isBond ? (() => {
    const fv = parseFloat(form.face_value) || 0;
    const rate = parseFloat(form.coupon_rate) || 0;
    const qty = parseFloat(form.quantity) || 0;
    const freq = form.payout_frequency || 'annual';
    if (!fv || !rate || !qty) return null;
    return { perPeriod: calcPayout(fv, rate, qty, freq), annual: calcPayout(fv, rate, qty, 'annual') };
  })() : null;

  // S6: next payout dates preview
  const nextPayouts = isBond && form.interest_payout_date
    ? getNextPayouts(form.interest_payout_date, form.payout_frequency)
    : [];

  const pdInfo = payoutDateLabel(form.payout_frequency);
  const selectedClientForForm = clients.find(c => c.id === form.client_id);
  const showDsaPrice = !!(selectedClientForForm?.sourced_via === 'dsa' && DSA_PRICE_TYPES.includes(form.product_type));

  // Form JSX — uses module-level I, Sel, SecHead (no remount on re-render)
  const holdingFormJsx = (
    <div className="p-6 space-y-4">
      {error && <div className="p-3 rounded-xl text-sm text-c-red" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{error}</div>}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Client *">
          <Sel value={form.client_id} onChange={e => setF('client_id', e.target.value)}>
            <option value="">Select client...</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.full_name} ({c.client_code})</option>)}
          </Sel>
        </Field>
        <Field label="Product Type">
          <Sel value={form.product_type} onChange={e => setF('product_type', e.target.value as ProductType)}>
            {PRODUCTS.map(p => <option key={p} value={p}>{PRODUCT_LABELS[p]}</option>)}
          </Sel>
        </Field>
        <Field label="Product Name *">
          <I value={form.product_name} onChange={e => setF('product_name', e.target.value)} placeholder="Product name" />
        </Field>
        <Field label="Date of Transaction" hint="Date when this business was originally done">
          <I type="date" value={form.txn_date} onChange={e => setF('txn_date', e.target.value)} />
        </Field>
        <Field label="Quantity / Units">
          <I type="number" value={form.quantity} onChange={e => setF('quantity', e.target.value)} placeholder="0" />
        </Field>
      </div>

      {/* Unlisted Share specific */}
      {isUnlisted && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="ISIN" hint="12-char code e.g. INE001A01036">
            <I value={form.isin} onChange={e => setF('isin', e.target.value.toUpperCase())} placeholder="INE001A01036" style={{ fontFamily: 'monospace', letterSpacing: '0.05em', textTransform: 'uppercase' }} />
          </Field>
          <Field label="Avg. Buy Price (₹)">
            <I type="number" value={form.avg_cost} onChange={e => setF('avg_cost', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Current Market Price (₹)" hint="Current value = Qty × Current Price">
            <I type="number" value={form.current_price} onChange={e => setF('current_price', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Invested Amount (₹)">
            <I type="number" value={form.invested_amount} onChange={e => setF('invested_amount', e.target.value)} placeholder="Auto: Qty × Buy Price" />
          </Field>
          <Field label="Current Value (₹)">
            <I type="number" value={form.current_value} onChange={e => setF('current_value', e.target.value)} placeholder="Auto: Qty × Curr. Price" />
          </Field>
          {showDsaPrice && (
            <>
              <Field label="DSA Price / Unit (₹)" hint="Price paid to DSA — internal only">
                <I type="number" value={form.dsa_price} onChange={e => setF('dsa_price', e.target.value)} placeholder="0.00" />
              </Field>
              <Field label="Client Price / Unit (₹)" hint="Price shown to client in portfolio print">
                <I type="number" value={form.client_price} onChange={e => setF('client_price', e.target.value)} placeholder="0.00" />
              </Field>
            </>
          )}
          <Field label="Landing Cost / Unit (₹)" hint="Internal acquisition cost (optional) — portfolio record only, does not affect MIS">
            <I type="number" value={form.landing_cost} onChange={e => setF('landing_cost', e.target.value)} placeholder="0.00" />
          </Field>
        </div>
      )}

      {/* Bond-specific section */}
      {isBond && (
        <div className="space-y-4">
          <SecHead icon={Percent} label="Coupon / Interest Details" color="var(--success)" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Issuer Name">
              <I value={form.issuer_name} onChange={e => setF('issuer_name', e.target.value)} placeholder="Issuer / Company" />
            </Field>
            {ISIN_TYPES.includes(form.product_type) && (
              <Field label="ISIN" hint="12-char code e.g. INE001A01036">
                <I value={form.isin} onChange={e => setF('isin', e.target.value.toUpperCase())} placeholder="INE001A01036" style={{ fontFamily: 'monospace', letterSpacing: '0.05em', textTransform: 'uppercase' }} />
              </Field>
            )}
            <Field label="Face Value (₹)">
              <I type="number" value={form.face_value} onChange={e => setF('face_value', e.target.value)} placeholder="1000" />
            </Field>
            <Field label="Coupon Rate (% p.a.)">
              <I type="number" value={form.coupon_rate} onChange={e => setF('coupon_rate', e.target.value)} placeholder="8.50" />
            </Field>
            <Field label="Payout Frequency">
              <Sel value={form.payout_frequency} onChange={e => setF('payout_frequency', e.target.value)}>
                {Object.entries(PAYOUT_FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Sel>
            </Field>
            {/* S6: Smart payout date field */}
            <Field label={pdInfo.label} hint={pdInfo.hint}>
              <I
                value={form.interest_payout_date}
                onChange={e => setF('interest_payout_date', e.target.value)}
                placeholder={pdInfo.placeholder}
              />
            </Field>
            <Field label="Maturity Date">
              <I type="date" value={form.maturity_date} onChange={e => setF('maturity_date', e.target.value)} />
            </Field>
            <Field label="Avg. Purchase Price / Unit (₹)">
              <I type="number" value={form.avg_cost} onChange={e => setF('avg_cost', e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Invested Amount (₹)">
              <I type="number" value={form.invested_amount} onChange={e => setF('invested_amount', e.target.value)} placeholder="Auto: Qty × Price" />
            </Field>
            <Field label="Current Value (₹)">
              <I type="number" value={form.current_value} onChange={e => setF('current_value', e.target.value)} placeholder="Current market value" />
            </Field>
            {showDsaPrice && (
              <>
                <Field label="DSA Price / Unit (₹)" hint="Internal DSA price — not visible to client">
                  <I type="number" value={form.dsa_price} onChange={e => setF('dsa_price', e.target.value)} placeholder="0.00" />
                </Field>
                <Field label="Client Price / Unit (₹)" hint="Price shown to client in portfolio print">
                  <I type="number" value={form.client_price} onChange={e => setF('client_price', e.target.value)} placeholder="0.00" />
                </Field>
              </>
            )}
            {!(['fixed_deposit'].includes(form.product_type)) && (
              <Field label="Landing Cost / Unit (₹)" hint="Internal acquisition cost (optional) — portfolio record only, does not affect MIS">
                <I type="number" value={form.landing_cost} onChange={e => setF('landing_cost', e.target.value)} placeholder="0.00" />
              </Field>
            )}
          </div>
          {/* Interest preview */}
          {bondInterest && (
            <div className="rounded-xl p-4" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)' }}>
              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--success)' }}>Interest Income Preview</p>
              <div className="grid grid-cols-3 gap-4">
                <div><p className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Per {PAYOUT_FREQ[form.payout_frequency]}</p><p className="text-sm font-bold text-text-primary">₹{bondInterest.perPeriod.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p></div>
                <div><p className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Annual Total</p><p className="text-sm font-bold" style={{ color: 'var(--success)' }}>₹{bondInterest.annual.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p></div>
                <div><p className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Coupon Rate</p><p className="text-sm font-bold text-text-primary">{form.coupon_rate}%</p></div>
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
      )}

      {/* Mutual Fund section */}
      {isMF && (
        <div className="space-y-4">
          <SecHead icon={TrendingUp} label="Mutual Fund Details" color="var(--chart-4)" />

          {/*
            The scheme, chosen rather than typed. A name does not identify a
            fund — "SBI Multi Asset Allocation" is fourteen schemes from 29.79
            to 74.54 — so this is what lets the holding be repriced nightly
            instead of ageing at whatever NAV was typed on the day.
          */}
          <Field
            label="Scheme"
            hint="Pick the exact scheme and this holding is repriced automatically every night. Leave blank to keep entering the NAV by hand."
          >
            <SchemePicker
              value={form.isin || null}
              onSelect={(c) => {
                setF('isin', c.isin);
                // The current NAV is known the moment the scheme is; prefilling
                // it saves a lookup and starts the holding at a true price.
                setF('current_nav', String(c.nav));
                setF('nav_date', c.navDate);
                if (!form.product_name.trim()) setF('product_name', c.schemeName);
              }}
              onClear={() => setF('isin', '')}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Fund House / AMC">
              <I value={form.fund_house} onChange={e => setF('fund_house', e.target.value)} placeholder="e.g. HDFC Mutual Fund" />
            </Field>
            <Field label="Folio Number">
              <I value={form.folio_number} onChange={e => setF('folio_number', e.target.value)} placeholder="Folio No." />
            </Field>
            <Field label="Scheme Type">
              <Sel value={form.scheme_type} onChange={e => setF('scheme_type', e.target.value)}>
                {SCHEME_TYPES.map(t => <option key={t} value={t}>{SCHEME_LABELS[t]}</option>)}
              </Sel>
            </Field>
            <Field label="NAV Date">
              <I type="date" value={form.nav_date} onChange={e => setF('nav_date', e.target.value)} />
            </Field>
            <Field label="Purchase NAV (₹)" hint="Invested Amount = Units × Purchase NAV">
              <I type="number" value={form.purchase_nav} onChange={e => setF('purchase_nav', e.target.value)} placeholder="0.0000" />
            </Field>
            <Field label="Current NAV (₹)" hint="Current Value = Units × Current NAV">
              <I type="number" value={form.current_nav} onChange={e => setF('current_nav', e.target.value)} placeholder="0.0000" />
            </Field>
            <Field label="Invested Amount (₹)">
              <I type="number" value={form.invested_amount} onChange={e => setF('invested_amount', e.target.value)} placeholder="Auto from Units × P.NAV" readOnly />
            </Field>
            <Field label="Current Value (₹)">
              <I type="number" value={form.current_value} onChange={e => setF('current_value', e.target.value)} placeholder="Auto from Units × C.NAV" readOnly />
            </Field>
            <Field label="Trail Commission (% p.a.)" hint="Annual trail % — MIS calculated at investment anniversary">
              <I type="number" value={form.trail_percent} onChange={e => setF('trail_percent', e.target.value)} placeholder="e.g. 1.00" />
            </Field>
            <Field label="Investment Date" hint="Start date for trail commission anniversary calculation">
              <I type="date" value={form.trail_start_date} onChange={e => setF('trail_start_date', e.target.value)} />
            </Field>
          </div>
        </div>
      )}

      {/* Insurance section */}
      {isIns && (
        <div className="space-y-4">
          <SecHead icon={Shield} label="Policy Details" color="var(--chart-6)" />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Policy Number">
              <I value={form.policy_number} onChange={e => setF('policy_number', e.target.value)} placeholder="Policy No." />
            </Field>
            <Field label="Insurance Type">
              <Sel value={form.insurance_type} onChange={e => setF('insurance_type', e.target.value)}>
                {INS_TYPES.map(t => <option key={t} value={t}>{INS_LABELS[t]}</option>)}
              </Sel>
            </Field>
            <Field label="Insurer Name">
              <I value={form.insurer_name} onChange={e => setF('insurer_name', e.target.value)} placeholder="Insurance Company" />
            </Field>
            <Field label="Sum Assured (₹)">
              <I type="number" value={form.sum_assured} onChange={e => setF('sum_assured', e.target.value)} placeholder="0" />
            </Field>
            <Field label="Premium Amount (₹)">
              <I type="number" value={form.premium_amount} onChange={e => setF('premium_amount', e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Premium Frequency">
              <Sel value={form.premium_frequency} onChange={e => setF('premium_frequency', e.target.value)}>
                {Object.entries(PREM_FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Sel>
            </Field>
            <Field label="Policy Start Date">
              <I type="date" value={form.policy_start_date} onChange={e => setF('policy_start_date', e.target.value)} />
            </Field>
            <Field label="Maturity Date">
              <I type="date" value={form.maturity_date} onChange={e => setF('maturity_date', e.target.value)} />
            </Field>
            <Field label="Premium Due Date">
              <I type="date" value={form.premium_due_date} onChange={e => setF('premium_due_date', e.target.value)} />
            </Field>
            <Field label="Nominee Name">
              <I value={form.nominee_name} onChange={e => setF('nominee_name', e.target.value)} placeholder="Nominee" />
            </Field>
            <Field label="Invested (Total Premiums Paid) (₹)">
              <I type="number" value={form.invested_amount} onChange={e => setF('invested_amount', e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Current Value (₹)">
              <I type="number" value={form.current_value} onChange={e => setF('current_value', e.target.value)} placeholder="0.00" />
            </Field>
            <Field label="Insurance Revenue (₹)" hint="One-time revenue from this policy — used for MIS">
              <I type="number" value={form.insurance_revenue} onChange={e => setF('insurance_revenue', e.target.value)} placeholder="0.00" />
            </Field>
          </div>
        </div>
      )}

      {/* Fixed Deposit non-bond extras */}
      {form.product_type === 'fixed_deposit' && (
        <div className="grid grid-cols-2 gap-4">
          <Field label="Avg. Purchase Price (₹)">
            <I type="number" value={form.avg_cost} onChange={e => setF('avg_cost', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Invested Amount (₹)">
            <I type="number" value={form.invested_amount} onChange={e => setF('invested_amount', e.target.value)} placeholder="0.00" />
          </Field>
          <Field label="Current Value (₹)">
            <I type="number" value={form.current_value} onChange={e => setF('current_value', e.target.value)} placeholder="0.00" />
          </Field>
        </div>
      )}

      <Field label="Notes">
        <textarea value={form.notes} onChange={e => setF('notes', e.target.value)} rows={2} className="w-full px-3 py-2.5 rounded-xl text-sm text-text-primary outline-none resize-none" style={inputStyle} />
      </Field>
      <div className="flex justify-end gap-3 pt-2">
        <button onClick={() => { setShowAdd(false); setEditHolding(null); }} className="px-4 py-2 rounded-xl text-sm" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
        <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
          {saving ? 'Saving...' : editHolding ? 'Save Changes' : 'Add Holding'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {view === 'detail' && (
            <button onClick={backToClients} className="p-2 rounded-xl flex-shrink-0" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }} title="Back to clients">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Portfolio</p>
            <h1 className="text-2xl font-bold text-text-primary">
              {view === 'detail' ? (detailClient?.full_name || 'Client Portfolio') : 'Portfolio Management'}
            </h1>
            {view === 'detail' && detailClient && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                {detailClient.client_code}{detailClient.employee?.full_name ? ` · ${detailClient.employee.full_name}` : ''}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {view === 'clients' ? (
            <button onClick={exportClientsCsv} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <Download className="w-4 h-4" /> Export CSV
            </button>
          ) : (
            <button onClick={printPortfolio} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <Printer className="w-4 h-4" /> Print PDF
            </button>
          )}
          <button onClick={() => { setForm(emptyForm()); setError(''); setShowAdd(true); }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-on-accent" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            <Plus className="w-4 h-4" /> Add Holding
          </button>
        </div>
      </div>

      {/* Summary cards — client-book totals on the list view, holding totals on detail */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {(view === 'clients' ? [
          { label: 'Total Clients', value: String(clientRows.length), color: 'var(--accent)' },
          { label: 'Total Invested', value: fmt(totalInvested), color: 'var(--text-secondary)' },
          { label: 'Total AUM', value: fmt(totalValue), color: 'var(--chart-5)' },
          { label: gainLoss >= 0 ? 'Total Gain' : 'Total Loss', value: `${gainLoss >= 0 ? '+' : ''}${fmt(gainLoss)}`, color: gainLoss >= 0 ? 'var(--success)' : 'var(--danger)' },
        ] : [
          { label: 'Total Value', value: fmt(totalValue), color: 'var(--accent)' },
          { label: 'Total Invested', value: fmt(totalInvested), color: 'var(--text-secondary)' },
          { label: gainLoss >= 0 ? 'Total Gain' : 'Total Loss', value: `${gainLoss >= 0 ? '+' : ''}${fmt(gainLoss)}`, color: gainLoss >= 0 ? 'var(--success)' : 'var(--danger)' },
          { label: 'Annual Interest Income', value: fmt(annualInterest), color: 'var(--chart-5)' },
        ]).map(s => (
          <div key={s.label} className="rounded-2xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>{s.label}</p>
            <p className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Pie chart + legend */}
      {chartData.length > 0 && (
        <div className="rounded-2xl p-6" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <h2 className="text-sm font-bold text-text-primary mb-5">Product Allocation</h2>
          <div className="flex flex-col sm:flex-row items-center gap-8">
            <div className="flex-shrink-0"><PieChart data={chartData} /></div>
            <div className="flex-1 space-y-3 w-full">
              {chartData.map(d => {
                const pct = totalValue > 0 ? ((d.value / totalValue) * 100).toFixed(1) : '0';
                return (
                  <div key={d.label} className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: d.color }} />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs font-semibold text-text-primary">{d.label}</p>
                        <p className="text-xs font-semibold text-text-primary">{fmt(d.value)} <span style={{ color: 'var(--text-faint)' }}>({pct}%)</span></p>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ background: 'var(--bg-raised)' }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: d.color }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        {isAdmin && view === 'clients' && (
          <div className="relative">
            <select value={empFilter} onChange={e => { setEmpFilter(e.target.value); setClientFilter('all'); }}
              className="pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(var(--accent-rgb),0.4)' }}>
              <option value="all">All Employees</option>
              {empList.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--accent)' }} />
          </div>
        )}
        {view === 'clients' ? (
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client name or code..."
              className="w-full pl-10 pr-3 py-2.5 rounded-xl text-sm text-text-primary outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
          </div>
        ) : (
          <>
            <div className="relative">
              <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
                className="pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                {clients
                  .filter(c => empFilter === 'all' || c.employee_id === empFilter)
                  .map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
            </div>
            <div className="relative">
              <select value={productFilter} onChange={e => setProductFilter(e.target.value)}
                className="pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <option value="all">All Products</option>
                {PRODUCTS.map(p => <option key={p} value={p}>{PRODUCT_LABELS[p]}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
            </div>
          </>
        )}
      </div>

      {/* Client book — one row per client, click to open the full portfolio */}
      {view === 'clients' && (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full nw-table">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {([
                    { key: 'name', label: 'Client', align: 'left' },
                    { key: 'employee', label: 'Employee', align: 'left' },
                    { key: 'invested', label: 'Total Invested', align: 'right' },
                    { key: 'aum', label: 'Current AUM', align: 'right' },
                    { key: 'unlisted', label: 'Unlisted', align: 'right' },
                    { key: 'bonds', label: 'Bonds', align: 'right' },
                    { key: 'mf', label: 'Mutual Fund', align: 'right' },
                    { key: 'pl', label: 'P&L', align: 'right' },
                  ] as { key: ClientSortKey; label: string; align: 'left' | 'right' }[]).map(col => (
                    <th key={col.key} onClick={() => toggleSort(col.key)}
                      className={`px-5 py-3.5 ${col.align === 'right' ? 'text-right' : 'text-left'} text-xs font-semibold uppercase tracking-wider cursor-pointer select-none`}
                      style={{ color: sortKey === col.key ? 'var(--accent)' : 'var(--text-faint)' }}>
                      <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                        {col.label}
                        {sortKey === col.key && (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-12"><LogoLoader size={40} /></td></tr>
                ) : clientRows.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-sm" style={{ color: 'var(--text-faint)' }}>
                    {search ? 'No clients match your search' : 'No clients found'}
                  </td></tr>
                ) : clientRows.map(r => (
                  <tr key={r.id} onClick={() => openClient(r.id)}
                    style={{ borderBottom: '1px solid var(--bg-raised)', cursor: 'pointer' }}>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-semibold text-text-primary">{r.name}</p>
                      <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{r.code}</p>
                    </td>
                    <td className="px-5 py-3.5 text-sm" style={{ color: 'var(--text-secondary)' }}>{r.employeeName}</td>
                    <td className="px-5 py-3.5 text-right text-sm" style={{ color: r.invested > 0 ? 'var(--text-primary)' : 'var(--text-faint)' }}>{fmt(r.invested)}</td>
                    <td className="px-5 py-3.5 text-right text-sm font-bold" style={{ color: r.aum > 0 ? 'var(--text-primary)' : 'var(--text-faint)' }}>{fmt(r.aum)}</td>
                    <td className="px-5 py-3.5 text-right text-sm" style={{ color: r.unlisted > 0 ? 'var(--text-primary)' : 'var(--text-faint)' }}>{r.unlisted > 0 ? fmt(r.unlisted) : '—'}</td>
                    <td className="px-5 py-3.5 text-right text-sm" style={{ color: r.bonds > 0 ? 'var(--text-primary)' : 'var(--text-faint)' }}>{r.bonds > 0 ? fmt(r.bonds) : '—'}</td>
                    <td className="px-5 py-3.5 text-right text-sm" style={{ color: r.mf > 0 ? 'var(--text-primary)' : 'var(--text-faint)' }}>{r.mf > 0 ? fmt(r.mf) : '—'}</td>
                    <td className="px-5 py-3.5 text-right">
                      {r.invested === 0 && r.aum === 0 ? (
                        <span className="text-sm" style={{ color: 'var(--text-faint)' }}>—</span>
                      ) : (
                        <>
                          <p className={`text-sm font-bold ${r.pl >= 0 ? 'text-c-emerald' : 'text-c-red'}`}>{r.pl >= 0 ? '+' : ''}{fmt(r.pl)}</p>
                          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{r.pl >= 0 ? '+' : ''}{r.plPct.toFixed(1)}%</p>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Holdings table (single client) */}
      {view === 'detail' && (
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full nw-table">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['Product', 'Type', 'Key Details', 'Qty', 'Invested', 'Current Value', 'P&L', 'Actions'].map(h => (
                  <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12"><LogoLoader size={40} /></td></tr>
              ) : holdings.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-sm" style={{ color: 'var(--text-faint)' }}>No holdings found</td></tr>
              ) : (() => {
                // Build ISIN groups: key = clientId + isin + productType
                const isinGroupKeys = new Map<string, NWHolding[]>();
                const soloHoldings: NWHolding[] = [];
                for (const h of holdings) {
                  const isin = (h as any).isin;
                  if (isin) {
                    const key = `${h.client_id}::${isin}::${h.product_type}`;
                    const group = isinGroupKeys.get(key) || [];
                    group.push(h);
                    isinGroupKeys.set(key, group);
                  } else {
                    soloHoldings.push(h);
                  }
                }
                // Re-merge: grouped (>1) items first as group rows, singles as normal rows
                const rows: React.ReactNode[] = [];

                const renderHoldingRow = (h: NWHolding, isSubRow = false) => {
                  const pl = (h.current_value || 0) - (h.invested_amount || 0);
                  const plPct = h.invested_amount > 0 ? ((pl / h.invested_amount) * 100).toFixed(1) : '0';
                  const isin = (h as any).isin as string | null;
                  return (
                    <tr key={h.id} style={{ borderBottom: '1px solid var(--bg-raised)', background: isSubRow ? 'var(--bg-elevated)' : 'transparent' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                      onMouseLeave={e => (e.currentTarget.style.background = isSubRow ? 'var(--bg-elevated)' : 'transparent')}>
                      <td className={`py-3.5 ${isSubRow ? 'pl-10 pr-5' : 'px-5'}`}>
                        <p className="text-sm font-medium text-text-primary">{h.product_name}</p>
                        {isSubRow && (h as any).txn_date && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate((h as any).txn_date)}</p>}
                        {!isSubRow && (h as any).client && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{(h as any).client.full_name}</p>}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${PRODUCT_COLORS[h.product_type]}`}>{PRODUCT_LABELS[h.product_type]}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="space-y-0.5">
                          {isin && <p className="text-xs font-mono font-semibold" style={{ color: 'var(--accent)' }}>{isin}</p>}
                          {BOND_TYPES.includes(h.product_type) && h.coupon_rate && (
                            <p className="text-xs text-c-emerald font-semibold">{h.coupon_rate}% · {PAYOUT_FREQ[h.payout_frequency || 'annual']}</p>
                          )}
                          {BOND_TYPES.includes(h.product_type) && h.maturity_date && (
                            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Matures {fmtDate(h.maturity_date)}</p>
                          )}
                          {h.product_type === 'mutual_fund' && h.folio_number && <p className="text-xs text-c-pink font-semibold">{h.folio_number}</p>}
                          {h.product_type === 'mutual_fund' && h.scheme_type && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{SCHEME_LABELS[h.scheme_type] || h.scheme_type}</p>}
                          {h.product_type === 'insurance' && h.policy_number && <p className="text-xs text-c-orange font-semibold">{h.policy_number}</p>}
                          {h.product_type === 'insurance' && h.insurance_type && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{INS_LABELS[h.insurance_type || ''] || h.insurance_type}</p>}
                          {!isin && !BOND_TYPES.includes(h.product_type) && h.product_type !== 'mutual_fund' && h.product_type !== 'insurance' && <span style={{ color: 'var(--text-faint)' }}>—</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-text-primary">{h.quantity || '—'}</td>
                      <td className="px-5 py-3.5 text-sm text-text-primary">{fmt(h.invested_amount || 0)}</td>
                      <td className="px-5 py-3.5 text-sm font-bold text-text-primary">{fmt(h.current_value || 0)}</td>
                      <td className="px-5 py-3.5">
                        <p className={`text-sm font-bold ${pl >= 0 ? 'text-c-emerald' : 'text-c-red'}`}>{pl >= 0 ? '+' : ''}{fmt(pl)}</p>
                        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{pl >= 0 ? '+' : ''}{plPct}%</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(h)} className="p-1.5 rounded-lg" style={{ color: 'var(--text-faint)' }} onMouseEnter={e => (e.currentTarget.style.color = 'rgb(var(--info-soft-rgb))')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => setDeleteHolding(h)} className="p-1.5 rounded-lg" style={{ color: 'var(--text-faint)' }} onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')} onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                };

                // Render ISIN groups (multiple entries for same ISIN)
                for (const [key, group] of isinGroupKeys.entries()) {
                  if (group.length === 1) {
                    // Single holding with ISIN — render normally
                    rows.push(renderHoldingRow(group[0]));
                  } else {
                    // Multiple holdings with same ISIN — render group header + collapsible sub-rows
                    const isin = (group[0] as any).isin;
                    const isExpanded = expandedGroups.has(key);
                    const groupInvested = group.reduce((s, h) => s + (h.invested_amount || 0), 0);
                    const groupValue = group.reduce((s, h) => s + (h.current_value || 0), 0);
                    const groupQty = group.reduce((s, h) => s + (h.quantity || 0), 0);
                    const groupPL = groupValue - groupInvested;
                    const groupPLPct = groupInvested > 0 ? ((groupPL / groupInvested) * 100).toFixed(1) : '0';
                    const sortedGroup = [...group].sort((a, b) => ((a as any).txn_date || a.created_at) < ((b as any).txn_date || b.created_at) ? -1 : 1);

                    rows.push(
                      <tr key={`group-${key}`} style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', cursor: 'pointer' }}
                        onClick={() => toggleGroup(key)}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-raised)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 transition-transform" style={{ color: 'var(--accent)', transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                            <div>
                              <p className="text-sm font-semibold text-text-primary">{group[0].product_name}</p>
                              <p className="text-xs font-mono" style={{ color: 'var(--accent)' }}>{isin} · {group.length} transactions</p>
                              {(group[0] as any).client && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{(group[0] as any).client.full_name}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`text-xs font-semibold px-1.5 py-0.5 rounded border ${PRODUCT_COLORS[group[0].product_type]}`}>{PRODUCT_LABELS[group[0].product_type]}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          {BOND_TYPES.includes(group[0].product_type) && group[0].coupon_rate && (
                            <p className="text-xs text-c-emerald font-semibold">{group[0].coupon_rate}% · {PAYOUT_FREQ[group[0].payout_frequency || 'annual']}</p>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-text-primary font-semibold">{groupQty}</td>
                        <td className="px-5 py-3.5 text-sm text-text-primary">{fmt(groupInvested)}</td>
                        <td className="px-5 py-3.5 text-sm font-bold text-text-primary">{fmt(groupValue)}</td>
                        <td className="px-5 py-3.5">
                          <p className={`text-sm font-bold ${groupPL >= 0 ? 'text-c-emerald' : 'text-c-red'}`}>{groupPL >= 0 ? '+' : ''}{fmt(groupPL)}</p>
                          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{groupPL >= 0 ? '+' : ''}{groupPLPct}%</p>
                        </td>
                        <td className="px-5 py-3.5" />
                      </tr>
                    );
                    if (isExpanded) {
                      sortedGroup.forEach(h => rows.push(renderHoldingRow(h, true)));
                    }
                  }
                }

                // Render non-ISIN holdings
                soloHoldings.forEach(h => rows.push(renderHoldingRow(h)));

                return rows;
              })()}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/*
        The client's own statement, beside the book rather than merged into it.
        The table above is what we sold — priced, editable, and the basis of
        every AUM and MIS figure. This is what they actually hold, including
        funds bought elsewhere, which is precisely why it must not be counted as
        ours. Read-only for the same reason.
      */}
      {view === 'detail' && clientFilter && (
        <div className="mt-6">
          <CasHoldingsPanel clientId={clientFilter} />
        </div>
      )}

      {showAdd && <Modal title="Add Holding" onClose={() => setShowAdd(false)}>{holdingFormJsx}</Modal>}
      {editHolding && <Modal title="Edit Holding" onClose={() => setEditHolding(null)}>{holdingFormJsx}</Modal>}
      {deleteHolding && (
        <Modal title="Delete Holding" onClose={() => setDeleteHolding(null)}>
          <div className="p-6 space-y-4">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Delete holding <span className="text-text-primary font-semibold">{deleteHolding.product_name}</span>? This cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteHolding(null)} className="px-4 py-2 rounded-xl text-sm" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
              <button onClick={handleDelete} disabled={saving} className="px-5 py-2 rounded-xl text-sm font-bold text-text-primary disabled:opacity-50" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
