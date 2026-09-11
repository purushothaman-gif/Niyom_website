import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { NWLead } from './leadTypes';
import { Modal, Select, Field, Textarea, PrimaryButton, GhostButton } from './leadUi';
import { AlertCircle, Users } from 'lucide-react';

interface Props {
  leads: NWLead[];                 // one or many (bulk-ready)
  onClose: () => void;
  onAssigned: (count: number) => void;
}

interface EmpRow { id: string; full_name: string; employee_code: string; workload: number; }

export default function LeadAssignModal({ leads, onClose, onAssigned }: Props) {
  const [employees, setEmployees] = useState<EmpRow[]>([]);
  const [toId, setToId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const single = leads.length === 1 ? leads[0] : null;

  useEffect(() => {
    (async () => {
      const { data: emps } = await supabase.from('nw_employees')
        .select('id, full_name, employee_code').eq('status', 'active').neq('role', 'transfer_admin').order('full_name');
      const list = emps || [];
      // Workload = active (non-archived) leads currently owned. Admin sees all.
      const rows = await Promise.all(list.map(async e => {
        const { count } = await supabase.from('nw_leads')
          .select('id', { count: 'exact', head: true })
          .eq('owner_employee_id', e.id).eq('is_archived', false);
        return { ...e, workload: count ?? 0 } as EmpRow;
      }));
      setEmployees(rows);
    })();
  }, []);

  const assign = async () => {
    if (!toId) { setError('Select an employee to assign to.'); return; }
    setSaving(true); setError('');
    const { data, error: e } = await supabase.rpc('nw_assign_leads', {
      p_lead_ids: leads.map(l => l.id), p_to_employee: toId, p_reason: reason.trim(),
    });
    setSaving(false);
    if (e) { setError(e.message); return; }
    onAssigned((data as number) ?? leads.length);
  };

  return (
    <Modal open onClose={onClose} title={single ? 'Assign Lead' : `Assign ${leads.length} Leads`}>
      <div className="space-y-4">
        {error && (
          <div className="p-2.5 rounded-lg flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.08)' }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--danger)' }} />
            <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>
          </div>
        )}
        {single && (
          <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{single.lead_name}</span> · {single.lead_code}
            <span className="ml-2">Current owner: {single.owner?.full_name || 'Admin Pool'}</span>
          </div>
        )}
        <Field label="Assign To" required hint="Workload = active leads currently owned.">
          <Select value={toId} onChange={e => setToId(e.target.value)}>
            <option value="">Select employee…</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.full_name} · {e.employee_code} ({e.workload} active)</option>
            ))}
          </Select>
        </Field>
        {/* Compact workload glance */}
        {employees.length > 0 && (
          <div className="rounded-lg p-2.5 max-h-32 overflow-y-auto" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
            <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
              <Users className="w-3 h-3" /> Team workload
            </p>
            {employees.map(e => (
              <div key={e.id} className="flex items-center gap-2 py-0.5">
                <span className="text-[11px] flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{e.full_name}</span>
                <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-raised)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, e.workload * 4)}%`, background: 'var(--accent)' }} />
                </div>
                <span className="text-[11px] w-6 text-right" style={{ color: 'var(--text-faint)' }}>{e.workload}</span>
              </div>
            ))}
          </div>
        )}
        <Field label="Reason (optional)">
          <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="Why this reassignment?" />
        </Field>
        <div className="flex items-center justify-end gap-2 pt-1">
          <GhostButton onClick={onClose} className="!py-2 !px-4">Cancel</GhostButton>
          <PrimaryButton onClick={assign} disabled={saving} className="!py-2 !px-4">
            {saving ? 'Assigning…' : 'Assign'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
