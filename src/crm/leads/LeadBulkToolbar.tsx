import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { NWEmployee } from '../types';
import {
  UserPlus, Archive, Lock, Unlock, CalendarClock, Download, ChevronDown, Loader2, X, GitMerge, Trash2, AlertCircle,
} from 'lucide-react';
import { NWLead, LeadStatus, LeadPriority, LeadCategory, FollowupMode } from './leadTypes';
import { LEAD_STATUSES, PRIORITIES, FOLLOWUP_MODES, LEAD_CATEGORIES } from './leadConstants';
import { Modal, Field, Input, Select, PrimaryButton, GhostButton } from './leadUi';
import { leadsToCsv, downloadCsv } from './leadImportUtils';
import LeadMergeModal from './LeadMergeModal';

interface Props {
  employee: NWEmployee;
  leads: NWLead[];              // the selected leads (admin only surfaces this)
  onAssign: (leads: NWLead[]) => void;
  onDone: () => void;           // reload list
  onClear: () => void;
}

export default function LeadBulkToolbar({ employee, leads, onAssign, onDone, onClear }: Props) {
  const [menu, setMenu] = useState<'status' | 'priority' | 'category' | null>(null);
  const [busy, setBusy] = useState(false);
  const [followupOpen, setFollowupOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const ids = leads.map(l => l.id);

  // Chunk id lists: PATCH `.in('id', ids)` rides the URL (keep it short), while
  // activity INSERTs go in the POST body (larger chunks are fine).
  const chunk = <T,>(arr: T[], n: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  const logEach = async (action: string, description: string) => {
    for (const c of chunk(ids, 500)) {
      await supabase.from('nw_lead_activities').insert(c.map(id => ({ lead_id: id, employee_id: employee.id, action, description })));
    }
  };

  const patch = async (p: Record<string, unknown>, action: string, desc: string) => {
    setBusy(true); setMenu(null);
    for (const c of chunk(ids, 100)) {
      await supabase.from('nw_leads').update(p).in('id', c);
    }
    await logEach(action, desc);
    setBusy(false);
    onDone();
  };

  const setStatus = (s: LeadStatus) => patch({ status: s }, 'Status Changed', `Bulk set status → ${s}`);
  const setPriority = (p: LeadPriority) => patch({ priority: p }, 'Edited', `Bulk set priority → ${p}`);
  const setDataset = (c: LeadCategory) => patch({ lead_category: c }, 'Edited', `Bulk moved to ${c === 'client' ? 'Client Leads' : 'Partner Leads'}`);
  const archive = () => patch({ is_archived: true }, 'Archived', 'Bulk archived');
  const anyLocked = leads.some(l => l.is_locked);
  const toggleLock = () => patch({ is_locked: !anyLocked }, anyLocked ? 'Unlocked' : 'Locked', anyLocked ? 'Bulk unlocked' : 'Bulk locked');

  const exportCsv = () => {
    downloadCsv(`leads_selected_${new Date().toISOString().slice(0, 10)}.csv`, leadsToCsv(leads));
  };

  // Admin-only hard delete of the selected leads (via nw_delete_lead RPC, which
  // enforces the admin check server-side; child rows cascade). Chunked so a big
  // selection doesn't fire hundreds of calls at once.
  const deleteSelected = async () => {
    setBusy(true);
    for (const c of chunk(ids, 20)) {
      await Promise.all(c.map(id => supabase.rpc('nw_delete_lead', { p_lead_id: id })));
    }
    setBusy(false);
    setDelOpen(false);
    onClear();
    onDone();
  };

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl flex-wrap"
      style={{ background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
      <p className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--accent)' }}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} {leads.length} selected
      </p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <BulkBtn icon={UserPlus} label="Assign" onClick={() => onAssign(leads)} />
        <button onClick={() => setDelOpen(true)}
          className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all"
          style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.25)' }}>
          <Trash2 className="w-3.5 h-3.5" /> Delete
        </button>

        <div className="relative">
          <BulkBtn icon={ChevronDown} label="Status" onClick={() => setMenu(m => m === 'status' ? null : 'status')} />
          {menu === 'status' && (
            <Dropdown onClose={() => setMenu(null)}>
              {LEAD_STATUSES.map(s => (
                <button key={s.label} onClick={() => setStatus(s.label)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--hover-bg)]" style={{ color: 'var(--text-secondary)' }}>
                  <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: `rgb(${s.rgb})` }} />{s.label}
                </button>
              ))}
            </Dropdown>
          )}
        </div>

        <div className="relative">
          <BulkBtn icon={ChevronDown} label="Priority" onClick={() => setMenu(m => m === 'priority' ? null : 'priority')} />
          {menu === 'priority' && (
            <Dropdown onClose={() => setMenu(null)}>
              {PRIORITIES.map(p => (
                <button key={p.value} onClick={() => setPriority(p.value)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--hover-bg)]" style={{ color: 'var(--text-secondary)' }}>
                  <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: `rgb(${p.rgb})` }} />{p.label}
                </button>
              ))}
            </Dropdown>
          )}
        </div>

        <div className="relative">
          <BulkBtn icon={ChevronDown} label="Dataset" onClick={() => setMenu(m => m === 'category' ? null : 'category')} />
          {menu === 'category' && (
            <Dropdown onClose={() => setMenu(null)}>
              {LEAD_CATEGORIES.map(c => (
                <button key={c.value} onClick={() => setDataset(c.value)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--hover-bg)]" style={{ color: 'var(--text-secondary)' }}>
                  Move to {c.label}
                </button>
              ))}
            </Dropdown>
          )}
        </div>

        <BulkBtn icon={CalendarClock} label="Follow-up" onClick={() => setFollowupOpen(true)} />
        <BulkBtn icon={anyLocked ? Unlock : Lock} label={anyLocked ? 'Unlock' : 'Lock'} onClick={toggleLock} />
        <BulkBtn icon={Archive} label="Archive" onClick={archive} />
        {leads.length === 2 && <BulkBtn icon={GitMerge} label="Merge" onClick={() => setMergeOpen(true)} />}
        <BulkBtn icon={Download} label="Export" onClick={exportCsv} />
        <button onClick={onClear} className="text-xs font-semibold px-2" style={{ color: 'var(--text-secondary)' }}>Clear</button>
      </div>

      {followupOpen && (
        <BulkFollowupModal employee={employee} ids={ids}
          onClose={() => setFollowupOpen(false)}
          onDone={() => { setFollowupOpen(false); onDone(); }} />
      )}
      {mergeOpen && leads.length === 2 && (
        <LeadMergeModal leadA={leads[0]} leadB={leads[1]}
          onClose={() => setMergeOpen(false)}
          onMerged={() => { setMergeOpen(false); onClear(); onDone(); }} />
      )}
      {delOpen && (
        <Modal open onClose={() => !busy && setDelOpen(false)} title={`Delete ${leads.length} lead${leads.length > 1 ? 's' : ''}?`} width="max-w-md">
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                This permanently deletes <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{leads.length} lead{leads.length > 1 ? 's' : ''}</span> and all their activity, notes, follow-ups, communications and documents. This cannot be undone.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <GhostButton onClick={() => setDelOpen(false)} disabled={busy} className="!py-2 !px-4">Cancel</GhostButton>
              <PrimaryButton onClick={deleteSelected} disabled={busy} className="!py-2 !px-4 flex items-center gap-2" style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}>
                <Trash2 className="w-4 h-4" /> {busy ? 'Deleting…' : `Delete ${leads.length}`}
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function BulkBtn({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 transition-all"
      style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
      <Icon className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} /> {label}
    </button>
  );
}

function Dropdown({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full mt-1 left-0 z-50 w-48 max-h-64 overflow-y-auto rounded-xl shadow-2xl py-1"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        {children}
      </div>
    </>
  );
}

function BulkFollowupModal({ employee, ids, onClose, onDone }:
  { employee: NWEmployee; ids: string[]; onClose: () => void; onDone: () => void }) {
  const [when, setWhen] = useState('');
  const [mode, setMode] = useState<FollowupMode>('phone');
  const [priority, setPriority] = useState<LeadPriority>('medium');
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!when) { setErr('Pick a date & time.'); return; }
    setBusy(true); setErr('');
    const iso = new Date(when).toISOString();
    const desc = `Bulk follow-up · ${new Date(when).toLocaleString('en-IN')}`;
    for (let i = 0; i < ids.length; i += 500) {
      const c = ids.slice(i, i + 500);
      const { error } = await supabase.from('nw_lead_followups').insert(
        c.map(id => ({ lead_id: id, employee_id: employee.id, scheduled_at: iso, priority, mode, purpose: purpose.trim(), reminder_minutes: 30 })));
      if (error) { setErr(error.message); setBusy(false); return; }
      await supabase.from('nw_lead_activities').insert(
        c.map(id => ({ lead_id: id, employee_id: employee.id, action: 'Follow-up Added', description: desc })));
    }
    setBusy(false); onDone();
  };

  return (
    <Modal open onClose={onClose} title={`Schedule Follow-up · ${ids.length} leads`} width="max-w-md">
      <div className="space-y-3.5">
        {err && <p className="text-xs flex items-center gap-1" style={{ color: 'var(--danger)' }}><X className="w-3 h-3" />{err}</p>}
        <Field label="Date & Time" required><Input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mode">
            <Select value={mode} onChange={e => setMode(e.target.value as FollowupMode)}>
              {FOLLOWUP_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={e => setPriority(e.target.value as LeadPriority)}>
              {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Purpose"><Input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="e.g. Introductory call" /></Field>
        <div className="flex justify-end gap-2">
          <GhostButton onClick={onClose} className="!py-2 !px-4">Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={busy} className="!py-2 !px-4">{busy ? 'Scheduling…' : 'Schedule for all'}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
