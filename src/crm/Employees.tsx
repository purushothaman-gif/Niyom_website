import React, { useEffect, useState, useCallback } from 'react';
import { LogoLoader } from '../components/LogoLoader';
import { supabase } from '../lib/supabase';
import { NWEmployee } from './types';
import { fmtDate } from './utils';
import { Plus, X, Pencil, Users, UserCheck, UserX, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';

interface Props { employee: NWEmployee; }

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-bold text-text-primary">{title}</h3>
          <button onClick={onClose} style={{ color: 'var(--text-faint)' }}><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Display-only job titles (NOT authorization — that stays on `role`).
const DESIGNATIONS = ['Relationship Manager', 'Senior Relationship Manager', 'Designated Partner'];

export default function Employees({ employee }: Props) {
  const [employees, setEmployees] = useState<NWEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editEmp, setEditEmp] = useState<NWEmployee | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const [addForm, setAddForm] = useState({ full_name: '', email: '', password: '', role: 'employee', designation: 'Relationship Manager', employee_code: '' });
  const [editForm, setEditForm] = useState({ full_name: '', phone: '', role: 'employee', designation: 'Relationship Manager', status: 'active' });
  const [addError, setAddError] = useState('');

  const isSuperAdmin = employee.role === 'super_admin';

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('nw_employees').select('*').order('created_at', { ascending: false });
    setEmployees((data as NWEmployee[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!addForm.employee_code || !addForm.full_name || !addForm.email || !addForm.password) { setAddError('All fields are required.'); return; }
    if (!/^NIYOM-\d+$/i.test(addForm.employee_code.trim())) { setAddError('Employee ID must be in format NIYOM-001'); return; }
    if (addForm.password.length < 8) { setAddError('Password must be at least 8 characters.'); return; }
    if (!addForm.designation.trim()) { setAddError('Designation is required.'); return; }
    setAddError('');
    setSaving(true);

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-crm-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ email: addForm.email, password: addForm.password, full_name: addForm.full_name, role: addForm.role, designation: addForm.designation, employee_code: addForm.employee_code.trim().toUpperCase() }),
    });
    const json = await res.json();
    setSaving(false);
    if (!res.ok || json.error) { setAddError(json.error || 'Failed to create employee'); return; }
    setShowAdd(false);
    setAddForm({ full_name: '', email: '', password: '', role: 'employee', designation: 'Relationship Manager', employee_code: '' });
    showToast(`Employee created with code ${json.employee_code}`);
    load();
  };

  const handleEdit = async () => {
    if (!editEmp) return;
    if (!editForm.designation.trim()) { showToast('Designation is required.', false); return; }
    setSaving(true);
    const { error } = await supabase.from('nw_employees').update({ full_name: editForm.full_name, phone: editForm.phone, role: editForm.role, designation: editForm.designation, status: editForm.status, updated_at: new Date().toISOString() }).eq('id', editEmp.id);
    setSaving(false);
    if (error) { showToast(error.message, false); return; }
    setEditEmp(null);
    showToast('Employee updated.');
    load();
  };

  const toggleStatus = async (emp: NWEmployee) => {
    const newStatus = emp.status === 'active' ? 'inactive' : 'active';
    const { error } = await supabase.from('nw_employees').update({ status: newStatus }).eq('id', emp.id);
    if (error) { showToast(error.message, false); return; }
    showToast(`${emp.full_name} marked as ${newStatus}.`);
    load();
  };

  const stats = {
    total: employees.length,
    active: employees.filter(e => e.status === 'active').length,
    inactive: employees.filter(e => e.status === 'inactive').length,
  };

  const inputClass = "w-full px-3 py-2.5 rounded-xl text-sm text-text-primary outline-none";
  const inputStyle = { background: 'var(--bg-base)', border: '1px solid var(--border)' };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Team</p>
          <h1 className="text-2xl font-bold text-text-primary">Employees</h1>
        </div>
        {isSuperAdmin && (
          <button onClick={() => { setShowAdd(true); setAddError(''); }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-on-accent" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            <Plus className="w-4 h-4" /> Add Employee
          </button>
        )}
      </div>

      {toast && (
        <div className="p-3 rounded-xl flex items-center gap-2" style={{ background: toast.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${toast.ok ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
          {toast.ok ? <CheckCircle2 className="w-4 h-4 text-c-emerald" /> : <AlertCircle className="w-4 h-4 text-c-red" />}
          <p className={`text-sm ${toast.ok ? 'text-c-emerald' : 'text-c-red'}`}>{toast.msg}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total', value: stats.total, icon: Users, color: 'var(--accent)' },
          { label: 'Active', value: stats.active, icon: UserCheck, color: 'var(--success)' },
          { label: 'Inactive', value: stats.inactive, icon: UserX, color: 'var(--danger)' },
        ].map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="rounded-2xl p-5 flex items-center gap-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `color-mix(in srgb, ${s.color} 8%, transparent)` }}>
                <Icon className="w-5 h-5" style={{ color: s.color }} />
              </div>
              <div>
                <p className="text-2xl font-bold text-text-primary">{s.value}</p>
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{s.label}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full nw-table">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {['Employee', 'Code', 'Designation', 'Status', 'Joined', 'Actions'].map(h => (
                  <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-12"><LogoLoader size={40} /></td></tr>
              ) : employees.map(e => (
                <tr key={e.id} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)' }}>
                        {e.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-text-primary">{e.full_name}</p>
                        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{e.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5"><span className="text-xs font-mono px-2 py-1 rounded" style={{ background: 'var(--bg-raised)', color: 'var(--accent)' }}>{e.employee_code}</span></td>
                  <td className="px-5 py-3.5">
                    <span className="text-xs font-semibold px-2 py-1 rounded-lg border text-c-blue bg-c-blue/10 border-c-blue/20">{e.designation ?? 'Relationship Manager'}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-lg border ${e.status === 'active' ? 'text-c-emerald bg-c-emerald/10 border-c-emerald/20' : 'text-c-red bg-c-red/10 border-c-red/20'}`}>
                      {e.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-muted)' }}>{fmtDate(e.joining_date || e.created_at)}</td>
                  <td className="px-5 py-3.5">
                    {e.id !== employee.id && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => { setEditEmp(e); setEditForm({ full_name: e.full_name, phone: e.phone || '', role: e.role, designation: e.designation ?? 'Relationship Manager', status: e.status }); }}
                          className="p-1.5 rounded-lg" style={{ color: 'var(--text-faint)' }}
                          onMouseEnter={ev => (ev.currentTarget.style.color = 'rgb(var(--info-soft-rgb))')} onMouseLeave={ev => (ev.currentTarget.style.color = 'var(--text-faint)')}>
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => toggleStatus(e)} className="p-1.5 rounded-lg" style={{ color: 'var(--text-faint)' }}
                          onMouseEnter={ev => (ev.currentTarget.style.color = e.status === 'active' ? 'var(--danger)' : 'var(--success)')}
                          onMouseLeave={ev => (ev.currentTarget.style.color = 'var(--text-faint)')}>
                          {e.status === 'active' ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Employee Modal */}
      {showAdd && (
        <Modal title="Add Employee" onClose={() => setShowAdd(false)}>
          <div className="p-6 space-y-4">
            {addError && <div className="p-3 rounded-xl text-sm text-c-red" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{addError}</div>}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Employee ID <span style={{ color: 'var(--accent)' }}>*</span></label>
              <input type="text" value={addForm.employee_code} onChange={e => setAddForm(f => ({ ...f, employee_code: e.target.value }))} placeholder="e.g. NIYOM-002" className={inputClass} style={inputStyle} />
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>Client IDs will be generated as NW-002-0001, NW-002-0002, ...</p>
            </div>
            {[['Full Name', 'full_name', 'text'], ['Email', 'email', 'email']].map(([label, key, type]) => (
              <div key={key}>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
                <input type={type} value={(addForm as any)[key]} onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))} className={inputClass} style={inputStyle} />
              </div>
            ))}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Password</label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} placeholder="Min 8 characters" className={`${inputClass} pr-10`} style={inputStyle} />
                <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }}>
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Role <span className="normal-case font-normal" style={{ color: 'var(--text-faint)' }}>(access level — internal only)</span></label>
              <select value={addForm.role} onChange={e => setAddForm(f => ({ ...f, role: e.target.value }))} className={inputClass} style={inputStyle}>
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
                {isSuperAdmin && <option value="super_admin">Super Admin</option>}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Designation <span className="normal-case font-normal" style={{ color: 'var(--text-faint)' }}>(shown on documents &amp; emails)</span></label>
              <select value={addForm.designation} onChange={e => setAddForm(f => ({ ...f, designation: e.target.value }))} className={inputClass} style={inputStyle}>
                {DESIGNATIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Employee will be prompted to change password on first login.</p>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-xl text-sm" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
              <button onClick={handleAdd} disabled={saving} className="px-5 py-2 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                {saving ? 'Creating...' : 'Create Employee'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Employee Modal */}
      {editEmp && (
        <Modal title={`Edit — ${editEmp.full_name}`} onClose={() => setEditEmp(null)}>
          <div className="p-6 space-y-4">
            {[['Full Name', 'full_name', 'text'], ['Phone', 'phone', 'tel']].map(([label, key, type]) => (
              <div key={key}>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>{label}</label>
                <input type={type} value={(editForm as any)[key]} onChange={e => setEditForm(f => ({ ...f, [key]: e.target.value }))} className={inputClass} style={inputStyle} />
              </div>
            ))}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Role <span className="normal-case font-normal" style={{ color: 'var(--text-faint)' }}>(access level — internal only)</span></label>
              <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))} className={inputClass} style={inputStyle}>
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
                {isSuperAdmin && <option value="super_admin">Super Admin</option>}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Designation <span className="normal-case font-normal" style={{ color: 'var(--text-faint)' }}>(shown on documents &amp; emails)</span></label>
              <select value={editForm.designation} onChange={e => setEditForm(f => ({ ...f, designation: e.target.value }))} className={inputClass} style={inputStyle}>
                {DESIGNATIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Status</label>
              <select value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))} className={inputClass} style={inputStyle}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setEditEmp(null)} className="px-4 py-2 rounded-xl text-sm" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
              <button onClick={handleEdit} disabled={saving} className="px-5 py-2 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
