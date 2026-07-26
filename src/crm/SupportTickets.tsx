import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LifeBuoy, Search, RefreshCw, X, Mail, Phone, User, Clock, Loader2, Inbox,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { NWEmployee } from './types';
import { fmtDate, timeAgo } from './utils';

interface Props {
  employee: NWEmployee;
  onNavigate?: (page: any, params?: any) => void;
}

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

interface TicketRow {
  id: string;
  ref: string;
  client_id: string;
  category: string;
  subject: string;
  message: string;
  status: TicketStatus;
  priority: string;
  created_at: string;
  updated_at: string;
  client: { full_name: string | null; client_code: string | null; email: string | null; phone: string | null } | null;
}

const STATUSES: Array<{ value: TicketStatus; label: string; color: string }> = [
  { value: 'open', label: 'Open', color: 'var(--info)' },
  { value: 'in_progress', label: 'In progress', color: 'var(--accent)' },
  { value: 'resolved', label: 'Resolved', color: 'var(--success)' },
  { value: 'closed', label: 'Closed', color: 'var(--text-muted)' },
];

const CATEGORY_LABEL: Record<string, string> = {
  general: 'General', transaction: 'Transaction', kyc: 'KYC', bank: 'Bank', technical: 'Technical', feedback: 'Feedback',
};

function statusMeta(s: TicketStatus) {
  return STATUSES.find((x) => x.value === s) ?? STATUSES[0];
}

function StatusPill({ status }: { status: TicketStatus }) {
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

export default function SupportTickets({ employee }: Props) {
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | TicketStatus>('all');
  const [active, setActive] = useState<TicketRow | null>(null);
  const [saving, setSaving] = useState(false);

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase
      .from('nw_support_tickets')
      .select('*, client:nw_clients(full_name, client_code, email, phone)')
      .order('created_at', { ascending: false });
    if (err) setError(err.message);
    setTickets((data as TicketRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tickets.length, open: 0, in_progress: 0, resolved: 0, closed: 0 };
    tickets.forEach((t) => { c[t.status] = (c[t.status] ?? 0) + 1; });
    return c;
  }, [tickets]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (filter !== 'all' && t.status !== filter) return false;
      if (!q) return true;
      return (
        t.ref.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        (t.client?.full_name ?? '').toLowerCase().includes(q) ||
        (t.client?.client_code ?? '').toLowerCase().includes(q)
      );
    });
  }, [tickets, filter, search]);

  const updateStatus = async (t: TicketRow, status: TicketStatus) => {
    setSaving(true);
    const { error: err } = await supabase.from('nw_support_tickets').update({ status }).eq('id', t.id);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setTickets((prev) => prev.map((x) => (x.id === t.id ? { ...x, status } : x)));
    setActive((prev) => (prev && prev.id === t.id ? { ...prev, status } : prev));
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Client Support</p>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <LifeBuoy className="w-6 h-6" style={{ color: 'var(--accent)' }} /> Support Tickets
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {isAdmin ? 'All client tickets raised from the wealth portal.' : 'Tickets raised by your clients from the wealth portal.'}
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
            placeholder="Search ref, subject or client..."
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-text-primary outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['all', 'open', 'in_progress', 'resolved', 'closed'] as const).map((val) => {
            const labelMap: Record<string, string> = { all: 'All', open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
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
          <div className="flex items-center justify-center py-16" style={{ color: 'var(--text-muted)' }}>
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center" style={{ color: 'var(--text-muted)' }}>
            <Inbox className="w-8 h-8" />
            <p className="text-sm">No tickets{filter !== 'all' ? ` with status “${filter.replace('_', ' ')}”` : ''} yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full nw-table">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Ref', 'Client', 'Category', 'Subject', 'Status', 'Raised', ''].map((h) => (
                    <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setActive(t)}
                    className="cursor-pointer transition-colors"
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  >
                    <td className="px-5 py-3.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{t.ref}</td>
                    <td className="px-5 py-3.5">
                      <div className="text-sm font-semibold text-text-primary">{t.client?.full_name ?? '—'}</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{t.client?.client_code ?? ''}</div>
                    </td>
                    <td className="px-5 py-3.5 text-sm" style={{ color: 'var(--text-secondary)' }}>{CATEGORY_LABEL[t.category] ?? t.category}</td>
                    <td className="px-5 py-3.5 text-sm text-text-primary max-w-xs truncate">{t.subject}</td>
                    <td className="px-5 py-3.5"><StatusPill status={t.status} /></td>
                    <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-muted)' }}>{timeAgo(t.created_at)}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); setActive(t); }}
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
                <h2 className="mt-1 text-lg font-bold text-text-primary">{active.subject}</h2>
                <div className="mt-1 flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>{CATEGORY_LABEL[active.category] ?? active.category}</span>
                  <span>·</span>
                  <Clock className="w-3 h-3" /> {fmtDate(active.created_at)}
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
                <a href={`mailto:${active.client.email}?subject=Re: ${encodeURIComponent(active.ref + ' — ' + active.subject)}`}
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

            {/* Message */}
            <div className="mt-4">
              <p className="text-xs uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-faint)' }}>Message</p>
              <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{active.message}</p>
            </div>

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
