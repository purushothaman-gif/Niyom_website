import { useCallback, useEffect, useState } from 'react';
import { LogoLoader } from '../../components/LogoLoader';
import { supabase } from '../../lib/supabase';
import { NWEmployee } from '../types';
import { GripVertical } from 'lucide-react';
import { NWLead, LeadStatus } from './leadTypes';
import { LEAD_STATUSES, statusRgb } from './leadConstants';
import { ScoreBadge, PriorityBadge } from './leadUi';
import { isAdminRole, formatMoney, initials, relativeTime } from './leadUtils';

const LEAD_SELECT =
  '*, owner:nw_employees!nw_leads_owner_employee_id_fkey(full_name, employee_code), ' +
  'created_by:nw_employees!nw_leads_created_by_employee_id_fkey(full_name, employee_code)';

// Board shows the most recently touched active leads; it's a working surface,
// not the full 100k list (that's the List view with server pagination).
const BOARD_CAP = 300;

interface Props {
  employee: NWEmployee;
  refreshKey: number;
  onOpen: (lead: NWLead) => void;
}

export default function LeadPipeline({ employee, refreshKey, onOpen }: Props) {
  const isAdmin = isAdminRole(employee);
  const [leads, setLeads] = useState<NWLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<LeadStatus | null>(null);
  const [toast, setToast] = useState('');
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('nw_leads').select(LEAD_SELECT)
      .eq('is_archived', false).order('updated_at', { ascending: false }).limit(BOARD_CAP);
    setLeads((data as unknown as NWLead[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const move = async (lead: NWLead, next: LeadStatus) => {
    if (lead.status === next) return;
    const canEdit = !lead.is_locked && (isAdmin || lead.owner_employee_id === employee.id);
    if (!canEdit) { flash('You can only move your own, unlocked leads.'); return; }
    const prev = lead.status;
    setLeads(ls => ls.map(l => l.id === lead.id ? { ...l, status: next } : l));  // optimistic
    const { error } = await supabase.from('nw_leads').update({ status: next }).eq('id', lead.id);
    if (error) {
      setLeads(ls => ls.map(l => l.id === lead.id ? { ...l, status: prev } : l)); // rollback
      flash(error.message); return;
    }
    await supabase.from('nw_lead_activities').insert([{
      lead_id: lead.id, employee_id: employee.id, action: 'Status Changed', description: `${prev} → ${next}`,
    }]);
    flash(`Moved to ${next}`);
  };

  if (loading) {
    return <div className="flex justify-center py-20"><LogoLoader size={48} /></div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          Showing {leads.length} most recently active leads · drag a card to change status
        </p>
      </div>
      <div className="overflow-x-auto pb-3">
        <div className="flex gap-3" style={{ minWidth: 'min-content' }}>
          {LEAD_STATUSES.map(s => {
            const col = leads.filter(l => l.status === s.label);
            const rgb = s.rgb;
            const isTarget = dropTarget === s.label;
            return (
              <div key={s.label} className="flex-shrink-0 w-64 rounded-2xl flex flex-col"
                style={{ background: 'var(--bg-elevated)', border: `1px solid ${isTarget ? `rgb(${rgb})` : 'var(--border)'}`, maxHeight: '72vh' }}
                onDragOver={e => { e.preventDefault(); setDropTarget(s.label); }}
                onDragLeave={() => setDropTarget(t => t === s.label ? null : t)}
                onDrop={() => {
                  const lead = leads.find(l => l.id === dragId);
                  if (lead) move(lead, s.label);
                  setDragId(null); setDropTarget(null);
                }}>
                <div className="flex items-center justify-between px-3 py-2.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: `rgb(${rgb})` }} />
                    <span className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>{s.label}</span>
                  </div>
                  <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: `rgba(${rgb},0.12)`, color: `rgb(${rgb})` }}>{col.length}</span>
                </div>
                <div className="p-2 space-y-2 overflow-y-auto">
                  {col.length === 0 ? (
                    <p className="text-[11px] text-center py-6" style={{ color: 'var(--text-faint)' }}>—</p>
                  ) : col.map(l => {
                    const canEdit = !l.is_locked && (isAdmin || l.owner_employee_id === employee.id);
                    return (
                      <div key={l.id} draggable={canEdit}
                        onDragStart={() => setDragId(l.id)}
                        onClick={() => onOpen(l)}
                        className="p-2.5 rounded-xl cursor-pointer transition-all"
                        style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderLeft: `3px solid rgb(${statusRgb(l.status)})` }}>
                        <div className="flex items-start gap-2">
                          {canEdit && <GripVertical className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }} />}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <div className="w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0" style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)' }}>{initials(l.lead_name)}</div>
                              <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{l.lead_name}</p>
                            </div>
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              <PriorityBadge priority={l.priority} />
                              <ScoreBadge score={l.lead_score} band={l.score_band} />
                            </div>
                            <div className="flex items-center justify-between mt-1.5">
                              <span className="text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{formatMoney(l.investment_capacity)}</span>
                              <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{relativeTime(l.updated_at)}</span>
                            </div>
                            {isAdmin && (
                              <p className="text-[10px] mt-1 truncate" style={{ color: 'var(--text-faint)' }}>{l.owner?.full_name || 'Admin Pool'}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-[80] px-4 py-3 rounded-xl shadow-2xl text-sm font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>{toast}</div>
      )}
    </div>
  );
}
