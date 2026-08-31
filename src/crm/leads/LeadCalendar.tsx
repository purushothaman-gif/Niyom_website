import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { NWEmployee } from '../types';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { NWLeadFollowup, LeadCategory } from './leadTypes';

interface FRow extends NWLeadFollowup { lead?: { id: string; lead_name: string; lead_code: string } | null; }
type View = 'month' | 'week' | 'day';

interface Props {
  employee: NWEmployee;
  category: LeadCategory;
  refreshKey: number;
  onOpenLead: (leadId: string) => void;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function eventColor(f: FRow): string {
  if (f.status === 'completed') return '16,185,129';
  if (f.status === 'missed') return '148,163,184';
  const t = new Date(f.scheduled_at).getTime();
  if (t < Date.now()) return '239,68,68';
  if (sameDay(new Date(f.scheduled_at), new Date())) return '249,115,22';
  return '59,130,246';
}

export default function LeadCalendar({ category, refreshKey, onOpenLead }: Props) {
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(startOfDay(new Date()));
  const [rows, setRows] = useState<FRow[]>([]);

  // Visible date window per view.
  const range = useMemo(() => {
    if (view === 'day') return { start: startOfDay(cursor), end: addDays(startOfDay(cursor), 1) };
    if (view === 'week') { const s = addDays(cursor, -cursor.getDay()); return { start: startOfDay(s), end: addDays(startOfDay(s), 7) }; }
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = addDays(first, -first.getDay());
    return { start: gridStart, end: addDays(gridStart, 42) };
  }, [view, cursor]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('nw_lead_followups')
      .select('*, lead:nw_leads!inner(id, lead_name, lead_code, lead_category)')
      .eq('lead.lead_category', category)
      .gte('scheduled_at', range.start.toISOString())
      .lt('scheduled_at', range.end.toISOString())
      .order('scheduled_at', { ascending: true }).limit(500);
    setRows((data as unknown as FRow[]) || []);
  }, [range.start, range.end, category]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const eventsFor = (day: Date) => rows.filter(r => sameDay(new Date(r.scheduled_at), day));
  const move = (dir: number) => {
    if (view === 'day') setCursor(c => addDays(c, dir));
    else if (view === 'week') setCursor(c => addDays(c, dir * 7));
    else setCursor(c => new Date(c.getFullYear(), c.getMonth() + dir, 1));
  };

  const title = view === 'day'
    ? cursor.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => move(-1)} className="p-2 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => setCursor(startOfDay(new Date()))} className="px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>Today</button>
          <button onClick={() => move(1)} className="p-2 rounded-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}><ChevronRight className="w-4 h-4" /></button>
          <h2 className="text-sm font-bold ml-2" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        </div>
        <div className="flex items-center rounded-xl p-0.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          {(['month', 'week', 'day'] as View[]).map(v => (
            <button key={v} onClick={() => setView(v)} className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize"
              style={{ background: view === v ? 'var(--accent)' : 'transparent', color: view === v ? 'var(--text-on-accent)' : 'var(--text-faint)' }}>{v}</button>
          ))}
        </div>
      </div>

      {view === 'month' && (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <div className="grid grid-cols-7">
            {DAYS.map(d => <div key={d} className="px-2 py-2 text-[11px] font-bold text-center" style={{ color: 'var(--text-faint)', borderBottom: '1px solid var(--border)' }}>{d}</div>)}
            {Array.from({ length: 42 }).map((_, i) => {
              const day = addDays(range.start, i);
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = sameDay(day, new Date());
              const evs = eventsFor(day);
              return (
                <div key={i} className="min-h-[92px] p-1.5" style={{ borderBottom: '1px solid var(--border-subtle)', borderRight: (i % 7 !== 6) ? '1px solid var(--border-subtle)' : undefined, background: inMonth ? 'transparent' : 'var(--bg-base)', opacity: inMonth ? 1 : 0.5 }}>
                  <div className="flex justify-end">
                    <span className="text-[11px] font-semibold w-5 h-5 flex items-center justify-center rounded-full" style={{ background: isToday ? 'var(--accent)' : 'transparent', color: isToday ? 'var(--text-on-accent)' : 'var(--text-secondary)' }}>{day.getDate()}</span>
                  </div>
                  <div className="space-y-1 mt-1">
                    {evs.slice(0, 3).map(e => {
                      const rgb = eventColor(e);
                      return (
                        <button key={e.id} onClick={() => e.lead && onOpenLead(e.lead.id)} className="w-full text-left px-1.5 py-0.5 rounded text-[10px] truncate" style={{ background: `rgba(${rgb},0.14)`, color: `rgb(${rgb})` }}>
                          {new Date(e.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} {e.lead?.lead_name || 'Lead'}
                        </button>
                      );
                    })}
                    {evs.length > 3 && <p className="text-[10px] px-1" style={{ color: 'var(--text-faint)' }}>+{evs.length - 3} more</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === 'week' && (
        <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => {
            const day = addDays(range.start, i);
            const isToday = sameDay(day, new Date());
            const evs = eventsFor(day);
            return (
              <div key={i} className="rounded-xl p-2 min-h-[160px]" style={{ background: 'var(--bg-elevated)', border: `1px solid ${isToday ? 'var(--accent)' : 'var(--border)'}` }}>
                <p className="text-[11px] font-bold mb-2" style={{ color: isToday ? 'var(--accent)' : 'var(--text-secondary)' }}>{DAYS[day.getDay()]} {day.getDate()}</p>
                <div className="space-y-1">
                  {evs.length === 0 ? <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>—</p> : evs.map(e => {
                    const rgb = eventColor(e);
                    return (
                      <button key={e.id} onClick={() => e.lead && onOpenLead(e.lead.id)} className="w-full text-left p-1.5 rounded text-[10px]" style={{ background: `rgba(${rgb},0.14)`, color: `rgb(${rgb})` }}>
                        <span className="font-semibold">{new Date(e.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span> {e.lead?.lead_name}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'day' && (
        <div className="rounded-2xl p-3 space-y-2" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          {eventsFor(cursor).length === 0 ? (
            <p className="text-sm text-center py-10" style={{ color: 'var(--text-faint)' }}>No follow-ups scheduled for this day.</p>
          ) : eventsFor(cursor).map(e => {
            const rgb = eventColor(e);
            return (
              <button key={e.id} onClick={() => e.lead && onOpenLead(e.lead.id)} className="w-full flex items-center gap-3 p-3 rounded-xl text-left" style={{ background: 'var(--bg-base)', border: `1px solid rgba(${rgb},0.3)` }}>
                <span className="w-1.5 h-10 rounded-full flex-shrink-0" style={{ background: `rgb(${rgb})` }} />
                <div className="w-16 flex-shrink-0">
                  <p className="text-sm font-bold" style={{ color: `rgb(${rgb})` }}>{new Date(e.scheduled_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{e.lead?.lead_name || 'Lead'}</p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>{e.purpose || 'Follow-up'} · <span className="capitalize">{e.mode.replace('_', ' ')}</span></p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
