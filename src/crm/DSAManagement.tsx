import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { NWEmployee, NWDSA } from './types';
import {
  Handshake, Plus, X, Upload, CheckCircle2, AlertCircle,
  Search, Phone, Mail, CreditCard, Building2, User, Eye,
  ToggleLeft, ToggleRight, Trash2, ChevronDown, Pencil,
} from 'lucide-react';

interface Props { employee: NWEmployee; }

interface DSAFormData {
  full_name: string;
  email: string;
  mobile: string;
  pan: string;
  address: string;
  bank_name: string;
  bank_account: string;
  bank_ifsc: string;
}

const EMPTY_FORM: DSAFormData = {
  full_name: '', email: '', mobile: '', pan: '',
  address: '', bank_name: '', bank_account: '', bank_ifsc: '',
};

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label}{required && <span className="ml-0.5" style={{ color: 'var(--accent)' }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      className={`w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none transition-all ${props.className || ''}`}
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
        ...props.style,
      }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      {...props}
      className={`w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none transition-all resize-none ${props.className || ''}`}
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
        ...props.style,
      }}
      onFocus={e => { setFocused(true); props.onFocus?.(e); }}
      onBlur={e => { setFocused(false); props.onBlur?.(e); }}
    />
  );
}

export default function DSAManagement({ employee }: Props) {
  const [dsas, setDsas] = useState<NWDSA[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  // When set, the form modal is in EDIT mode for this DSA (id + code retained;
  // the code is immutable and reused for the document storage slot).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState('');
  const [form, setForm] = useState<DSAFormData>(EMPTY_FORM);
  const [docs, setDocs] = useState<{ photo: File | null; pan: File | null; bank: File | null }>({ photo: null, pan: null, bank: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [search, setSearch] = useState('');
  const [viewDSA, setViewDSA] = useState<NWDSA | null>(null);
  const [deleteDSA, setDeleteDSA] = useState<NWDSA | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [empList, setEmpList] = useState<{ id: string; full_name: string; employee_code: string }[]>([]);
  const [empFilter, setEmpFilter] = useState('all');

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';

  const fetchDSAs = useCallback(async () => {
    setLoading(true);
    // Ownership = the DSA assignment only (nw_dsa.employee_id). A non-admin sees
    // exactly the DSAs assigned to them; admins see all and may filter by the
    // assigned employee. Also defended in depth by RLS.
    let q = supabase.from('nw_dsa').select('*, employee:nw_employees(full_name, employee_code)').order('dsa_code');
    if (!isAdmin) q = q.eq('employee_id', employee.id);
    else if (empFilter !== 'all') q = q.eq('employee_id', empFilter);
    const { data } = await q;
    setDsas((data as NWDSA[]) || []);
    setLoading(false);
  }, [isAdmin, employee.id, empFilter]);

  useEffect(() => { fetchDSAs(); }, [fetchDSAs]);

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from('nw_employees').select('id, full_name, employee_code').eq('status', 'active').order('full_name')
      .then(({ data }) => setEmpList((data as any[]) || []));
  }, [isAdmin]);

  const set = (k: keyof DSAFormData, v: string) => setForm(f => ({ ...f, [k]: v }));

  const validate = (): boolean => {
    if (!form.full_name.trim()) { setError('Full name is required.'); return false; }
    if (!form.mobile.trim() || !/^[6-9]\d{9}$/.test(form.mobile)) { setError('Valid 10-digit mobile number is required.'); return false; }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setError('Valid email is required.'); return false; }
    if (!form.pan.trim() || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan)) { setError('Valid PAN (e.g. ABCDE1234F) is required.'); return false; }
    if (!form.bank_name.trim()) { setError('Bank name is required.'); return false; }
    if (!form.bank_account.trim()) { setError('Bank account number is required.'); return false; }
    if (!form.bank_ifsc.trim() || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.bank_ifsc)) { setError('Valid IFSC code is required.'); return false; }
    return true;
  };

  const uploadDoc = async (file: File, path: string): Promise<string | null> => {
    const { error } = await supabase.storage.from('crm-documents').upload(path, file, { upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from('crm-documents').getPublicUrl(path);
    return data.publicUrl;
  };

  const openCreate = () => {
    setEditingId(null);
    setEditingCode('');
    setForm(EMPTY_FORM);
    setDocs({ photo: null, pan: null, bank: null });
    setError('');
    setSuccess('');
    setShowForm(true);
  };

  // Open the shared form modal in EDIT mode, prefilled from an existing DSA.
  const openEdit = (dsa: NWDSA) => {
    setEditingId(dsa.id);
    setEditingCode(dsa.dsa_code);
    setForm({
      full_name: dsa.full_name || '',
      email: dsa.email || '',
      mobile: dsa.mobile || '',
      pan: dsa.pan || '',
      address: dsa.address || '',
      bank_name: dsa.bank_name || '',
      bank_account: dsa.bank_account || '',
      bank_ifsc: dsa.bank_ifsc || '',
    });
    setDocs({ photo: null, pan: null, bank: null });
    setError('');
    setSuccess('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setEditingCode('');
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!validate()) return;

    setSaving(true);
    try {
      if (editingId) {
        // EDIT: update the existing DSA in place. The code is immutable and its
        // storage slot is reused, so only newly-picked documents are re-uploaded
        // (upsert overwrites); untouched documents keep their existing URLs.
        const slot = `dsa/${editingCode}`;
        const [photoUrl, panUrl, bankUrl] = await Promise.all([
          docs.photo ? uploadDoc(docs.photo, `${slot}/photo`) : Promise.resolve(null),
          docs.pan   ? uploadDoc(docs.pan,   `${slot}/pan`)   : Promise.resolve(null),
          docs.bank  ? uploadDoc(docs.bank,  `${slot}/bank`)  : Promise.resolve(null),
        ]);

        const updates: Record<string, any> = {
          full_name: form.full_name.trim(),
          email: form.email.trim().toLowerCase(),
          mobile: form.mobile,
          pan: form.pan.toUpperCase(),
          address: form.address.trim(),
          bank_name: form.bank_name.trim(),
          bank_account: form.bank_account.trim(),
          bank_ifsc: form.bank_ifsc.toUpperCase(),
        };
        if (photoUrl) updates.photo_url = photoUrl;
        if (panUrl) updates.pan_doc_url = panUrl;
        if (bankUrl) updates.bank_doc_url = bankUrl;

        const { error: updateErr } = await supabase.from('nw_dsa').update(updates).eq('id', editingId);
        if (updateErr) throw updateErr;

        setSuccess(`DSA ${editingCode} updated successfully.`);
      } else {
        const { data: dsaCode, error: codeErr } = await supabase.rpc('nw2_generate_dsa_code', { p_employee_id: employee.id });
        if (codeErr || !dsaCode) throw new Error('Failed to generate DSA code.');

        const slot = `dsa/${dsaCode}`;
        const [photoUrl, panUrl, bankUrl] = await Promise.all([
          docs.photo ? uploadDoc(docs.photo, `${slot}/photo`) : Promise.resolve(null),
          docs.pan   ? uploadDoc(docs.pan,   `${slot}/pan`)   : Promise.resolve(null),
          docs.bank  ? uploadDoc(docs.bank,  `${slot}/bank`)  : Promise.resolve(null),
        ]);

        const { error: insertErr } = await supabase.from('nw_dsa').insert([{
          dsa_code: dsaCode,
          employee_id: employee.id,
          full_name: form.full_name.trim(),
          email: form.email.trim().toLowerCase(),
          mobile: form.mobile,
          pan: form.pan.toUpperCase(),
          address: form.address.trim(),
          bank_name: form.bank_name.trim(),
          bank_account: form.bank_account.trim(),
          bank_ifsc: form.bank_ifsc.toUpperCase(),
          photo_url: photoUrl,
          pan_doc_url: panUrl,
          bank_doc_url: bankUrl,
          status: 'active',
        }]);
        if (insertErr) throw insertErr;

        setSuccess(`DSA created successfully with code ${dsaCode}.`);
      }

      setForm(EMPTY_FORM);
      setDocs({ photo: null, pan: null, bank: null });
      setEditingId(null);
      setEditingCode('');
      setShowForm(false);
      fetchDSAs();
    } catch (err: any) {
      setError(err.message || (editingId ? 'Failed to update DSA.' : 'Failed to create DSA.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteDSA) return;
    setDeleting(true);
    await supabase.from('nw_dsa').delete().eq('id', deleteDSA.id);
    setDeleting(false);
    setDeleteDSA(null);
    fetchDSAs();
  };

  const toggleStatus = async (dsa: NWDSA) => {
    const newStatus = dsa.status === 'active' ? 'inactive' : 'active';
    await supabase.from('nw_dsa').update({ status: newStatus }).eq('id', dsa.id);
    fetchDSAs();
  };

  const filtered = dsas.filter(d =>
    !search ||
    d.full_name.toLowerCase().includes(search.toLowerCase()) ||
    d.dsa_code.toLowerCase().includes(search.toLowerCase()) ||
    d.mobile.includes(search) ||
    d.pan.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>DSA</p>
          <h1 className="text-2xl font-bold text-text-primary">DSA Management</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Create and manage Direct Selling Agents</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
          <Plus className="w-4 h-4" /> New DSA
        </button>
      </div>

      {/* Feedback */}
      {success && (
        <div className="p-4 rounded-xl flex items-center gap-3" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--success)' }} />
          <p className="text-sm" style={{ color: 'var(--success)' }}>{success}</p>
          <button onClick={() => setSuccess('')} className="ml-auto" style={{ color: 'var(--text-faint)' }}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Create DSA Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}>
          <div className="w-full max-w-2xl rounded-2xl overflow-hidden flex flex-col max-h-[90vh]" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <p className="text-xs uppercase tracking-widest mb-0.5" style={{ color: 'var(--accent)' }}>{editingId ? `Edit DSA · ${editingCode}` : 'New DSA'}</p>
                <h2 className="text-lg font-bold text-text-primary">{editingId ? 'Edit DSA Details' : 'Create DSA Code'}</h2>
              </div>
              <button onClick={closeForm} style={{ color: 'var(--text-faint)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-bright)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="overflow-y-auto">
              <div className="px-6 py-5 space-y-5">
                {error && (
                  <div className="p-3 rounded-xl flex items-center gap-2.5" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                    <AlertCircle className="w-4 h-4 flex-shrink-0 text-c-red" />
                    <p className="text-sm text-c-red">{error}</p>
                  </div>
                )}

                {/* Personal */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-faint)' }}>Personal Details</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <Field label="Full Name" required>
                        <Input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Full name as per PAN" />
                      </Field>
                    </div>
                    <Field label="Mobile Number" required>
                      <Input type="tel" value={form.mobile} onChange={e => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="9876543210" />
                    </Field>
                    <Field label="Email" required>
                      <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="dsa@example.com" />
                    </Field>
                    <Field label="PAN Number" required>
                      <Input value={form.pan} onChange={e => set('pan', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} placeholder="ABCDE1234F" className="font-mono tracking-widest" />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Address">
                        <Textarea rows={2} value={form.address} onChange={e => set('address', e.target.value)} placeholder="Full address" />
                      </Field>
                    </div>
                  </div>
                </div>

                {/* Bank */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-faint)' }}>Bank Details</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Bank Name" required>
                      <Input value={form.bank_name} onChange={e => set('bank_name', e.target.value)} placeholder="HDFC Bank" />
                    </Field>
                    <Field label="IFSC Code" required>
                      <Input value={form.bank_ifsc} onChange={e => set('bank_ifsc', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))} placeholder="HDFC0001234" className="font-mono" />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Account Number" required>
                        <Input value={form.bank_account} onChange={e => set('bank_account', e.target.value.replace(/\D/g, ''))} placeholder="Account number" className="font-mono" />
                      </Field>
                    </div>
                  </div>
                </div>

                {/* Documents */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--text-faint)' }}>Documents (Optional)</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {([
                      { key: 'photo', label: 'Photo' },
                      { key: 'pan',   label: 'PAN Card' },
                      { key: 'bank',  label: 'Bank Cheque' },
                    ] as const).map(({ key, label }) => (
                      <label key={key} className="flex flex-col items-center gap-2 p-4 rounded-xl cursor-pointer transition-all"
                        style={{ border: `1px dashed ${docs[key] ? 'var(--success)' : 'var(--border-strong)'}`, background: docs[key] ? 'rgba(16,185,129,0.04)' : 'transparent' }}>
                        {docs[key]
                          ? <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--success)' }} />
                          : <Upload className="w-5 h-5" style={{ color: 'var(--text-faint)' }} />}
                        <span className="text-xs text-center" style={{ color: docs[key] ? 'var(--success)' : 'var(--text-muted)' }}>
                          {docs[key] ? docs[key]!.name.slice(0, 18) : label}
                        </span>
                        <input type="file" accept="image/*,application/pdf" className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) setDocs(d => ({ ...d, [key]: f })); }} />
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 flex items-center justify-end gap-3" style={{ borderTop: '1px solid var(--border)' }}>
                <button type="button" onClick={closeForm}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                  Cancel
                </button>
                <button type="submit" disabled={saving}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50 flex items-center gap-2"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                  {editingId
                    ? (saving ? 'Saving...' : <><Pencil className="w-4 h-4" /> Save Changes</>)
                    : (saving ? 'Creating...' : <><Plus className="w-4 h-4" /> Create DSA</>)}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail view modal */}
      {viewDSA && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}>
          <div className="w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <p className="text-xs font-mono" style={{ color: 'var(--accent)' }}>{viewDSA.dsa_code}</p>
                <h2 className="text-lg font-bold text-text-primary">{viewDSA.full_name}</h2>
              </div>
              <button onClick={() => setViewDSA(null)} style={{ color: 'var(--text-faint)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-bright)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              {[
                { label: 'Mobile', value: viewDSA.mobile, icon: Phone },
                { label: 'Email', value: viewDSA.email, icon: Mail },
                { label: 'PAN', value: viewDSA.pan, icon: CreditCard },
                { label: 'Bank', value: `${viewDSA.bank_name} · ${viewDSA.bank_account}`, icon: Building2 },
                { label: 'IFSC', value: viewDSA.bank_ifsc, icon: Building2 },
                { label: 'Address', value: viewDSA.address || '—', icon: User },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="flex items-start gap-3 p-3 rounded-xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                  <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{label}</p>
                    <p className="text-sm font-medium text-text-primary font-mono">{value}</p>
                  </div>
                </div>
              ))}
              {/* Document links */}
              {(viewDSA.photo_url || viewDSA.pan_doc_url || viewDSA.bank_doc_url) && (
                <div className="flex gap-2 flex-wrap pt-1">
                  {viewDSA.photo_url && <a href={viewDSA.photo_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: 'rgba(var(--accent-rgb),0.08)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}><Eye className="w-3.5 h-3.5" /> Photo</a>}
                  {viewDSA.pan_doc_url && <a href={viewDSA.pan_doc_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: 'rgba(var(--accent-rgb),0.08)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}><Eye className="w-3.5 h-3.5" /> PAN Card</a>}
                  {viewDSA.bank_doc_url && <a href={viewDSA.bank_doc_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: 'rgba(var(--accent-rgb),0.08)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}><Eye className="w-3.5 h-3.5" /> Bank Doc</a>}
                </div>
              )}
            </div>
            <div className="px-6 pb-5">
              <button onClick={() => setViewDSA(null)} className="w-full py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteDSA && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-sm font-bold text-text-primary">Delete DSA</h2>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Are you sure you want to permanently delete{' '}
                <span className="text-text-primary font-semibold">{deleteDSA.full_name}</span>{' '}
                <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>({deleteDSA.dsa_code})</span>?
              </p>
              <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.06)', color: 'rgb(var(--danger-soft-rgb))', border: '1px solid rgba(239,68,68,0.15)' }}>
                This action cannot be undone. Clients linked to this DSA will remain but lose their DSA association.
              </p>
            </div>
            <div className="px-6 pb-5 flex justify-end gap-3">
              <button onClick={() => setDeleteDSA(null)} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <button onClick={handleDelete} disabled={deleting} className="px-5 py-2 rounded-xl text-sm font-bold text-text-primary disabled:opacity-50 flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)' }}>
                <Trash2 className="w-3.5 h-3.5" />
                {deleting ? 'Deleting...' : 'Delete DSA'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search + Stats */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-faint)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, code, mobile or PAN..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-text-primary outline-none"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
        </div>
        {isAdmin && (
          <div className="relative">
            <select value={empFilter} onChange={e => setEmpFilter(e.target.value)}
              className="pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(var(--accent-rgb),0.4)' }}>
              <option value="all">All Employees</option>
              {empList.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--accent)' }} />
          </div>
        )}
        <div className="flex items-center gap-3">
          {[
            { label: 'Total', value: dsas.length, color: 'var(--accent)' },
            { label: 'Active', value: dsas.filter(d => d.status === 'active').length, color: 'var(--success)' },
            { label: 'Inactive', value: dsas.filter(d => d.status === 'inactive').length, color: 'var(--text-muted)' },
          ].map(s => (
            <div key={s.label} className="px-4 py-2 rounded-xl text-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* DSA List */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        {loading ? (
          <div className="py-16 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Handshake className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--border-strong)' }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--text-faint)' }}>{search ? 'No DSAs match your search' : 'No DSAs yet'}</p>
            {!search && <p className="text-xs mt-1" style={{ color: 'var(--border-strong)' }}>Click "New DSA" to create one</p>}
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="hidden md:grid grid-cols-[1fr_1fr_1fr_1fr_auto] px-5 py-3 gap-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['DSA', 'Contact', 'PAN', 'Bank', 'Actions'].map(h => (
                <p key={h} className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</p>
              ))}
            </div>
            {filtered.map((dsa, i) => (
              <div key={dsa.id}
                className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_1fr_auto] px-5 py-4 gap-4 items-center"
                style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--bg-raised)' : 'none' }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                {/* DSA info */}
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-text-primary">{dsa.full_name}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-md font-semibold ${dsa.status === 'active' ? '' : ''}`}
                      style={{
                        background: dsa.status === 'active' ? 'rgba(16,185,129,0.1)' : 'rgba(107,107,107,0.1)',
                        color: dsa.status === 'active' ? 'var(--success)' : 'var(--text-muted)',
                      }}>
                      {dsa.status}
                    </span>
                  </div>
                  <p className="text-xs font-mono font-bold" style={{ color: 'var(--accent)' }}>{dsa.dsa_code}</p>
                  {dsa.employee && <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>by {dsa.employee.full_name}</p>}
                </div>
                {/* Contact */}
                <div>
                  <p className="text-sm text-text-primary">{dsa.mobile}</p>
                  <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>{dsa.email}</p>
                </div>
                {/* PAN */}
                <div>
                  <p className="text-sm font-mono text-text-primary">{dsa.pan}</p>
                </div>
                {/* Bank */}
                <div>
                  <p className="text-sm text-text-primary truncate">{dsa.bank_name}</p>
                  <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>{dsa.bank_ifsc}</p>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-2">
                  <button onClick={() => setViewDSA(dsa)} title="View details"
                    className="p-2 rounded-lg transition-colors"
                    style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                    onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                    <Eye className="w-4 h-4" />
                  </button>
                  {/* Edit — stewardship: assigned employee or admin (matches the
                      nw_dsa UPDATE policy). */}
                  {(isAdmin || dsa.employee_id === employee.id) && (
                    <button onClick={() => openEdit(dsa)} title="Edit DSA"
                      className="p-2 rounded-lg transition-colors"
                      style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  {/* Status toggle — stewardship: assigned employee or admin
                      (non-destructive). */}
                  {(isAdmin || dsa.employee_id === employee.id) && (
                    <button onClick={() => toggleStatus(dsa)} title={dsa.status === 'active' ? 'Deactivate' : 'Activate'}
                      className="p-2 rounded-lg transition-colors"
                      style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', color: dsa.status === 'active' ? 'var(--success)' : 'var(--text-faint)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = dsa.status === 'active' ? 'var(--danger)' : 'var(--success)')}
                      onMouseLeave={e => (e.currentTarget.style.color = dsa.status === 'active' ? 'var(--success)' : 'var(--text-faint)')}>
                      {dsa.status === 'active' ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    </button>
                  )}
                  {/* Delete — admin only: cascades into historical debit notes. */}
                  {isAdmin && (
                    <button onClick={() => setDeleteDSA(dsa)} title="Delete DSA"
                      className="p-2 rounded-lg transition-colors"
                      style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', color: 'var(--text-faint)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
