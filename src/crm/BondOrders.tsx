import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Landmark, Search, RefreshCw, X, Mail, Phone, User, Clock, Inbox, FileText, ExternalLink,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { LogoLoader } from '../components/LogoLoader';
import { NWEmployee } from './types';
import { fmtDate, timeAgo } from './utils';

interface Props {
  employee: NWEmployee;
  onNavigate?: (page: any, params?: any) => void;
}

type OrderStatus = 'submitted' | 'deal_sent' | 'accepted' | 'cancelled';

interface OrderRow {
  id: string;
  ref: string;
  client_id: string;
  bond_id: string | null;
  isin: string;
  bond_name: string;
  units: number;
  price_per_100: number;
  face_value: number | null;
  amount: number | null;
  status: OrderStatus;
  deal_id: string | null;
  notes: string;
  created_at: string;
  client: { full_name: string | null; client_code: string | null; email: string | null; phone: string | null } | null;
}

const STATUSES: Array<{ value: OrderStatus; label: string; color: string }> = [
  { value: 'submitted', label: 'Submitted', color: 'var(--accent)' },
  { value: 'deal_sent', label: 'Deal sent', color: 'var(--info)' },
  { value: 'accepted', label: 'Accepted', color: 'var(--success)' },
  { value: 'cancelled', label: 'Cancelled', color: 'var(--text-muted)' },
];

const inr = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : '₹' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function statusMeta(s: OrderStatus) {
  return STATUSES.find((x) => x.value === s) ?? STATUSES[0];
}

function StatusPill({ status }: { status: OrderStatus }) {
  const m = statusMeta(status);
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 14%, transparent)` }}
    >
      {m.label}
    </span>
  );
}

export default function BondOrders({ employee, onNavigate }: Props) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | OrderStatus>('all');
  const [active, setActive] = useState<OrderRow | null>(null);
  const [saving, setSaving] = useState(false);

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase
      .from('nw_bond_orders')
      .select('*, client:nw_clients(full_name, client_code, email, phone)')
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    setOrders((data as unknown as OrderRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length, submitted: 0, deal_sent: 0, accepted: 0, cancelled: 0 };
    orders.forEach((o) => { c[o.status] = (c[o.status] ?? 0) + 1; });
    return c;
  }, [orders]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter !== 'all' && o.status !== filter) return false;
      if (!q) return true;
      return (
        o.ref.toLowerCase().includes(q) ||
        o.bond_name.toLowerCase().includes(q) ||
        o.isin.toLowerCase().includes(q) ||
        (o.client?.full_name ?? '').toLowerCase().includes(q) ||
        (o.client?.client_code ?? '').toLowerCase().includes(q)
      );
    });
  }, [orders, filter, search]);

  const updateStatus = async (o: OrderRow, status: OrderStatus) => {
    setSaving(true);
    const { error: err } = await supabase.from('nw_bond_orders').update({ status }).eq('id', o.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, status } : x)));
    setActive((prev) => (prev && prev.id === o.id ? { ...prev, status } : prev));
  };

  // "Prepare Deal Confirmation" — open the Deal Confirmation create form pre-filled
  // from this order. base_rate is the price per single bond (face × price/₹100).
  const prepareDeal = (o: OrderRow) => {
    if (!onNavigate) return;
    const face = Number(o.face_value) || 100;
    const perUnit = Math.round((face * Number(o.price_per_100)) / 100 * 100) / 100;
    onNavigate('deal_confirmation', {
      bondOrderId: o.id,
      prefillRef: o.ref,
      prefillClientId: o.client_id,
      prefillType: 'Buy',
      prefillProduct: 'Secondary Bond',
      prefillSecurity: o.bond_name,
      prefillIsin: o.isin,
      prefillQty: String(o.units),
      prefillRate: String(perUnit),
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Fixed Income</p>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Landmark className="w-6 h-6" style={{ color: 'var(--accent)' }} /> Bond Orders
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {isAdmin ? 'All bond orders placed by clients from the wealth portal.' : 'Bond orders placed by your clients from the wealth portal.'}
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl text-sm text-c-red" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-faint)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ref, bond, ISIN or client..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-text-primary outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['all', 'submitted', 'deal_sent', 'accepted', 'cancelled'] as const).map((val) => {
            const labelMap: Record<string, string> = { all: 'All', submitted: 'Submitted', deal_sent: 'Deal sent', accepted: 'Accepted', cancelled: 'Cancelled' };
            const activeChip = filter === val;
            return (
              <button
                key={val}
                onClick={() => setFilter(val)}
                className="px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                style={activeChip
                  ? { background: 'rgba(var(--accent-rgb),0.15)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.3)' }
                  : { background: 'var(--bg-raised)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
              >
                {labelMap[val]} <span style={{ opacity: 0.6 }}>({counts[val] ?? 0})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <LogoLoader size={48} />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center" style={{ color: 'var(--text-muted)' }}>
            <Inbox className="w-8 h-8" />
            <p className="text-sm">No orders{filter !== 'all' ? ` with status “${filter.replace('_', ' ')}”` : ''} yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full nw-table">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Ref', 'Client', 'Bond', 'Qty', 'Indicative', 'Status', 'Placed', ''].map((h) => (
                    <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => setActive(o)}
                    className="cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <td className="px-5 py-3.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{o.ref}</td>
                    <td className="px-5 py-3.5">
                      <div className="text-sm font-semibold text-text-primary">{o.client?.full_name ?? '—'}</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{o.client?.client_code ?? ''}</div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-text-primary max-w-xs truncate">{o.bond_name || o.isin}</td>
                    <td className="px-5 py-3.5 text-sm" style={{ color: 'var(--text-secondary)' }}>{o.units}</td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-text-primary">{inr(o.amount)}</td>
                    <td className="px-5 py-3.5"><StatusPill status={o.status} /></td>
                    <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-muted)' }}>{timeAgo(o.created_at)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setActive(o); }}
                        className="text-xs font-semibold"
                        style={{ color: 'var(--accent)' }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {active && (
        <div className="fixed inset-0 z-[70] flex justify-end" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={() => setActive(null)}>
          <div
            className="h-full w-full max-w-md overflow-y-auto p-6"
            style={{ background: 'var(--bg-base)', borderLeft: '1px solid var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="font-mono text-xs" style={{ color: 'var(--text-faint)' }}>{active.ref}</span>
                <h2 className="mt-1 text-lg font-bold text-text-primary">{active.bond_name || active.isin}</h2>
                <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <Clock className="w-3 h-3" /> {fmtDate(active.created_at)}
                  <span>·</span>
                  <StatusPill status={active.status} />
                </div>
              </div>
              <button onClick={() => setActive(null)} style={{ color: 'var(--text-secondary)' }}><X className="w-5 h-5" /></button>
            </div>

            {/* Client card */}
            <div className="mt-5 rounded-xl p-4 space-y-2" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <User className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                {active.client?.full_name ?? '—'}
                {active.client?.client_code && <span className="text-[11px] font-normal" style={{ color: 'var(--text-faint)' }}>· {active.client.client_code}</span>}
              </div>
              {active.client?.email && (
                <a href={`mailto:${active.client.email}?subject=Re: ${encodeURIComponent(active.ref + ' — ' + active.bond_name)}`}
                  className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <Mail className="w-3.5 h-3.5" /> {active.client.email}
                </a>
              )}
              {active.client?.phone && (
                <a href={`tel:${active.client.phone}`} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <Phone className="w-3.5 h-3.5" /> {active.client.phone}
                </a>
              )}
            </div>

            {/* Order figures */}
            <div className="mt-4 rounded-xl p-4 space-y-2.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <DrawerRow label="ISIN" value={active.isin || '—'} mono />
              <DrawerRow label="Quantity" value={`${active.units} unit${active.units === 1 ? '' : 's'}`} />
              <DrawerRow label="Face value" value={inr(active.face_value)} />
              <DrawerRow label="Client price / ₹100" value={inr(active.price_per_100)} />
              <div className="border-t pt-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
                <DrawerRow label="Indicative amount" value={inr(active.amount)} strong />
              </div>
              {active.notes && (
                <p className="pt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Note: {active.notes}</p>
              )}
            </div>

            {/* Prepare deal confirmation */}
            <button
              onClick={() => prepareDeal(active)}
              className="mt-5 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-on-accent"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              <FileText className="w-4 h-4" /> {active.deal_id ? 'Prepare another deal confirmation' : 'Prepare Deal Confirmation'}
            </button>
            <p className="mt-2 text-[11px] text-center" style={{ color: 'var(--text-faint)' }}>
              Opens the deal form pre-filled with this order. You can adjust the price and quantity before sending.
            </p>
            {active.deal_id && onNavigate && (
              <button
                onClick={() => onNavigate('deal_confirmation')}
                className="mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-semibold"
                style={{ color: 'var(--accent)' }}
              >
                <ExternalLink className="w-3.5 h-3.5" /> A deal confirmation is already linked — open Deal Confirmations
              </button>
            )}

            {/* Status control */}
            <div className="mt-6">
              <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>Update status</p>
              <div className="grid grid-cols-2 gap-2">
                {STATUSES.map((s) => {
                  const on = active.status === s.value;
                  return (
                    <button
                      key={s.value}
                      disabled={saving}
                      onClick={() => updateStatus(active, s.value)}
                      className="px-3 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                      style={on
                        ? { color: s.color, background: `color-mix(in srgb, ${s.color} 16%, transparent)`, border: `1px solid ${s.color}` }
                        : { color: 'var(--text-muted)', background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DrawerRow({ label, value, strong, mono }: { label: string; value: string; strong?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span
        className={`text-right ${mono ? 'font-mono text-xs' : strong ? 'text-sm font-bold' : 'text-xs font-semibold'} text-text-primary`}
      >
        {value}
      </span>
    </div>
  );
}
