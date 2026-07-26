import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { NWEmployee, CRMPage } from '../types';
import {
  ArrowLeft, Phone, MessageCircle, Mail, Pencil, UserPlus, StickyNote,
  CalendarClock, Upload, FileText, Activity as ActivityIcon,
  ShieldCheck, Lock, Building2, Briefcase, MapPin, History,
  CheckCircle2, Download, AlertCircle, Trash2,
} from 'lucide-react';
import {
  NWLead, NWLeadActivity, NWLeadNote, NWLeadFollowup, NWLeadCommunication,
  NWLeadDocument, LeadStatus, CommType, LeadPriority, FollowupMode,
} from './leadTypes';
import {
  LEAD_STATUSES, CALL_OUTCOMES, FOLLOWUP_MODES, LEAD_ORIGIN_LABEL,
} from './leadConstants';
import {
  StatusBadge, PriorityBadge, ScoreBadge, Modal, Field, Input, Textarea, Select,
  PrimaryButton, GhostButton,
} from './leadUi';
import {
  isAdminRole, formatMoney, formatDateTime, relativeTime, elapsed, initials,
} from './leadUtils';

interface Props {
  employee: NWEmployee;
  lead: NWLead;
  onBack: () => void;
  onEdit: (lead: NWLead) => void;
  onAssign: (leads: NWLead[]) => void;
  onChanged: () => void;                                   // refresh list on return
  onNavigate: (page: CRMPage, params?: Record<string, string>) => void;
}

const LEAD_SELECT =
  '*, owner:nw_employees!nw_leads_owner_employee_id_fkey(full_name, employee_code), ' +
  'created_by:nw_employees!nw_leads_created_by_employee_id_fkey(full_name, employee_code)';

const DOC_TYPES = ['PAN', 'Aadhaar', 'KYC', 'Bank Statement', 'Cheque', 'Other'];

type Tab = 'timeline' | 'calls' | 'notes' | 'followups' | 'documents';

export default function LeadWorkspace({ employee, lead: initialLead, onBack, onEdit, onAssign, onChanged, onNavigate }: Props) {
  const isAdmin = isAdminRole(employee);
  const [lead, setLead] = useState<NWLead>(initialLead);
  const [tab, setTab] = useState<Tab>('timeline');
  const [activities, setActivities] = useState<NWLeadActivity[]>([]);
  const [notes, setNotes] = useState<NWLeadNote[]>([]);
  const [followups, setFollowups] = useState<NWLeadFollowup[]>([]);
  const [comms, setComms] = useState<NWLeadCommunication[]>([]);
  const [docs, setDocs] = useState<NWLeadDocument[]>([]);

  const [outcomeModal, setOutcomeModal] = useState<{ open: boolean; type: CommType }>({ open: false, type: 'call' });
  const [followupModal, setFollowupModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [toast, setToast] = useState('');
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  // Admin-only hard delete (via nw_delete_lead RPC; child rows cascade).
  const [delModal, setDelModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteLead = async () => {
    setDeleting(true);
    const { error } = await supabase.rpc('nw_delete_lead', { p_lead_id: lead.id });
    setDeleting(false);
    if (error) { setDelModal(false); flash(error.message || 'Could not delete the lead.'); return; }
    setDelModal(false);
    onChanged();
    onBack();
  };

  const locked = lead.is_locked;
  const converted = lead.status === 'Closed - Converted' || !!lead.converted_client_id;
  const canEdit = !locked && (isAdmin || lead.owner_employee_id === employee.id);

  const reloadLead = useCallback(async () => {
    const { data } = await supabase.from('nw_leads').select(LEAD_SELECT).eq('id', lead.id).single();
    if (data) setLead(data as unknown as NWLead);
  }, [lead.id]);

  const loadChildren = useCallback(async () => {
    const [a, n, f, c, d] = await Promise.all([
      supabase.from('nw_lead_activities').select('*, employee:nw_employees(full_name)').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(100),
      supabase.from('nw_lead_notes').select('*, employee:nw_employees(full_name)').eq('lead_id', lead.id).order('created_at', { ascending: false }),
      supabase.from('nw_lead_followups').select('*').eq('lead_id', lead.id).order('scheduled_at', { ascending: false }),
      supabase.from('nw_lead_communications').select('*').eq('lead_id', lead.id).order('created_at', { ascending: false }),
      supabase.from('nw_lead_documents').select('*').eq('lead_id', lead.id).order('created_at', { ascending: false }),
    ]);
    setActivities((a.data as any) || []);
    setNotes((n.data as any) || []);
    setFollowups((f.data as any) || []);
    setComms((c.data as any) || []);
    setDocs((d.data as any) || []);
  }, [lead.id]);

  useEffect(() => { loadChildren(); }, [loadChildren]);

  const logActivity = (action: string, description: string) =>
    supabase.from('nw_lead_activities').insert([{ lead_id: lead.id, employee_id: employee.id, action, description }]);

  // ---- Actions -------------------------------------------------------------
  const addNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    await supabase.from('nw_lead_notes').insert([{
      lead_id: lead.id, employee_id: employee.id, status_at_time: lead.status, remarks: noteText.trim(),
    }]);
    await logActivity('Note Added', noteText.trim().slice(0, 120));
    setNoteText(''); setSavingNote(false);
    flash('Note added'); loadChildren(); reloadLead();
  };

  const changeStatus = async (next: LeadStatus) => {
    if (next === lead.status) return;
    setStatusSaving(true);
    const { error } = await supabase.from('nw_leads').update({ status: next }).eq('id', lead.id);
    setStatusSaving(false);
    if (error) { flash(error.message); return; }
    await logActivity('Status Changed', `${lead.status} → ${next}`);
    flash('Status updated'); reloadLead(); loadChildren(); onChanged();
  };

  const completeFollowup = async (f: NWLeadFollowup) => {
    await supabase.from('nw_lead_followups').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', f.id);
    await logActivity('Reminder Completed', `${f.purpose || 'Follow-up'} marked complete`);
    flash('Follow-up completed'); loadChildren(); reloadLead();
  };

  const viewDoc = async (d: NWLeadDocument) => {
    const { data } = await supabase.storage.from('crm-documents').createSignedUrl(d.file_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  };

  // ---- Contact quick actions ----------------------------------------------
  const startContact = (type: CommType) => {
    const num = lead.mobile;
    if (type === 'call' && num) window.location.href = `tel:${num}`;
    if (type === 'whatsapp' && num) window.open(`https://wa.me/91${num}`, '_blank');
    if (type === 'email' && lead.email) window.location.href = `mailto:${lead.email}`;
    setOutcomeModal({ open: true, type });               // log immediately after — minimal clicks
  };

  const tabs: { key: Tab; label: string; icon: any; count: number }[] = [
    { key: 'timeline', label: 'Timeline', icon: History, count: activities.length },
    { key: 'calls', label: 'Communications', icon: Phone, count: comms.length },
    { key: 'notes', label: 'Notes', icon: StickyNote, count: notes.length },
    { key: 'followups', label: 'Follow-ups', icon: CalendarClock, count: followups.length },
    { key: 'documents', label: 'Documents', icon: FileText, count: docs.length },
  ];

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={onBack} className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft className="w-4 h-4" /> Back to Leads
        </button>
        <div className="flex items-center gap-2">
          {canEdit && !converted && (
            <PrimaryButton onClick={() => onNavigate('onboarding', { leadId: lead.id })} className="!py-2 !px-4 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> Convert to Client
            </PrimaryButton>
          )}
          {canEdit && (
            <GhostButton onClick={() => onEdit(lead)} className="!py-2 !px-3.5 flex items-center gap-2">
              <Pencil className="w-4 h-4" /> Edit
            </GhostButton>
          )}
          {isAdmin && (
            <GhostButton onClick={() => onAssign([lead])} className="!py-2 !px-3.5 flex items-center gap-2">
              <UserPlus className="w-4 h-4" /> Assign
            </GhostButton>
          )}
          {isAdmin && (
            <GhostButton onClick={() => setDelModal(true)} className="!py-2 !px-3.5 flex items-center gap-2"
              style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <Trash2 className="w-4 h-4" /> Delete
            </GhostButton>
          )}
        </div>
      </div>

      {/* Admin delete confirmation */}
      <Modal open={delModal} onClose={() => !deleting && setDelModal(false)} title="Delete lead?">
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              This permanently deletes <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{lead.lead_name}</span>
              {' '}(<span className="font-mono">{lead.lead_code}</span>) and all its activity, notes, follow-ups, communications and documents. This cannot be undone.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setDelModal(false)} disabled={deleting} className="!py-2 !px-4">Cancel</GhostButton>
            <PrimaryButton onClick={deleteLead} disabled={deleting} className="!py-2 !px-4 flex items-center gap-2"
              style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}>
              <Trash2 className="w-4 h-4" /> {deleting ? 'Deleting…' : 'Delete lead'}
            </PrimaryButton>
          </div>
        </div>
      </Modal>

      {(locked || converted) && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm" style={{ background: 'rgba(5,150,105,0.08)', border: '1px solid rgba(5,150,105,0.25)', color: 'rgb(5,150,105)' }}>
          <Lock className="w-4 h-4" /> {converted ? 'This lead has been converted to a client and is locked.' : 'This lead is locked by an administrator.'}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* LEFT: profile + quick contact */}
        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold flex-shrink-0"
                style={{ background: 'rgba(var(--accent-rgb),0.12)', color: 'var(--accent)' }}>
                {initials(lead.lead_name)}
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold truncate" style={{ color: 'var(--text-primary)' }}>{lead.lead_name}</h1>
                <p className="text-xs font-mono" style={{ color: 'var(--accent)' }}>{lead.lead_code}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <StatusBadge status={lead.status} small />
              <PriorityBadge priority={lead.priority} />
              <ScoreBadge score={lead.lead_score} band={lead.score_band} />
            </div>

            {/* Quick contact */}
            <div className="grid grid-cols-3 gap-2 mt-4">
              <ContactBtn icon={Phone} label="Call" color="16,185,129" disabled={!lead.mobile} onClick={() => startContact('call')} />
              <ContactBtn icon={MessageCircle} label="WhatsApp" color="37,211,102" disabled={!lead.mobile} onClick={() => startContact('whatsapp')} />
              <ContactBtn icon={Mail} label="Email" color="59,130,246" disabled={!lead.email} onClick={() => startContact('email')} />
            </div>
          </div>

          {/* Profile details */}
          <div className="rounded-2xl p-5 space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Profile</p>
            <InfoRow icon={Phone} label="Mobile" value={lead.mobile} />
            {lead.alternate_number && <InfoRow icon={Phone} label="Alternate" value={lead.alternate_number} />}
            <InfoRow icon={Mail} label="Email" value={lead.email} />
            <InfoRow icon={MapPin} label="Location" value={[lead.city, lead.state].filter(Boolean).join(', ')} />
            <InfoRow icon={Briefcase} label="Occupation" value={lead.occupation} />
            <InfoRow icon={Building2} label="Company" value={lead.company_name} />
            {lead.age != null && <InfoRow icon={ActivityIcon} label="Age" value={String(lead.age)} />}
          </div>

          {/* Investment potential */}
          <div className="rounded-2xl p-5 space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Investment Potential</p>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Capacity" value={formatMoney(lead.investment_capacity)} strong />
              <Metric label="Annual Income" value={formatMoney(lead.annual_income)} />
              <Metric label="Product" value={lead.interested_product || '—'} />
              <Metric label="Source" value={lead.lead_source || '—'} />
            </div>
            {lead.campaign && <Metric label="Campaign" value={lead.campaign} />}
            {lead.remarks && (
              <div className="pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-faint)' }}>Remarks</p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{lead.remarks}</p>
              </div>
            )}
          </div>

          {/* SLA */}
          <div className="rounded-2xl p-5 space-y-2.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>SLA</p>
            <SlaRow label="Time to First Call" value={lead.first_call_at ? elapsed(lead.created_at, lead.first_call_at) : 'Not called yet'} />
            <SlaRow label="Time to First Contact" value={lead.first_contact_at ? elapsed(lead.created_at, lead.first_contact_at) : 'No contact yet'} />
            <SlaRow label="Since Last Activity" value={lead.last_activity_at ? relativeTime(lead.last_activity_at) : '—'} />
            <SlaRow label="Since Last Follow-up" value={lead.last_followup_at ? relativeTime(lead.last_followup_at) : '—'} />
            {converted && <SlaRow label="Time to Conversion" value={elapsed(lead.created_at, lead.converted_at)} />}
          </div>

          {/* Meta */}
          <div className="rounded-2xl p-5 space-y-2.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Details</p>
            <SlaRow label="Lead Owner" value={lead.owner?.full_name || 'Admin Pool'} />
            <SlaRow label="Created By" value={lead.created_by?.full_name || '—'} />
            <SlaRow label="Lead Origin" value={LEAD_ORIGIN_LABEL[lead.lead_origin]} />
            <SlaRow label="Created" value={formatDateTime(lead.created_at)} />
            <SlaRow label="Last Updated" value={formatDateTime(lead.updated_at)} />
          </div>
        </div>

        {/* RIGHT: workspace */}
        <div className="lg:col-span-2 space-y-4">
          {/* Action bar */}
          <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <ActionChip icon={Phone} label="Log Outcome" onClick={() => setOutcomeModal({ open: true, type: 'call' })} disabled={!canEdit} />
              <ActionChip icon={CalendarClock} label="Schedule Follow-up" onClick={() => setFollowupModal(true)} disabled={!canEdit} />
              <ActionChip icon={Upload} label="Upload Document" onClick={() => document.getElementById('lead-doc-input')?.click()} disabled={!canEdit} />
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Status</span>
                <Select value={lead.status} disabled={!canEdit || statusSaving}
                  onChange={e => changeStatus(e.target.value as LeadStatus)} style={{ width: 'auto', minWidth: '11rem' }}>
                  {LEAD_STATUSES.map(s => <option key={s.label} value={s.label}>{s.label}</option>)}
                </Select>
              </div>
            </div>
            {/* Quick note */}
            <div className="flex items-start gap-2">
              <Textarea rows={1} value={noteText} onChange={e => setNoteText(e.target.value)} disabled={!canEdit}
                placeholder="Add a note… (cannot be deleted once saved)" style={{ minHeight: '42px' }} />
              <PrimaryButton onClick={addNote} disabled={!canEdit || savingNote || !noteText.trim()} className="!py-2.5 !px-4 flex-shrink-0">
                {savingNote ? '…' : 'Add'}
              </PrimaryButton>
            </div>
            <DocUploadInput leadId={lead.id} leadCode={lead.lead_code} employee={employee}
              onUploaded={() => { flash('Document uploaded'); loadChildren(); reloadLead(); }} disabled={!canEdit} />
          </div>

          {/* Tabs */}
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-1 px-2 pt-2 overflow-x-auto" style={{ borderBottom: '1px solid var(--border)' }}>
              {tabs.map(t => (
                <button key={t.key} onClick={() => setTab(t.key)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold whitespace-nowrap rounded-t-lg transition-colors"
                  style={{ color: tab === t.key ? 'var(--accent)' : 'var(--text-faint)', borderBottom: `2px solid ${tab === t.key ? 'var(--accent)' : 'transparent'}` }}>
                  <t.icon className="w-3.5 h-3.5" /> {t.label}
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--bg-raised)', color: 'var(--text-faint)' }}>{t.count}</span>
                </button>
              ))}
            </div>

            <div className="p-4">
              {tab === 'timeline' && <Timeline items={activities} />}
              {tab === 'calls' && <Communications items={comms} />}
              {tab === 'notes' && <Notes items={notes} />}
              {tab === 'followups' && <Followups items={followups} onComplete={completeFollowup} canEdit={canEdit} />}
              {tab === 'documents' && <Documents items={docs} onView={viewDoc} />}
            </div>
          </div>
        </div>
      </div>

      {outcomeModal.open && (
        <OutcomeModal lead={lead} employee={employee} commType={outcomeModal.type}
          onClose={() => setOutcomeModal({ open: false, type: 'call' })}
          onLogged={() => { setOutcomeModal({ open: false, type: 'call' }); flash('Outcome logged'); loadChildren(); reloadLead(); onChanged(); }} />
      )}
      {followupModal && (
        <FollowupModal lead={lead} employee={employee}
          onClose={() => setFollowupModal(false)}
          onScheduled={() => { setFollowupModal(false); flash('Follow-up scheduled'); loadChildren(); reloadLead(); }} />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[80] px-4 py-3 rounded-xl shadow-2xl text-sm font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>{toast}</div>
      )}
    </div>
  );
}

/* ------------------------------ sub-components ------------------------------ */

function ContactBtn({ icon: Icon, label, color, onClick, disabled }: { icon: any; label: string; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex flex-col items-center gap-1.5 py-3 rounded-xl transition-all disabled:opacity-40"
      style={{ background: `rgba(${color},0.1)`, border: `1px solid rgba(${color},0.25)` }}>
      <Icon className="w-5 h-5" style={{ color: `rgb(${color})` }} />
      <span className="text-[11px] font-bold" style={{ color: `rgb(${color})` }}>{label}</span>
    </button>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
      <span className="text-[11px] w-20 flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{label}</span>
      <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{value || '—'}</span>
    </div>
  );
}

function Metric({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</p>
      <p className={strong ? 'text-base font-bold' : 'text-sm font-semibold'} style={{ color: strong ? 'var(--accent)' : 'var(--text-primary)' }}>{value}</p>
    </div>
  );
}

function SlaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{label}</span>
      <span className="text-xs font-semibold text-right" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

function ActionChip({ icon: Icon, label, onClick, disabled }: { icon: any; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
      style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
      <Icon className="w-4 h-4" style={{ color: 'var(--accent)' }} /> {label}
    </button>
  );
}

function EmptyState({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="text-center py-10">
      <Icon className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />
      <p className="text-sm" style={{ color: 'var(--text-faint)' }}>{text}</p>
    </div>
  );
}

function Timeline({ items }: { items: NWLeadActivity[] }) {
  if (items.length === 0) return <EmptyState icon={History} text="No activity yet" />;
  return (
    <div className="space-y-3">
      {items.map(a => (
        <div key={a.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="w-2 h-2 rounded-full mt-1.5" style={{ background: 'var(--accent)' }} />
            <div className="flex-1 w-px" style={{ background: 'var(--border-subtle)' }} />
          </div>
          <div className="flex-1 pb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{a.action}</span>
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{relativeTime(a.created_at)}</span>
            </div>
            {a.description && <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{a.description}</p>}
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>{a.employee?.full_name || 'System'} · {formatDateTime(a.created_at)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function Communications({ items }: { items: NWLeadCommunication[] }) {
  if (items.length === 0) return <EmptyState icon={Phone} text="No calls or messages logged yet" />;
  const ICON: Record<CommType, any> = { call: Phone, whatsapp: MessageCircle, email: Mail };
  return (
    <div className="space-y-2.5">
      {items.map(c => {
        const Icon = ICON[c.comm_type];
        return (
          <div key={c.id} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(var(--accent-rgb),0.1)' }}>
              <Icon className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold capitalize" style={{ color: 'var(--text-primary)' }}>{c.comm_type}</span>
                {c.outcome && <span className="text-[11px] px-2 py-0.5 rounded" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}>{c.outcome}</span>}
              </div>
              {c.remarks && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{c.remarks}</p>}
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-faint)' }}>{formatDateTime(c.created_at)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Notes({ items }: { items: NWLeadNote[] }) {
  if (items.length === 0) return <EmptyState icon={StickyNote} text="No notes yet" />;
  return (
    <div className="space-y-2.5">
      {items.map(n => (
        <div key={n.id} className="p-3 rounded-xl" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{n.remarks}</p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{n.employee?.full_name || '—'}</span>
            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>· {formatDateTime(n.created_at)}</span>
            {n.status_at_time && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-raised)', color: 'var(--text-faint)' }}>{n.status_at_time}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Followups({ items, onComplete, canEdit }: { items: NWLeadFollowup[]; onComplete: (f: NWLeadFollowup) => void; canEdit: boolean }) {
  if (items.length === 0) return <EmptyState icon={CalendarClock} text="No follow-ups scheduled" />;
  const now = Date.now();
  return (
    <div className="space-y-2.5">
      {items.map(f => {
        const due = new Date(f.scheduled_at).getTime();
        const overdue = f.status === 'pending' && due < now;
        const rgb = f.status === 'completed' ? '16,185,129' : overdue ? '239,68,68' : due - now < 86400000 ? '249,115,22' : '59,130,246';
        return (
          <div key={f.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--bg-base)', border: `1px solid rgba(${rgb},0.3)` }}>
            <CalendarClock className="w-4 h-4 flex-shrink-0" style={{ color: `rgb(${rgb})` }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{f.purpose || 'Follow-up'} <span className="text-[11px] font-normal capitalize" style={{ color: 'var(--text-faint)' }}>· {f.mode.replace('_', ' ')}</span></p>
              <p className="text-[11px]" style={{ color: `rgb(${rgb})` }}>{formatDateTime(f.scheduled_at)} {overdue && '· Overdue'} {f.status === 'completed' && '· Completed'}</p>
            </div>
            {f.status === 'pending' && canEdit && (
              <button onClick={() => onComplete(f)} className="text-xs font-semibold flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--success)' }}>
                <CheckCircle2 className="w-4 h-4" /> Done
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Documents({ items, onView }: { items: NWLeadDocument[]; onView: (d: NWLeadDocument) => void }) {
  if (items.length === 0) return <EmptyState icon={FileText} text="No documents uploaded" />;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {items.map(d => (
        <button key={d.id} onClick={() => onView(d)} className="flex items-center gap-3 p-3 rounded-xl text-left transition-all"
          style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(var(--accent-rgb),0.1)' }}>
            <FileText className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{d.doc_type}</p>
            <p className="text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>{d.file_name}</p>
          </div>
          <Download className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
        </button>
      ))}
    </div>
  );
}

// Hidden file input + doc-type picker handled via a tiny inline flow.
function DocUploadInput({ leadId, leadCode, employee, onUploaded, disabled }:
  { leadId: string; leadCode: string; employee: NWEmployee; onUploaded: () => void; disabled?: boolean }) {
  const [pending, setPending] = useState<File | null>(null);
  const [docType, setDocType] = useState('PAN');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const upload = async () => {
    if (!pending) return;
    setBusy(true); setErr('');
    try {
      const ext = pending.name.substring(pending.name.lastIndexOf('.'));
      const path = `leads/${leadCode}/${docType}/${Date.now()}${ext}`;
      const { error: upErr } = await supabase.storage.from('crm-documents').upload(path, pending, { upsert: true });
      if (upErr) throw upErr;
      await supabase.from('nw_lead_documents').insert([{
        lead_id: leadId, employee_id: employee.id, doc_type: docType,
        file_name: pending.name, file_path: path, file_size: pending.size,
        mime_type: pending.type, uploaded_by_name: employee.full_name,
      }]);
      await supabase.from('nw_lead_activities').insert([{
        lead_id: leadId, employee_id: employee.id, action: 'Document Uploaded', description: `${docType}: ${pending.name}`,
      }]);
      setPending(null); onUploaded();
    } catch (e: any) { setErr(e.message || 'Upload failed'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <input id="lead-doc-input" type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv"
        disabled={disabled} onChange={e => { setPending(e.target.files?.[0] || null); e.target.value = ''; }} />
      {pending && (
        <div className="flex items-center gap-2 p-2.5 rounded-xl" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
          <FileText className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent)' }} />
          <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{pending.name}</span>
          <Select value={docType} onChange={e => setDocType(e.target.value)} style={{ width: 'auto' }}>
            {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
          <PrimaryButton onClick={upload} disabled={busy} className="!py-1.5 !px-3 text-xs">{busy ? '…' : 'Save'}</PrimaryButton>
          <GhostButton onClick={() => setPending(null)} className="!py-1.5 !px-3 text-xs">Cancel</GhostButton>
        </div>
      )}
      {err && <p className="text-xs flex items-center gap-1" style={{ color: 'var(--danger)' }}><AlertCircle className="w-3 h-3" />{err}</p>}
    </>
  );
}

/* -------------------------------- modals --------------------------------- */

function OutcomeModal({ lead, employee, commType, onClose, onLogged }:
  { lead: NWLead; employee: NWEmployee; commType: CommType; onClose: () => void; onLogged: () => void }) {
  const [type, setType] = useState<CommType>(commType);
  const [outcome, setOutcome] = useState<string>('Connected');
  const [remarks, setRemarks] = useState('');
  const [newStatus, setNewStatus] = useState<LeadStatus | ''>('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    await supabase.from('nw_lead_communications').insert([{
      lead_id: lead.id, employee_id: employee.id, comm_type: type, outcome, remarks: remarks.trim(), direction: 'outbound',
    }]);
    await supabase.from('nw_lead_activities').insert([{
      lead_id: lead.id, employee_id: employee.id, action: type === 'call' ? 'Called' : type === 'whatsapp' ? 'WhatsApp' : 'Email',
      description: `${outcome}${remarks.trim() ? ' — ' + remarks.trim() : ''}`,
    }]);
    if (newStatus && newStatus !== lead.status) {
      await supabase.from('nw_leads').update({ status: newStatus }).eq('id', lead.id);
      await supabase.from('nw_lead_activities').insert([{ lead_id: lead.id, employee_id: employee.id, action: 'Status Changed', description: `${lead.status} → ${newStatus}` }]);
    }
    if (followUpDate) {
      await supabase.from('nw_lead_followups').insert([{
        lead_id: lead.id, employee_id: employee.id, scheduled_at: new Date(followUpDate).toISOString(),
        priority: lead.priority, purpose: `Follow-up after ${type}`, mode: type === 'whatsapp' ? 'whatsapp' : 'phone',
      }]);
    }
    setBusy(false); onLogged();
  };

  return (
    <Modal open onClose={onClose} title="Log Communication Outcome" width="max-w-lg">
      <div className="space-y-3.5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={type} onChange={e => setType(e.target.value as CommType)}>
              <option value="call">Call</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option>
            </Select>
          </Field>
          <Field label="Outcome" required>
            <Select value={outcome} onChange={e => setOutcome(e.target.value)}>
              {CALL_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Remarks"><Textarea value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="What happened on this interaction?" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Update Status (optional)">
            <Select value={newStatus} onChange={e => setNewStatus(e.target.value as LeadStatus | '')}>
              <option value="">No change</option>
              {LEAD_STATUSES.map(s => <option key={s.label} value={s.label}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Next Follow-up (optional)">
            <Input type="datetime-local" value={followUpDate} onChange={e => setFollowUpDate(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <GhostButton onClick={onClose} className="!py-2 !px-4">Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={busy} className="!py-2 !px-4">{busy ? 'Saving…' : 'Log Outcome'}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function FollowupModal({ lead, employee, onClose, onScheduled }:
  { lead: NWLead; employee: NWEmployee; onClose: () => void; onScheduled: () => void }) {
  const [when, setWhen] = useState('');
  const [priority, setPriority] = useState<LeadPriority>(lead.priority);
  const [mode, setMode] = useState<FollowupMode>('phone');
  const [purpose, setPurpose] = useState('');
  const [reminder, setReminder] = useState(30);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    if (!when) { setErr('Pick a date & time.'); return; }
    setBusy(true); setErr('');
    const { error } = await supabase.from('nw_lead_followups').insert([{
      lead_id: lead.id, employee_id: employee.id, scheduled_at: new Date(when).toISOString(),
      priority, purpose: purpose.trim(), mode, reminder_minutes: reminder,
    }]);
    if (error) { setErr(error.message); setBusy(false); return; }
    await supabase.from('nw_lead_activities').insert([{
      lead_id: lead.id, employee_id: employee.id, action: 'Follow-up Added',
      description: `${purpose.trim() || 'Follow-up'} · ${new Date(when).toLocaleString('en-IN')}`,
    }]);
    setBusy(false); onScheduled();
  };

  return (
    <Modal open onClose={onClose} title="Schedule Follow-up" width="max-w-lg">
      <div className="space-y-3.5">
        {err && <div className="p-2.5 rounded-lg flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.08)' }}><AlertCircle className="w-4 h-4" style={{ color: 'var(--danger)' }} /><p className="text-xs" style={{ color: 'var(--danger)' }}>{err}</p></div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date & Time" required><Input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></Field>
          <Field label="Mode">
            <Select value={mode} onChange={e => setMode(e.target.value as FollowupMode)}>
              {FOLLOWUP_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={e => setPriority(e.target.value as LeadPriority)}>
              <option value="urgent">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
            </Select>
          </Field>
          <Field label="Reminder (min before)">
            <Select value={String(reminder)} onChange={e => setReminder(Number(e.target.value))}>
              {[15, 30, 60, 120, 1440].map(m => <option key={m} value={m}>{m >= 1440 ? '1 day' : `${m} min`}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Purpose"><Input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="e.g. Discuss FD options" /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <GhostButton onClick={onClose} className="!py-2 !px-4">Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={busy} className="!py-2 !px-4">{busy ? 'Scheduling…' : 'Schedule'}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
