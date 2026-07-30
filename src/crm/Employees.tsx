import React, { useEffect, useState, useCallback, useRef } from 'react';
import { LogoLoader } from '../components/LogoLoader';
import { supabase } from '../lib/supabase';
import { NWEmployee } from './types';
import { EmployeeAvatar } from './EmployeeAvatar';
import ImageCropModal from './ImageCropModal';
import { fmtDate } from './utils';
import { Plus, X, Pencil, Users, UserCheck, UserX, Eye, EyeOff, CheckCircle2, AlertCircle, Trash2, AlertTriangle } from 'lucide-react';

interface Props { employee: NWEmployee; }

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}>
      <div className={`w-full ${wide ? 'max-w-lg' : 'max-w-md'} rounded-2xl overflow-hidden`} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
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

// Workload snapshot returned by the delete-crm-user edge function.
interface DeleteImpact {
  clients: number; leads: number; dsas: number; tickets_open: number;
  transactions: number; deals: number; debit_notes: number;
  marketing_content: number; referral_links: number;
}

export default function Employees({ employee }: Props) {
  const [employees, setEmployees] = useState<NWEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editEmp, setEditEmp] = useState<NWEmployee | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [editAvatar, setEditAvatar] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete / offboarding (resignation) — super admin only.
  const [deleteEmp, setDeleteEmp] = useState<NWEmployee | null>(null);
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [successorId, setSuccessorId] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [confirmCode, setConfirmCode] = useState('');

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

  // Called with the cropped square (JPEG) blob from the crop modal.
  const handleCroppedUpload = async (blob: Blob) => {
    if (!editEmp) return;
    setUploadingPhoto(true);
    const path = `avatars/${editEmp.id}.jpg`; // fixed ext → upsert always overwrites, no orphans
    const { error: upErr } = await supabase.storage.from('employee-avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (upErr) { setUploadingPhoto(false); showToast(upErr.message, false); return; }
    const { data } = supabase.storage.from('employee-avatars').getPublicUrl(path);
    const publicUrl = `${data.publicUrl}?v=${Date.now()}`; // cache-bust so a re-upload shows immediately
    const { error: dbErr } = await supabase.from('nw_employees').update({ avatar_url: publicUrl, updated_at: new Date().toISOString() }).eq('id', editEmp.id);
    setUploadingPhoto(false);
    if (dbErr) { showToast(dbErr.message, false); return; }
    setEditAvatar(publicUrl);
    setEmployees(prev => prev.map(x => (x.id === editEmp.id ? { ...x, avatar_url: publicUrl } : x)));
    setCropFile(null);
    showToast('Photo updated.');
  };

  const handleRemovePhoto = async () => {
    if (!editEmp) return;
    setUploadingPhoto(true);
    const { error } = await supabase.from('nw_employees').update({ avatar_url: null, updated_at: new Date().toISOString() }).eq('id', editEmp.id);
    setUploadingPhoto(false);
    if (error) { showToast(error.message, false); return; }
    setEditAvatar(null);
    setEmployees(prev => prev.map(x => (x.id === editEmp.id ? { ...x, avatar_url: null } : x)));
    showToast('Photo removed.');
  };

  const toggleStatus = async (emp: NWEmployee) => {
    const newStatus = emp.status === 'active' ? 'inactive' : 'active';
    const { error } = await supabase.from('nw_employees').update({ status: newStatus }).eq('id', emp.id);
    if (error) { showToast(error.message, false); return; }
    showToast(`${emp.full_name} marked as ${newStatus}.`);
    load();
  };

  const callDeleteFn = async (payload: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-crm-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify(payload),
    });
    return { res, json: await res.json() };
  };

  // Opens the delete modal and pulls the employee's live workload, so the
  // admin sees exactly what has to change hands before the account goes.
  const openDelete = async (emp: NWEmployee) => {
    setDeleteEmp(emp);
    setImpact(null);
    setDeleteError('');
    setSuccessorId('');
    setDeleteReason('');
    setConfirmCode('');
    setImpactLoading(true);
    const { res, json } = await callDeleteFn({ mode: 'impact', employee_id: emp.id });
    setImpactLoading(false);
    if (!res.ok || json.error) { setDeleteError(json.error || 'Could not load employee records.'); return; }
    setImpact(json.impact as DeleteImpact);
  };

  const ownedCount = impact ? impact.clients + impact.leads + impact.dsas + impact.tickets_open : 0;

  const handleDelete = async () => {
    if (!deleteEmp) return;
    if (ownedCount > 0 && !successorId) { setDeleteError('Choose an employee to take over this book first.'); return; }
    if (confirmCode.trim().toUpperCase() !== deleteEmp.employee_code.toUpperCase()) {
      setDeleteError(`Type ${deleteEmp.employee_code} to confirm.`); return;
    }
    setDeleteError('');
    setDeleting(true);
    const { res, json } = await callDeleteFn({
      mode: 'delete',
      employee_id: deleteEmp.id,
      confirm_code: confirmCode.trim(),
      reassign_to: successorId || null,
      reason: deleteReason.trim(),
    });
    setDeleting(false);
    if (!res.ok || json.error) { setDeleteError(json.error || 'Failed to delete employee.'); return; }
    setDeleteEmp(null);
    showToast(`${json.full_name} (${json.employee_code}) removed.` + (json.reassigned_to ? ` Book moved to ${json.reassigned_to}.` : ''));
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
                      <EmployeeAvatar name={e.full_name} url={e.avatar_url} size={36} rounded="xl"
                        badgeStyle={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)' }} />
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
                        <button onClick={() => { setEditEmp(e); setEditAvatar(e.avatar_url); setEditForm({ full_name: e.full_name, phone: e.phone || '', role: e.role, designation: e.designation ?? 'Relationship Manager', status: e.status }); }}
                          className="p-1.5 rounded-lg" style={{ color: 'var(--text-faint)' }}
                          onMouseEnter={ev => (ev.currentTarget.style.color = 'rgb(var(--info-soft-rgb))')} onMouseLeave={ev => (ev.currentTarget.style.color = 'var(--text-faint)')}>
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => toggleStatus(e)} className="p-1.5 rounded-lg" style={{ color: 'var(--text-faint)' }}
                          onMouseEnter={ev => (ev.currentTarget.style.color = e.status === 'active' ? 'var(--danger)' : 'var(--success)')}
                          onMouseLeave={ev => (ev.currentTarget.style.color = 'var(--text-faint)')}>
                          {e.status === 'active' ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        </button>
                        {isSuperAdmin && (
                          <button onClick={() => openDelete(e)} title="Delete employee (resignation)" className="p-1.5 rounded-lg" style={{ color: 'var(--text-faint)' }}
                            onMouseEnter={ev => (ev.currentTarget.style.color = 'var(--danger)')} onMouseLeave={ev => (ev.currentTarget.style.color = 'var(--text-faint)')}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
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
            {/* Profile photo */}
            <div className="flex items-center gap-4">
              <EmployeeAvatar name={editForm.full_name || editEmp.full_name} url={editAvatar} size={64} rounded="xl"
                badgeStyle={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)' }} textClassName="text-lg" />
              <div className="flex flex-col gap-2">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden"
                  onChange={ev => {
                    const f = ev.target.files?.[0];
                    ev.target.value = '';
                    if (!f) return;
                    if (!f.type.startsWith('image/')) { showToast('Please choose an image file.', false); return; }
                    if (f.size > 10 * 1024 * 1024) { showToast('Image must be under 10 MB.', false); return; }
                    setCropFile(f); // open the crop step before uploading
                  }} />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingPhoto}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold text-on-accent disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                    {uploadingPhoto ? 'Uploading…' : editAvatar ? 'Change photo' : 'Upload photo'}
                  </button>
                  {editAvatar && (
                    <button type="button" onClick={handleRemovePhoto} disabled={uploadingPhoto}
                      className="px-3 py-1.5 rounded-xl text-xs disabled:opacity-50"
                      style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                      Remove
                    </button>
                  )}
                </div>
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>JPG or PNG, up to 5 MB. Saved immediately.</p>
              </div>
            </div>
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

      {/* Delete Employee Modal — offboarding on resignation */}
      {deleteEmp && (
        <Modal title={`Delete Employee — ${deleteEmp.full_name}`} onClose={() => setDeleteEmp(null)} wide>
          <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
            <div className="p-4 rounded-xl flex gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertTriangle className="w-5 h-5 flex-shrink-0 text-c-red" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-text-primary">This permanently removes {deleteEmp.employee_code} and their CRM login.</p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Past work (transactions, deals, debit notes, activity logs) stays in the system but is no longer linked to a named employee.
                  Their alerts, saved views and marketing referral links are deleted. This cannot be undone — to keep a resigned employee's
                  records intact, mark them <span className="text-text-primary font-medium">Inactive</span> instead.
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="p-3 rounded-xl text-sm text-c-red" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>{deleteError}</div>
            )}

            {impactLoading ? (
              <div className="py-8 flex justify-center"><LogoLoader size={36} /></div>
            ) : impact && (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>Currently owned — moves to the new employee</p>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'Clients', value: impact.clients },
                      { label: 'Leads', value: impact.leads },
                      { label: 'DSAs', value: impact.dsas },
                      { label: 'Open tickets', value: impact.tickets_open },
                    ].map(s => (
                      <div key={s.label} className="rounded-xl p-3 text-center" style={{ background: 'var(--bg-raised)', border: `1px solid ${s.value > 0 ? 'rgba(239,68,68,0.25)' : 'var(--border)'}` }}>
                        <p className="text-lg font-bold text-text-primary">{s.value}</p>
                        <p className="text-[10px] leading-tight" style={{ color: 'var(--text-faint)' }}>{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>History — kept, but unlinked from the employee</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ['Transactions', impact.transactions],
                      ['Deal confirmations', impact.deals],
                      ['Debit notes', impact.debit_notes],
                      ['Marketing content', impact.marketing_content],
                      ['Referral links (deleted)', impact.referral_links],
                    ].map(([label, value]) => (
                      <span key={label as string} className="text-xs px-2 py-1 rounded-lg" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                        {label}: <span className="text-text-primary font-semibold">{value}</span>
                      </span>
                    ))}
                  </div>
                </div>

                {ownedCount > 0 && (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                      Hand over to <span style={{ color: 'var(--accent)' }}>*</span>
                    </label>
                    <select value={successorId} onChange={e => setSuccessorId(e.target.value)} className={inputClass} style={inputStyle}>
                      <option value="">— Select an employee —</option>
                      {employees.filter(x => x.id !== deleteEmp.id && x.status === 'active').map(x => (
                        <option key={x.id} value={x.id}>{x.full_name} ({x.employee_code})</option>
                      ))}
                    </select>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                      All clients, leads, DSAs and open tickets move to this employee, who is notified in the CRM.
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Reason (optional)</label>
                  <input type="text" value={deleteReason} onChange={e => setDeleteReason(e.target.value)} placeholder="e.g. Resigned — last working day 31 Jul 2026" className={inputClass} style={inputStyle} />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    Type <span className="font-mono" style={{ color: 'var(--accent)' }}>{deleteEmp.employee_code}</span> to confirm
                  </label>
                  <input type="text" value={confirmCode} onChange={e => setConfirmCode(e.target.value)} placeholder={deleteEmp.employee_code} className={inputClass} style={inputStyle} />
                </div>
              </>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setDeleteEmp(null)} className="px-4 py-2 rounded-xl text-sm" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
              <button onClick={handleDelete} disabled={deleting || impactLoading || !impact}
                className="px-5 py-2 rounded-xl text-sm font-bold text-text-primary disabled:opacity-50"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                {deleting ? 'Deleting...' : 'Delete Employee'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Crop step — shown after picking a file, before upload */}
      {cropFile && (
        <ImageCropModal
          file={cropFile}
          busy={uploadingPhoto}
          onCancel={() => setCropFile(null)}
          onApply={handleCroppedUpload}
        />
      )}
    </div>
  );
}
