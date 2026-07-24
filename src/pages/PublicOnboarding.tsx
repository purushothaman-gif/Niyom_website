import React, { useState } from 'react';
import {
  User, MapPin, Building2, Landmark,
  Upload, FileText, CheckCircle2, AlertCircle, ChevronRight, ArrowLeft,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Props {
  onBack: () => void;
}

const STEPS = ['Personal Info', 'Address', 'Demat & Bank', 'Documents', 'Review'];

const CLIENT_DOC_TYPES = [
  { type: 'PAN Card',      label: 'PAN Card Copy' },
  { type: 'CML',           label: 'Client Master List (CML)' },
  { type: 'Bank Document', label: 'Cancelled Cheque / Bank Statement' },
];

interface Form {
  full_name: string; pan: string; dob: string; phone: string; email: string;
  address: string; city: string; state: string; pincode: string;
  demat_account: string; dp_name: string;
  bank_account: string; bank_ifsc: string; bank_name: string;
  notes: string;
}

function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>
        {label}{required && <span className="ml-0.5" style={{ color: 'var(--accent)' }}>*</span>}
      </label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{hint}</p>}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...props}
      className="w-full px-3.5 py-2.5 rounded-xl text-sm text-white outline-none transition-all"
      style={{ background: 'var(--bg-base)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}` }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      {...props}
      rows={3}
      className="w-full px-3.5 py-2.5 rounded-xl text-sm text-white outline-none transition-all resize-none"
      style={{ background: 'var(--bg-base)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}` }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

const empty = (): Form => ({
  full_name: '', pan: '', dob: '', phone: '', email: '',
  address: '', city: '', state: '', pincode: '',
  demat_account: '', dp_name: '',
  bank_account: '', bank_ifsc: '', bank_name: '',
  notes: '',
});

export default function PublicOnboarding({ onBack }: Props) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(empty());
  const [docFiles, setDocFiles] = useState<{ type: string; file: File }[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [successData, setSuccessData] = useState<{ client_name: string; client_code: string } | null>(null);

  const set = (k: keyof Form, v: string) => setForm(f => ({ ...f, [k]: v }));
  const stepName = STEPS[step];
  const missingDocs = CLIENT_DOC_TYPES.filter(d => !docFiles.find(f => f.type === d.type));

  const handleDocFile = (type: string, file: File | null) => {
    if (!file) return;
    setDocFiles(prev => [...prev.filter(d => d.type !== type), { type, file }]);
  };

  const validate = (): boolean => {
    setError('');
    if (stepName === 'Personal Info') {
      if (!form.full_name.trim()) return err('Full name is required.');
      if (!form.pan.trim() || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan)) return err('Enter a valid PAN number (e.g. ABCDE1234F).');
      if (!form.dob) return err('Date of birth is required.');
      if (!form.phone.trim() || !/^[6-9]\d{9}$/.test(form.phone)) return err('Enter a valid 10-digit mobile number.');
      if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return err('Enter a valid email address.');
    }
    if (stepName === 'Address') {
      if (!form.address.trim()) return err('Address is required.');
      if (!form.city.trim()) return err('City is required.');
      if (!form.state.trim()) return err('State is required.');
      if (!form.pincode.trim() || form.pincode.length !== 6) return err('Enter a valid 6-digit pincode.');
    }
    if (stepName === 'Demat & Bank') {
      if (!form.demat_account.trim()) return err('Demat account number is required.');
      if (!form.dp_name.trim()) return err('DP Name is required.');
      if (!form.bank_account.trim()) return err('Bank account number is required.');
      if (!form.bank_ifsc.trim()) return err('IFSC code is required.');
      if (!form.bank_name.trim()) return err('Bank name is required.');
    }
    if (stepName === 'Documents') {
      if (missingDocs.length > 0) return err(`Please upload: ${missingDocs.map(d => d.label).join(', ')}`);
    }
    return true;
  };

  const err = (msg: string): false => { setError(msg); return false; };

  const handleNext = () => {
    if (!validate()) return;
    setStep(s => s + 1);
  };

  const uploadDoc = async (file: File, clientCode: string, type: string): Promise<string | null> => {
    const ext = file.name.substring(file.name.lastIndexOf('.'));
    const path = `clients/${clientCode}/PUBLIC_ONBOARD/${type.replace(/ /g, '_')}_${Date.now()}${ext}`;
    const { data } = await supabase.storage.from('crm-documents').upload(path, file, { upsert: true });
    return data?.path || null;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    setError('');

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const res = await fetch(`${supabaseUrl}/functions/v1/public-client-onboard`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Apikey': anonKey,
        },
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          pan: form.pan.toUpperCase(),
          dob: form.dob,
          phone: form.phone,
          email: form.email.trim().toLowerCase(),
          address: form.address.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          pincode: form.pincode.trim(),
          demat_account: form.demat_account.trim(),
          dp_name: form.dp_name.trim(),
          bank_account: form.bank_account.trim(),
          bank_ifsc: form.bank_ifsc.toUpperCase().trim(),
          bank_name: form.bank_name.trim(),
          notes: form.notes.trim(),
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        setSaving(false);
        setError(result.error || 'Onboarding failed. Please try again.');
        return;
      }

      // Upload documents
      for (const doc of docFiles) {
        const path = await uploadDoc(doc.file, result.client_code, doc.type);
        if (path) {
          // Get client id for document record
          const { data: clientRow } = await supabase
            .from('nw_clients')
            .select('id')
            .eq('client_code', result.client_code)
            .maybeSingle();
          if (clientRow) {
            const folderMap: Record<string, string> = { 'PAN Card': 'PAN', 'CML': 'CML', 'Bank Document': 'BANK' };
            await supabase.from('nw_documents').insert([{
              client_id: clientRow.id,
              employee_id: '1b543112-3251-4912-847b-92982f2de563',
              document_type: folderMap[doc.type] || 'OTHER_DOCUMENTS',
              file_name: doc.file.name,
              file_path: path,
              file_size: doc.file.size,
              mime_type: doc.file.type,
              uploaded_by_name: form.full_name.trim(),
            }]);
          }
        }
      }

      setSaving(false);
      setSuccessData({ client_name: result.client_name, client_code: result.client_code });
    } catch (e: any) {
      setSaving(false);
      setError(e.message || 'An unexpected error occurred.');
    }
  };

  // ── Success Modal ──────────────────────────────────────────────
  if (successData) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.92)' }}>
        <div className="w-full max-w-lg rounded-3xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
          {/* Gold top bar */}
          <div className="h-1.5 w-full" style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent-strong), var(--accent))' }} />
          <div className="p-8 space-y-6 text-center">
            <div className="w-20 h-20 rounded-full mx-auto flex items-center justify-center"
              style={{ background: 'rgba(16,185,129,0.1)', border: '2px solid rgba(16,185,129,0.3)' }}>
              <CheckCircle2 className="w-10 h-10" style={{ color: 'var(--success)' }} />
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: 'var(--accent)' }}>Onboarding Complete</p>
              <h2 className="text-2xl font-bold text-white">Welcome to Niyom Wealth!</h2>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                Dear <span className="text-white font-semibold">{successData.client_name}</span>, your onboarding request has been successfully submitted.
              </p>
            </div>

            <div className="p-4 rounded-2xl space-y-1" style={{ background: 'rgba(var(--accent-rgb),0.05)', border: '1px solid rgba(var(--accent-rgb),0.15)' }}>
              <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: 'var(--accent)' }}>Your Reference Code</p>
              <p className="text-2xl font-black font-mono" style={{ color: 'var(--accent)' }}>{successData.client_code}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Please save this code for your records.</p>
            </div>

            <div className="p-4 rounded-2xl text-left space-y-3" style={{ background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.12)' }}>
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--success)' }}>What Happens Next?</p>
              {[
                'Our team will review your submitted documents and details.',
                'A dedicated Relationship Manager will be assigned to you within 24 hours.',
                'You will receive a confirmation on your registered email and mobile once your account is activated.',
                'Portal login access will be granted upon admin approval of your account.',
              ].map((line, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold mt-0.5"
                    style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--success)' }}>{i + 1}</div>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{line}</p>
                </div>
              ))}
            </div>

            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              For any queries, reach us at <span className="text-white">support@niyomwealth.com</span>
            </p>

            <button onClick={onBack}
              className="w-full py-3.5 rounded-xl font-bold text-sm text-black"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
              Return to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main Onboarding Page ──────────────────────────────────────
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* Top nav */}
      <div className="sticky top-0 z-10 px-6 py-4 flex items-center gap-4" style={{ background: 'rgba(5,5,5,0.95)', borderBottom: '1px solid var(--border-subtle)', backdropFilter: 'blur(8px)' }}>
        <button onClick={onBack} className="flex items-center gap-2 text-sm transition-colors" style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
          <ArrowLeft className="w-4 h-4" /> Back to Login
        </button>
        <div className="flex-1" />
        <img src="/niyomlogo.png" alt="Niyom Wealth" className="h-8 w-auto object-contain" />
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Client Onboarding</p>
          <h1 className="text-2xl font-bold text-white">Begin Your Wealth Journey</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Complete all steps to register with Niyom Wealth Distribution.</p>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    background: i === step ? 'rgba(var(--accent-rgb),0.2)' : i < step ? 'rgba(16,185,129,0.15)' : 'var(--bg-raised)',
                    border: `1px solid ${i === step ? 'var(--accent)' : i < step ? 'var(--success)' : 'var(--border)'}`,
                    color: i === step ? 'var(--accent)' : i < step ? 'var(--success)' : 'var(--border-stronger)',
                  }}>
                  {i < step ? '✓' : i + 1}
                </div>
                <span className="text-xs font-medium hidden sm:inline" style={{ color: i === step ? 'var(--accent)' : i < step ? 'var(--success)' : 'var(--border-stronger)' }}>{s}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 h-px min-w-3" style={{ background: i < step ? 'var(--success)' : 'var(--border-subtle)' }} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="p-4 rounded-2xl flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Step card */}
        <div className="rounded-2xl p-6 space-y-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>

          {/* Personal Info */}
          {stepName === 'Personal Info' && (
            <>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <User className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Personal Information
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Full Name" required>
                  <Input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="As per PAN card" />
                </Field>
                <Field label="PAN Number" required>
                  <Input value={form.pan} onChange={e => set('pan', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} placeholder="ABCDE1234F" maxLength={10} />
                </Field>
                <Field label="Date of Birth" required>
                  <Input type="date" value={form.dob} onChange={e => set('dob', e.target.value)} />
                </Field>
                <Field label="Mobile Number" required>
                  <Input type="tel" value={form.phone} onChange={e => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="9876543210" maxLength={10} />
                </Field>
                <Field label="Email Address" required hint="Used for all official communications.">
                  <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="you@example.com" />
                </Field>
              </div>
            </>
          )}

          {/* Address */}
          {stepName === 'Address' && (
            <>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <MapPin className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Residential Address
              </h3>
              <Field label="Full Address" required>
                <Textarea value={form.address} onChange={e => set('address', e.target.value)} placeholder="House/Flat No., Street, Area..." />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="City" required>
                  <Input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Chennai" />
                </Field>
                <Field label="State" required>
                  <Input value={form.state} onChange={e => set('state', e.target.value)} placeholder="Tamil Nadu" />
                </Field>
                <Field label="Pincode" required>
                  <Input value={form.pincode} onChange={e => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="600001" maxLength={6} />
                </Field>
              </div>
            </>
          )}

          {/* Demat & Bank */}
          {stepName === 'Demat & Bank' && (
            <>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Building2 className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Demat & Bank Details
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Demat Account No." required>
                  <Input value={form.demat_account} onChange={e => set('demat_account', e.target.value)} placeholder="16-digit account number" />
                </Field>
                <Field label="DP Name" required hint="e.g. HDFC Securities, Zerodha">
                  <Input value={form.dp_name} onChange={e => set('dp_name', e.target.value)} placeholder="HDFC Securities" />
                </Field>
                <Field label="Bank Account No." required>
                  <Input value={form.bank_account} onChange={e => set('bank_account', e.target.value)} placeholder="123456789012" />
                </Field>
                <Field label="IFSC Code" required>
                  <Input value={form.bank_ifsc} onChange={e => set('bank_ifsc', e.target.value.toUpperCase())} placeholder="HDFC0001234" />
                </Field>
                <Field label="Bank Name" required>
                  <Input value={form.bank_name} onChange={e => set('bank_name', e.target.value)} placeholder="HDFC Bank" />
                </Field>
              </div>
              <Field label="Additional Notes">
                <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any additional information you'd like to share..." />
              </Field>
            </>
          )}

          {/* Documents */}
          {stepName === 'Documents' && (
            <>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Upload className="w-4 h-4" style={{ color: 'var(--accent)' }} /> KYC Document Upload
              </h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                All three documents are <span style={{ color: 'var(--accent)' }}>mandatory</span> for KYC compliance. Accepted formats: PDF, JPG, PNG.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {CLIENT_DOC_TYPES.map(({ type, label }) => {
                  const uploaded = docFiles.find(d => d.type === type);
                  return (
                    <label key={type} className="flex flex-col items-center gap-3 p-5 rounded-2xl cursor-pointer transition-all text-center"
                      style={{
                        background: uploaded ? 'rgba(16,185,129,0.05)' : 'var(--bg-base)',
                        border: `1px solid ${uploaded ? 'rgba(16,185,129,0.3)' : 'rgba(var(--accent-rgb),0.2)'}`,
                      }}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                        style={{ background: uploaded ? 'rgba(16,185,129,0.1)' : 'rgba(var(--accent-rgb),0.08)' }}>
                        {uploaded
                          ? <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--success)' }} />
                          : <FileText className="w-5 h-5" style={{ color: 'var(--accent)' }} />}
                      </div>
                      <div>
                        <p className="text-xs font-semibold" style={{ color: uploaded ? 'var(--success)' : 'var(--text-faint)' }}>{label}</p>
                        <p className="text-xs mt-0.5 truncate max-w-full" style={{ color: 'var(--text-secondary)' }}>
                          {uploaded ? uploaded.file.name : 'Tap to upload'}
                        </p>
                      </div>
                      {!uploaded && (
                        <span className="text-xs px-2 py-0.5 rounded-md font-semibold" style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>Required</span>
                      )}
                      <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                        onChange={e => handleDocFile(type, e.target.files?.[0] || null)} />
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {/* Review */}
          {stepName === 'Review' && (
            <>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Review Your Details
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Please verify all details before submitting. You may go back to make corrections.</p>

              {[
                { title: 'Personal', icon: User, rows: [['Name', form.full_name], ['PAN', form.pan], ['Date of Birth', form.dob], ['Mobile', form.phone], ['Email', form.email]] },
                { title: 'Address', icon: MapPin, rows: [['Address', form.address], ['City', form.city], ['State', form.state], ['Pincode', form.pincode]] },
                { title: 'Demat & Bank', icon: Landmark, rows: [['Demat A/C', form.demat_account], ['DP Name', form.dp_name], ['Bank A/C', form.bank_account], ['IFSC', form.bank_ifsc], ['Bank', form.bank_name]] },
              ].map(section => (
                <div key={section.title}>
                  <div className="flex items-center gap-2 mb-2">
                    <section.icon className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                    <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>{section.title}</p>
                  </div>
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                    {section.rows.filter(r => r[1]).map(([k, v]) => (
                      <div key={k} className="flex gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <p className="text-xs w-28 flex-shrink-0 font-medium" style={{ color: 'var(--text-secondary)' }}>{k}</p>
                        <p className="text-xs text-white">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <div>
                <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>Uploaded Documents</p>
                <div className="flex flex-wrap gap-2">
                  {CLIENT_DOC_TYPES.map(({ type, label }) => {
                    const uploaded = docFiles.find(d => d.type === type);
                    return (
                      <span key={type} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg"
                        style={uploaded
                          ? { background: 'rgba(16,185,129,0.1)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.2)' }
                          : { background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}>
                        {uploaded ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                        {label}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 rounded-xl text-xs leading-relaxed" style={{ background: 'rgba(var(--accent-rgb),0.04)', border: '1px solid rgba(var(--accent-rgb),0.12)', color: 'var(--text-muted)' }}>
                By submitting this form, you confirm that all information provided is accurate and you consent to Niyom Wealth Distribution LLP processing your details for account creation and KYC verification purposes.
              </div>
            </>
          )}
        </div>

        {/* Navigation */}
        <div className="flex justify-between">
          <button onClick={() => { setError(''); setStep(s => Math.max(0, s - 1)); }} disabled={step === 0}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-30 transition-colors flex items-center gap-2"
            style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          {step < STEPS.length - 1 ? (
            <button onClick={handleNext}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-black"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
              Continue <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={saving || missingDocs.length > 0}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-black disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
              {saving ? 'Submitting...' : <><CheckCircle2 className="w-4 h-4" /> Submit Onboarding</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
