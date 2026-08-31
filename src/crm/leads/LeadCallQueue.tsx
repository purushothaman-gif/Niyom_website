import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { NWEmployee } from '../types';
import {
  Copy, Check, ChevronLeft, ChevronRight, RefreshCw, ExternalLink,
  MessageCircle, PhoneCall, CalendarClock, Inbox, MapPin, ArrowUpDown,
} from 'lucide-react';
import { NWLead, LeadStatus } from './leadTypes';
import { QUEUE_OUTCOMES, QUEUE_STATUS_OPTIONS } from './leadConstants';
import { StatusBadge, Select, Input } from './leadUi';
import { isAdminRole, formatMoney, relativeTime, initials } from './leadUtils';

const LEAD_SELECT =
  '*, owner:nw_employees!nw_leads_owner_employee_id_fkey(full_name, employee_code), ' +
  'created_by:nw_employees!nw_leads_created_by_employee_id_fkey(full_name, employee_code)';

// Compact queue page: PAGE_SIZE rows worked top-to-bottom.
const QUEUE_SIZE = 25;

type Scope = 'work' | 'uncontacted' | 'interested' | 'followup' | 'whatsapp' | 'email' | 'meeting' | 'callback' | 'all';

// Scopes that simply filter by a status.
const STATUS_SCOPES: Partial<Record<Scope, LeadStatus>> = {
  interested: 'Interested', followup: 'Follow-up', whatsapp: 'WhatsApp Sent',
  email: 'Email Sent', meeting: 'Meeting Scheduled', callback: 'Call Back Later',
};

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'work', label: 'Work List' },
  { key: 'uncontacted', label: 'Not Yet Called' },
  { key: 'interested', label: 'Interested' },
  { key: 'followup', label: 'Follow-up' },
  { key: 'whatsapp', label: 'WhatsApp Sent' },
  { key: 'email', label: 'Email Sent' },
  { key: 'meeting', label: 'Meeting Scheduled' },
  { key: 'callback', label: 'Call Back Later' },
  { key: 'all', label: 'All My Active' },
];

type SortKey = 'smart' | 'location' | 'name' | 'score';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'smart', label: 'Not-called first' },
  { key: 'location', label: 'Location (State, City)' },
  { key: 'name', label: 'Name (A–Z)' },
  { key: 'score', label: 'Score (high→low)' },
];

interface Draft { status: LeadStatus; outcome: string; remarks: string; next: string; saved: boolean; saving: boolean; }

interface Props {
  employee: NWEmployee;
  refreshKey: number;
  onOpenLead: (leadId: string) => void;
}

export default function LeadCallQueue({ employee, refreshKey, onOpenLead }: Props) {
  const isAdmin = isAdminRole(employee);
  const [scope, setScope] = useState<Scope>('work');
  const [sort, setSort] = useState<SortKey>('smart');
  const [leads, setLeads] = useState<NWLead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [workedToday, setWorkedToday] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const buildQuery = useCallback((forCount: boolean) => {
    let q = supabase.from('nw_leads').select(forCount ? 'id' : LEAD_SELECT, forCount ? { count: 'exact', head: true } : { count: 'exact' })
      .eq('owner_employee_id', employee.id)
      .eq('is_archived', false)
      .neq('status', 'Closed - Converted');
    if (scope === 'work') q = q.not('status', 'in', '("Closed - Rejected","Lost","Not Interested","Wrong Number")');
    else if (scope === 'uncontacted') q = q.is('first_call_at', null);
    else if (STATUS_SCOPES[scope]) q = q.eq('status', STATUS_SCOPES[scope]!);
    return q;
  }, [employee.id, scope]);

  const applySort = useCallback((q: any) => {
    if (sort === 'location') return q.order('state', { ascending: true }).order('city', { ascending: true }).order('lead_name', { ascending: true });
    if (sort === 'name') return q.order('lead_name', { ascending: true });
    if (sort === 'score') return q.order('lead_score', { ascending: false });
    return q.order('first_call_at', { ascending: true, nullsFirst: true }).order('lead_score', { ascending: false }); // smart
  }, [sort]);

  const load = useCallback(async () => {
    setLoading(true);
    const q = applySort(buildQuery(false))
      .range(page * QUEUE_SIZE, (page + 1) * QUEUE_SIZE - 1);
    const { data, count } = await q;
    const rows = (data as unknown as NWLead[]) || [];
    setLeads(rows);
    setTotal(count ?? 0);
    // Seed a draft per row (status pre-set to the lead's current status).
    const seed: Record<string, Draft> = {};
    rows.forEach(l => { seed[l.id] = { status: l.status, outcome: '', remarks: '', next: '', saved: false, saving: false }; });
    setDrafts(seed);
    setLoading(false);
  }, [buildQuery, page, applySort]);

  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => { setPage(0); }, [scope, sort]);

  // "Worked today" = calls I logged since midnight.
  useEffect(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    supabase.from('nw_lead_communications').select('id', { count: 'exact', head: true })
      .eq('employee_id', employee.id).gte('created_at', start.toISOString())
      .then(({ count }) => setWorkedToday(count ?? 0));
  }, [employee.id, refreshKey]);

  const patchDraft = (id: string, p: Partial<Draft>) => setDrafts(d => ({ ...d, [id]: { ...d[id], ...p } }));

  const copyNumber = async (id: string, num: string) => {
    try { await navigator.clipboard.writeText(num); setCopiedId(id); setTimeout(() => setCopiedId(c => c === id ? null : c), 1200); } catch { /* ignore */ }
  };

  const dirty = (l: NWLead, d: Draft) => !!d.outcome || !!d.remarks.trim() || d.status !== l.status || !!d.next;

  const saveRow = async (l: NWLead, focusNextId?: string) => {
    const d = drafts[l.id];
    if (!d || !dirty(l, d)) return;
    patchDraft(l.id, { saving: true });
    try {
      // Communication (the response). comm_type defaults to 'call' — they dial
      // from their own phone; this just records the outcome + remarks.
      if (d.outcome || d.remarks.trim()) {
        await supabase.from('nw_lead_communications').insert([{
          lead_id: l.id, employee_id: employee.id, comm_type: 'call',
          outcome: d.outcome, remarks: d.remarks.trim(), direction: 'outbound',
        }]);
        await supabase.from('nw_lead_activities').insert([{
          lead_id: l.id, employee_id: employee.id, action: 'Called',
          description: `${d.outcome || 'Logged'}${d.remarks.trim() ? ' — ' + d.remarks.trim() : ''}`,
        }]);
      }
      if (d.status && d.status !== l.status) {
        await supabase.from('nw_leads').update({ status: d.status }).eq('id', l.id);
        await supabase.from('nw_lead_activities').insert([{
          lead_id: l.id, employee_id: employee.id, action: 'Status Changed', description: `${l.status} → ${d.status}`,
        }]);
      }
      if (d.next) {
        await supabase.from('nw_lead_followups').insert([{
          lead_id: l.id, employee_id: employee.id, scheduled_at: new Date(d.next).toISOString(),
          priority: l.priority, mode: 'phone', purpose: 'Call back', reminder_minutes: 30,
        }]);
        await supabase.from('nw_lead_activities').insert([{
          lead_id: l.id, employee_id: employee.id, action: 'Follow-up Added',
          description: `Call back ${new Date(d.next).toLocaleString('en-IN')}`,
        }]);
      }
      // Reflect locally: mark saved, update the row's status.
      setLeads(ls => ls.map(x => x.id === l.id ? { ...x, status: d.status } : x));
      patchDraft(l.id, { saved: true, saving: false });
      setWorkedToday(n => n + (d.outcome || d.remarks.trim() ? 1 : 0));
      if (focusNextId) setTimeout(() => rowRefs.current[focusNextId]?.focus(), 50);
    } catch {
      patchDraft(l.id, { saving: false });
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / QUEUE_SIZE));
  const savedCount = leads.filter(l => drafts[l.id]?.saved).length;

  return (
    <div className="space-y-4">
      {/* Progress + scope */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {SCOPES.map(s => {
            const active = scope === s.key;
            return (
              <button key={s.key} onClick={() => setScope(s.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all"
                style={{ background: active ? 'rgba(var(--accent-rgb),0.12)' : 'var(--bg-elevated)', color: active ? 'var(--accent)' : 'var(--text-secondary)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}` }}>
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <ArrowUpDown className="w-3.5 h-3.5" style={{ color: 'var(--text-faint)' }} />
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
              className="text-xs font-semibold bg-transparent outline-none cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="text-xs px-3 py-1.5 rounded-lg" style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.25)' }}>
            <PhoneCall className="w-3.5 h-3.5 inline mr-1" /> {workedToday} logged today
          </div>
          <button onClick={load} className="p-2 rounded-lg" title="Refresh" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
        Dial each number from your phone, then log the response right here — no need to open the lead. Press <kbd className="px-1 rounded" style={{ background: 'var(--bg-raised)' }}>Enter</kbd> in Remarks to save and jump to the next row.
      </p>

      {/* Queue */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        {loading ? (
          <div className="flex justify-center py-16"><RefreshCw className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} /></div>
        ) : leads.length === 0 ? (
          <div className="text-center py-16">
            <Inbox className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Nothing to call in this list.</p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {leads.map((l, idx) => {
              const d = drafts[l.id] || { status: l.status, outcome: '', remarks: '', next: '', saved: false, saving: false };
              const nextId = leads[idx + 1]?.id;
              const canSave = dirty(l, d) && !d.saving;
              return (
                <div key={l.id} className="p-3" style={{ background: d.saved ? 'rgba(16,185,129,0.05)' : 'transparent', opacity: d.saved ? 0.75 : 1 }}>
                  <div className="flex items-start gap-3 flex-wrap lg:flex-nowrap">
                    {/* Index + identity */}
                    <div className="flex items-center gap-2.5 w-full lg:w-52 flex-shrink-0">
                      <span className="text-[11px] font-mono w-6 text-right flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{page * QUEUE_SIZE + idx + 1}</span>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold flex-shrink-0" style={{ background: d.saved ? 'rgba(16,185,129,0.15)' : 'rgba(var(--accent-rgb),0.1)', color: d.saved ? 'var(--success)' : 'var(--accent)' }}>
                        {d.saved ? <Check className="w-4 h-4" /> : initials(l.lead_name)}
                      </div>
                      <button onClick={() => onOpenLead(l.id)} className="min-w-0 text-left group">
                        <p className="text-sm font-semibold truncate flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                          {l.lead_name} <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-60 flex-shrink-0" />
                        </p>
                        <p className="text-[11px] flex items-center gap-1 truncate" style={{ color: 'var(--text-faint)' }}>
                          <MapPin className="w-3 h-3 flex-shrink-0" />{[l.city, l.state].filter(Boolean).join(', ') || 'No location'}
                        </p>
                        <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{formatMoney(l.investment_capacity)} · {relativeTime(l.last_activity_at || l.created_at)}</p>
                      </button>
                    </div>

                    {/* Big number + dial/copy/whatsapp */}
                    <div className="flex items-center gap-2 w-full lg:w-64 flex-shrink-0">
                      <a href={`tel:${l.mobile}`} className="font-mono text-base font-bold tracking-wide" style={{ color: 'var(--text-primary)' }} title="Tap to dial (mobile)">
                        {l.mobile || '—'}
                      </a>
                      {l.mobile && (
                        <>
                          <button onClick={() => copyNumber(l.id, l.mobile)} title="Copy number" className="p-1.5 rounded-lg" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: copiedId === l.id ? 'var(--success)' : 'var(--text-faint)' }}>
                            {copiedId === l.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                          <a href={`https://wa.me/91${l.mobile}`} target="_blank" rel="noreferrer" title="WhatsApp" className="p-1.5 rounded-lg" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'rgb(37,211,102)' }}>
                            <MessageCircle className="w-3.5 h-3.5" />
                          </a>
                        </>
                      )}
                    </div>

                    {/* Inline response logging */}
                    <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap sm:flex-nowrap">
                      <Select value={d.outcome} onChange={e => patchDraft(l.id, { outcome: e.target.value })} style={{ width: '9.5rem', flexShrink: 0 }} title="Call outcome">
                        <option value="">— Outcome —</option>
                        {QUEUE_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                      </Select>
                      <Select value={d.status} onChange={e => patchDraft(l.id, { status: e.target.value as LeadStatus })} style={{ width: '10rem', flexShrink: 0 }} title="Set status">
                        {/* keep the lead's current status selectable even if it's outside the queue set */}
                        {!QUEUE_STATUS_OPTIONS.includes(l.status) && <option value={l.status}>{l.status}</option>}
                        {QUEUE_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </Select>
                      <input
                        ref={el => { rowRefs.current[l.id] = el; }}
                        value={d.remarks}
                        onChange={e => patchDraft(l.id, { remarks: e.target.value })}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveRow(l, nextId); } }}
                        placeholder="Remarks…"
                        className="flex-1 min-w-[8rem] px-3 py-2.5 rounded-xl text-sm outline-none"
                        style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                      />
                      <div className="flex items-center gap-1 flex-shrink-0" title="Schedule a call back">
                        <CalendarClock className="w-4 h-4" style={{ color: 'var(--text-faint)' }} />
                        <Input type="datetime-local" value={d.next} onChange={e => patchDraft(l.id, { next: e.target.value })} style={{ width: '12.5rem', padding: '0.5rem 0.6rem' }} />
                      </div>
                      <button onClick={() => saveRow(l, nextId)} disabled={!canSave}
                        className="px-3 py-2.5 rounded-xl text-sm font-bold flex-shrink-0 disabled:opacity-40"
                        style={{ background: d.saved ? 'var(--bg-raised)' : 'linear-gradient(135deg, var(--accent), var(--accent-strong))', color: d.saved ? 'var(--text-secondary)' : 'var(--text-on-accent)' }}>
                        {d.saving ? '…' : d.saved ? 'Saved ✓' : 'Save'}
                      </button>
                    </div>
                  </div>
                  {/* current status chip (compact reference) */}
                  <div className="mt-1.5 pl-8 lg:pl-14 flex items-center gap-2">
                    <StatusBadge status={l.status} small />
                    {l.first_call_at == null && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(249,115,22,0.12)', color: 'rgb(249,115,22)' }}>Not yet called</span>}
                    {isAdmin && l.owner && <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{l.owner.full_name}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pager */}
        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              Page {page + 1} / {totalPages} · {savedCount}/{leads.length} logged on this page · {total.toLocaleString('en-IN')} in list
            </p>
            <div className="flex items-center gap-1">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-lg disabled:opacity-30" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}><ChevronLeft className="w-4 h-4" /></button>
              <button disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-lg disabled:opacity-30" style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
