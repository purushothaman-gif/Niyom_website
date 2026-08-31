import { useCallback, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { NWEmployee, CRMPage } from '../types';
import { List, LayoutGrid, Plus, LayoutDashboard, CalendarDays, PhoneCall, Handshake, UserRound } from 'lucide-react';
import { NWLead, LeadCategory } from './leadTypes';
import { isAdminRole } from './leadUtils';
import LeadList from './LeadList';
import LeadPipeline from './LeadPipeline';
import LeadWorkspace from './LeadWorkspace';
import LeadForm from './LeadForm';
import LeadAssignModal from './LeadAssignModal';
import LeadImport from './LeadImport';
import LeadDuplicateQueue from './LeadDuplicateQueue';
import LeadDashboard from './LeadDashboard';
import LeadCalendar from './LeadCalendar';
import LeadCallQueue from './LeadCallQueue';
import LeadReminderPopup from './LeadReminderPopup';

interface Props {
  employee: NWEmployee;
  onNavigate: (page: CRMPage, params?: Record<string, string>) => void;
  pageParams?: Record<string, string>;
}

const LEAD_SELECT =
  '*, owner:nw_employees!nw_leads_owner_employee_id_fkey(full_name, employee_code), ' +
  'created_by:nw_employees!nw_leads_created_by_employee_id_fkey(full_name, employee_code)';

type FormState = { open: boolean; mode: 'create' | 'edit'; lead: NWLead | null };
type View = 'dashboard' | 'queue' | 'list' | 'board' | 'calendar' | 'import';

export default function Leads({ employee, onNavigate }: Props) {
  const isAdmin = isAdminRole(employee);
  const [refreshKey, setRefreshKey] = useState(0);
  const [category, setCategory] = useState<LeadCategory>('partner');
  const [view, setView] = useState<View>('dashboard');
  const [openLead, setOpenLead] = useState<NWLead | null>(null);      // workspace
  const [form, setForm] = useState<FormState>({ open: false, mode: 'create', lead: null });
  const [assign, setAssign] = useState<{ open: boolean; leads: NWLead[] }>({ open: false, leads: [] });
  const [dupOpen, setDupOpen] = useState(false);
  const [toast, setToast] = useState('');

  const bump = () => setRefreshKey(k => k + 1);
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const openWorkspace = useCallback(async (leadOrId: NWLead | string) => {
    if (typeof leadOrId !== 'string') { setOpenLead(leadOrId); return; }
    const { data } = await supabase.from('nw_leads').select(LEAD_SELECT).eq('id', leadOrId).single();
    if (data) setOpenLead(data as unknown as NWLead);
  }, []);

  // Import takes over the whole page (admin only).
  if (view === 'import' && isAdmin) {
    return (
      <>
        <LeadImport employee={employee} category={category}
          onBack={() => setView('list')}
          onDone={() => { setView('list'); bump(); }} />
        <LeadReminderPopup employee={employee} onOpenLead={id => { setView('list'); openWorkspace(id); }} />
      </>
    );
  }

  // Workspace takes over the whole page.
  if (openLead) {
    return (
      <>
        <LeadWorkspace
          employee={employee}
          lead={openLead}
          onBack={() => { setOpenLead(null); bump(); }}
          onEdit={l => setForm({ open: true, mode: 'edit', lead: l })}
          onAssign={leads => setAssign({ open: true, leads })}
          onChanged={bump}
          onNavigate={onNavigate}
        />
        {form.open && (
          <LeadForm employee={employee} mode={form.mode} lead={form.lead}
            onClose={() => setForm(f => ({ ...f, open: false }))}
            onSaved={l => { setForm(f => ({ ...f, open: false })); setOpenLead(l); flash('Lead updated'); bump(); }}
            onOpenExisting={openWorkspace} />
        )}
        {assign.open && (
          <LeadAssignModal leads={assign.leads}
            onClose={() => setAssign({ open: false, leads: [] })}
            onAssigned={count => { setAssign({ open: false, leads: [] }); flash(`${count} lead${count === 1 ? '' : 's'} assigned`); bump(); openWorkspace(openLead.id); }} />
        )}
        <LeadReminderPopup employee={employee} onOpenLead={openWorkspace} />
        {toast && <Toast text={toast} />}
      </>
    );
  }

  const viewToggle = (
    <div className="flex items-center rounded-xl p-0.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      {([['dashboard', LayoutDashboard, 'Dashboard'], ['queue', PhoneCall, 'Call Queue'], ['list', List, 'List view'], ['board', LayoutGrid, 'Pipeline board'], ['calendar', CalendarDays, 'Calendar']] as const).map(([v, Icon, label]) => (
        <button key={v} onClick={() => setView(v)}
          className="px-2.5 py-1.5 rounded-lg transition-all"
          style={{ background: view === v ? 'var(--accent)' : 'transparent', color: view === v ? 'var(--text-on-accent)' : 'var(--text-faint)' }}
          title={label}>
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );

  // Top-level dataset switcher — scopes every screen below it.
  const categoryTabs = (
    <div className="inline-flex items-center rounded-xl p-1 gap-1" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      {([['partner', 'Partner Leads', Handshake], ['client', 'Client Leads', UserRound]] as const).map(([v, label, Icon]) => {
        const active = category === v;
        return (
          <button key={v} onClick={() => { setCategory(v); bump(); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all"
            style={{ background: active ? 'linear-gradient(135deg, var(--accent), var(--accent-strong))' : 'transparent', color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)' }}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        );
      })}
    </div>
  );

  const PageHeader = ({ title }: { title: string }) => (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Lead Management</p>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        {viewToggle}
        <button onClick={() => setForm({ open: true, mode: 'create', lead: null })}
          className="px-4 py-2.5 rounded-xl text-sm font-bold text-on-accent flex items-center gap-2"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
          <Plus className="w-4 h-4" /> New Lead
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="mb-4">{categoryTabs}</div>
      {view === 'list' ? (
        <LeadList
          employee={employee}
          category={category}
          refreshKey={refreshKey}
          viewToggle={viewToggle}
          onNew={() => setForm({ open: true, mode: 'create', lead: null })}
          onOpen={openWorkspace}
          onEdit={l => setForm({ open: true, mode: 'edit', lead: l })}
          onAssign={leads => setAssign({ open: true, leads })}
          onImport={() => setView('import')}
          onOpenDuplicates={() => setDupOpen(true)}
        />
      ) : view === 'dashboard' ? (
        <div className="space-y-5">
          <PageHeader title={isAdmin ? 'Admin Dashboard' : 'My Dashboard'} />
          <LeadDashboard employee={employee} category={category} refreshKey={refreshKey} onOpenLead={openWorkspace} />
        </div>
      ) : view === 'queue' ? (
        <div className="space-y-5">
          <PageHeader title="Call Queue" />
          <LeadCallQueue employee={employee} category={category} refreshKey={refreshKey} onOpenLead={openWorkspace} />
        </div>
      ) : view === 'calendar' ? (
        <div className="space-y-5">
          <PageHeader title="Follow-up Calendar" />
          <LeadCalendar employee={employee} category={category} refreshKey={refreshKey} onOpenLead={openWorkspace} />
        </div>
      ) : (
        <div className="space-y-5">
          <PageHeader title="Pipeline Board" />
          <LeadPipeline employee={employee} category={category} refreshKey={refreshKey} onOpen={openWorkspace} />
        </div>
      )}

      {form.open && (
        <LeadForm employee={employee} mode={form.mode} lead={form.lead}
          onClose={() => setForm(f => ({ ...f, open: false }))}
          onSaved={() => { setForm(f => ({ ...f, open: false })); flash(form.mode === 'create' ? 'Lead created' : 'Lead updated'); bump(); }}
          onOpenExisting={openWorkspace} />
      )}
      {assign.open && (
        <LeadAssignModal leads={assign.leads}
          onClose={() => setAssign({ open: false, leads: [] })}
          onAssigned={count => { setAssign({ open: false, leads: [] }); flash(`${count} lead${count === 1 ? '' : 's'} assigned`); bump(); }} />
      )}
      {dupOpen && isAdmin && (
        <LeadDuplicateQueue employee={employee}
          onClose={() => setDupOpen(false)}
          onOpenLead={openWorkspace}
          onChanged={bump} />
      )}
      <LeadReminderPopup employee={employee} onOpenLead={openWorkspace} />
      {toast && <Toast text={toast} />}
    </div>
  );
}

function Toast({ text }: { text: string }) {
  return (
    <div className="fixed bottom-6 right-6 z-[80] px-4 py-3 rounded-xl shadow-2xl text-sm font-semibold"
      style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>{text}</div>
  );
}
