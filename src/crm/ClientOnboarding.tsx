import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { passwordError, isPasswordStrong } from '../lib/passwordPolicy';
import { NWEmployee, NWDSA, CRMPage } from './types';
import { User, Building2, Upload, FileText, CheckCircle2, AlertCircle, ChevronRight, Users, Handshake, UserCheck, UserPlus, Sparkles } from 'lucide-react';

interface Props {
  employee: NWEmployee;
  onNavigate: (page: CRMPage) => void;
  // Optional: when navigated here from a lead's "Convert to Client" action, this
  // carries { leadId } so the form is pre-filled and the lead is marked converted
  // on success. Absent for the normal onboarding flow — behaviour is unchanged.
  pageParams?: Record<string, string>;
}

// Steps differ based on sourced_via: Direct = 5 steps, DSA = 6 steps (extra DSA step before Basic Info)
// Products comes BEFORE Demat & Bank because the chosen products decide whether
// demat details are mandatory (Bonds / Unlisted Shares need a demat + CML).
const DIRECT_STEPS = ['Source', 'Basic Info', 'Products', 'Demat & Bank', 'Documents', 'Review'];
const DSA_STEPS    = ['Source', 'DSA Details', 'Basic Info', 'Products', 'Demat & Bank', 'Documents', 'Review'];

// Investment products the client wants access to. Values MUST match the portal
// self-service wizard (src/portal/features/onboarding/onboardingSteps.ts) and the
// public-onboard-submit edge function's VALID_PREFS set.
const PRODUCTS = [
  { value: 'mutual_funds', label: 'Mutual Funds' },
  { value: 'bonds', label: 'Bonds' },
  { value: 'fixed_deposits', label: 'Fixed Deposits' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'unlisted_shares', label: 'Unlisted Shares' },
] as const;
// Products that mandate a CML (Demat proof). Mirrors the self-service wizard.
const CML_PRODUCTS = new Set<string>(['bonds', 'unlisted_shares']);

const CLIENT_DOC_TYPES = [
  { type: 'PAN Card',      label: 'PAN Card' },
  { type: 'CML',           label: 'CML (Client Master List)' },
  { type: 'Bank Document', label: 'Cancelled Cheque / Bank Statement' },
];
const DSA_DOC_TYPES = [
  { type: 'dsa_pan',       label: 'DSA PAN Card', field: 'pan_doc_url' as const },
  { type: 'dsa_bank',      label: 'Bank Cheque / Statement', field: 'bank_doc_url' as const },
];

function Field({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label}{required && <span className="ml-0.5" style={{ color: 'var(--accent)' }}>*</span>}
      </label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{hint}</p>}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { onFocus, onBlur, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...rest}
      className="w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none transition-all"
      style={{ background: 'var(--bg-base)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}` }}
      onFocus={e => { setFocused(true); onFocus?.(e); }}
      onBlur={e => { setFocused(false); onBlur?.(e); }}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { onFocus, onBlur, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      {...rest}
      rows={3}
      className="w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none transition-all resize-none"
      style={{ background: 'var(--bg-base)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}` }}
      onFocus={e => { setFocused(true); onFocus?.(e); }}
      onBlur={e => { setFocused(false); onBlur?.(e); }}
    />
  );
}

function DupWarn({ msg, block }: { msg: string | null; block?: boolean }) {
  if (!msg) return null;
  // `block` renders a hard (danger) style used where the duplicate stops the flow
  // — e.g. a PAN that already belongs to an existing client.
  const color = block ? 'var(--danger)' : 'rgb(var(--warning-soft-rgb))';
  const bg = block ? 'rgba(var(--danger-rgb),0.08)' : 'rgba(251,191,36,0.07)';
  const border = block ? 'rgba(var(--danger-rgb),0.3)' : 'rgba(251,191,36,0.25)';
  return (
    <div className="mt-1.5 flex items-start gap-2 px-3 py-2 rounded-lg" style={{ background: bg, border: `1px solid ${border}` }}>
      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color }} />
      <p className="text-xs" style={{ color }}>
        {msg}{block ? ' — enter a different PAN to continue.' : ''}
      </p>
    </div>
  );
}

interface DSAForm {
  full_name: string; email: string; mobile: string; pan: string; address: string;
  bank_name: string; bank_account: string; bank_ifsc: string;
}
interface DSADocs { photo: File | null; pan: File | null; bank: File | null; }

export default function ClientOnboarding({ employee, onNavigate, pageParams }: Props) {
  const fromLeadId = pageParams?.leadId || null;
  const [step, setStep] = useState(0);
  const [sourcedVia, setSourcedVia] = useState<'direct' | 'dsa' | ''>('');
  const [leadBanner, setLeadBanner] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    full_name: '', pan: '', dob: '', phone: '', email: '',
    address: '', city: '', state: '', pincode: '',
    demat_account: '', dp_name: '',
    bank_account: '', bank_ifsc: '', bank_name: '',
    notes: '',
  });

  // Products the client wants access to (mirrors the self-service portal wizard).
  const [prefs, setPrefs] = useState<string[]>([]);
  const togglePref = (value: string) =>
    setPrefs(p => (p.includes(value) ? p.filter(x => x !== value) : [...p, value]));
  // Demat is mandatory only when a CML product (Bonds / Unlisted Shares) is chosen.
  const dematRequired = prefs.some(p => CML_PRODUCTS.has(p));
  // The CML document is only required for CML products; drop it otherwise so
  // Mutual Funds / FD / Insurance clients aren't asked for a Demat proof.
  const requiredDocTypes = CLIENT_DOC_TYPES.filter(d => d.type !== 'CML' || dematRequired);

  const [dsaMode, setDsaMode] = useState<'new' | 'existing' | ''>('');
  const [existingDSAs, setExistingDSAs] = useState<NWDSA[]>([]);
  const [selectedExistingDSA, setSelectedExistingDSA] = useState<NWDSA | null>(null);
  const [dsaForm, setDsaForm] = useState<DSAForm>({
    full_name: '', email: '', mobile: '', pan: '', address: '',
    bank_name: '', bank_account: '', bank_ifsc: '',
  });
  const [dsaDocs, setDsaDocs] = useState<DSADocs>({ photo: null, pan: null, bank: null });
  const [docFiles, setDocFiles] = useState<{ type: string; file: File }[]>([]);
  const [clientLoginEnabled, setClientLoginEnabled] = useState<boolean | null>(null);
  const [clientInitialPassword, setClientInitialPassword] = useState('');

  const isDSA = sourcedVia === 'dsa';
  const STEPS = isDSA ? DSA_STEPS : DIRECT_STEPS;

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const setDsa = (k: keyof DSAForm, v: string) => setDsaForm(f => ({ ...f, [k]: v }));

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';

  // Duplicate detection state
  const [dupWarnings, setDupWarnings] = useState<Record<'pan' | 'phone' | 'email', string | null>>({ pan: null, phone: null, email: null });
  const dupTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // PAN verify (Cashfree via droplet relay) → auto-fill name as per PAN.
  const [panVerifying, setPanVerifying] = useState(false);
  const [panVerifiedName, setPanVerifiedName] = useState<string | null>(null);
  const [panVerifyErr, setPanVerifyErr] = useState('');

  const handleVerifyPan = async () => {
    setPanVerifyErr('');
    const pan = form.pan.toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) { setPanVerifyErr('Enter a valid PAN first.'); return; }
    setPanVerifying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/crm-pan-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ pan }),
      });
      const data = await res.json().catch(() => ({}));
      // Already in our records → no Cashfree call was made; block, no names shown.
      if (data.already_registered) {
        setPanVerifiedName(null);
        setDupWarnings(w => ({ ...w, pan: 'PAN already registered' }));
        setPanVerifyErr('PAN already registered.');
        setPanVerifying(false);
        return;
      }
      if (!res.ok || !data.valid) { setPanVerifyErr(data.error || 'PAN could not be verified.'); setPanVerifying(false); return; }
      if (data.name_as_per_pan) set('full_name', data.name_as_per_pan);
      setPanVerifiedName(data.name_as_per_pan || '');
    } catch (e: any) {
      setPanVerifyErr(e?.message || 'Verification failed.');
    }
    setPanVerifying(false);
  };

  const checkDuplicate = useCallback(async (field: 'pan' | 'phone' | 'email', value: string): Promise<string | null> => {
    if (!value || value.length < 3) {
      setDupWarnings(w => ({ ...w, [field]: null }));
      return null;
    }
    const col = field === 'phone' ? 'phone' : field;
    const { data } = await supabase
      .from('nw_clients')
      .select('full_name, pan, phone, email, employee:nw_employees(full_name)')
      .eq(col, value)
      .limit(1);
    if (data && data.length > 0) {
      const match = data[0] as any;
      const empName = match.employee?.full_name || 'Admin';
      // PAN dup is shown name-free ("PAN already registered"); phone/email keep the
      // detailed "who owns it" hint for the RM.
      const msg = field === 'pan'
        ? 'PAN already registered'
        : `Client "${match.full_name}" already exists under ${empName}`;
      setDupWarnings(w => ({ ...w, [field]: msg }));
      return msg;
    }
    setDupWarnings(w => ({ ...w, [field]: null }));
    return null;
  }, []);

  const onFieldChange = (field: 'pan' | 'phone' | 'email', value: string) => {
    set(field === 'phone' ? 'phone' : field, value);
    clearTimeout(dupTimers.current[field]);
    dupTimers.current[field] = setTimeout(() => checkDuplicate(field, value), 600);
  };

  useEffect(() => {
    if (sourcedVia !== 'dsa') return;
    let query = supabase.from('nw_dsa').select('*').eq('status', 'active').order('dsa_code');
    if (!isAdmin) query = (query as any).eq('employee_id', employee.id);
    query.then(({ data }) => setExistingDSAs((data as NWDSA[]) || []));
  }, [sourcedVia, isAdmin, employee.id]);

  // Convert-from-lead: pre-fill what the lead already knows, default to Direct,
  // and jump past the Source step. The RM completes KYC/demat/bank as usual.
  useEffect(() => {
    if (!fromLeadId) return;
    supabase.from('nw_leads').select('*').eq('id', fromLeadId).single().then(({ data }) => {
      if (!data) return;
      setSourcedVia('direct');
      setForm(f => ({
        ...f,
        full_name: (data as any).lead_name || '',
        phone: (data as any).mobile || '',
        email: (data as any).email || '',
        pan: (data as any).pan || '',
        address: (data as any).address || '',
        city: (data as any).city || '',
        state: (data as any).state || '',
        notes: (data as any).remarks || '',
      }));
      setLeadBanner((data as any).lead_code || '');
      setStep(1); // skip Source; go straight to Basic Info
    });
  }, [fromLeadId]);

  const handleDocFile = (type: string, file: File | null) => {
    if (!file) return;
    setDocFiles(prev => [...prev.filter(d => d.type !== type), { type, file }]);
  };

  const missingDocs = requiredDocTypes.filter(d => !docFiles.find(f => f.type === d.type));
  const missingDsaDocs = DSA_DOC_TYPES.filter(d => {
    if (d.type === 'dsa_pan') return !dsaDocs.pan;
    return !dsaDocs.bank;
  });

  const validateSource = () => {
    if (!sourcedVia) { setError('Please select Direct or DSA.'); return false; }
    setError(''); return true;
  };

  const validateDsaForm = () => {
    if (!dsaMode) { setError('Please select New DSA or Existing DSA.'); return false; }
    if (dsaMode === 'existing') {
      if (!selectedExistingDSA) { setError('Please select an existing DSA.'); return false; }
      setError(''); return true;
    }
    // New DSA validations
    if (!dsaForm.full_name.trim()) { setError('DSA full name is required.'); return false; }
    if (!dsaForm.mobile.trim() || !/^[6-9]\d{9}$/.test(dsaForm.mobile)) { setError('Valid 10-digit DSA mobile number is required.'); return false; }
    if (!dsaForm.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dsaForm.email)) { setError('Valid DSA email is required.'); return false; }
    if (!dsaForm.pan.trim() || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(dsaForm.pan)) { setError('Valid DSA PAN (e.g. ABCDE1234F) is required.'); return false; }
    if (!dsaForm.address.trim()) { setError('DSA address is required.'); return false; }
    if (!dsaForm.bank_name.trim()) { setError('DSA bank name is required.'); return false; }
    if (!dsaForm.bank_account.trim()) { setError('DSA bank account number is required.'); return false; }
    if (!dsaForm.bank_ifsc.trim()) { setError('DSA IFSC code is required.'); return false; }
    if (missingDsaDocs.length > 0) { setError(`Upload all DSA documents: ${missingDsaDocs.map(d => d.label).join(', ')}`); return false; }
    setError(''); return true;
  };

  const validateStep0Client = () => {
    if (!form.full_name.trim())  { setError('Full name is required.'); return false; }
    if (!form.pan.trim())        { setError('PAN number is required.'); return false; }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan)) { setError('PAN format is invalid (e.g. ABCDE1234F).'); return false; }
    if (!form.dob)               { setError('Date of birth is required.'); return false; }
    if (!form.phone.trim())      { setError('Mobile number is required.'); return false; }
    if (!/^[6-9]\d{9}$/.test(form.phone)) { setError('Enter a valid 10-digit Indian mobile number.'); return false; }
    if (!form.email.trim())      { setError('Email address is required.'); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setError('Enter a valid email address.'); return false; }
    if (!form.address.trim())    { setError('Address is required.'); return false; }
    if (!form.city.trim())       { setError('City is required.'); return false; }
    if (!form.state.trim())      { setError('State is required.'); return false; }
    if (!form.pincode.trim() || form.pincode.length !== 6) { setError('Valid 6-digit pincode is required.'); return false; }
    setError(''); return true;
  };

  const validateDematBank = () => {
    // Demat is required only for CML products (Bonds / Unlisted Shares).
    if (dematRequired && !form.demat_account.trim()) { setError('Demat account number is required for Bonds / Unlisted Shares.'); return false; }
    if (dematRequired && !form.dp_name.trim())       { setError('DP Name is required for Bonds / Unlisted Shares.'); return false; }
    if (!form.bank_account.trim())  { setError('Bank account number is required.'); return false; }
    if (!form.bank_ifsc.trim())     { setError('IFSC code is required.'); return false; }
    if (!form.bank_name.trim())     { setError('Bank name is required.'); return false; }
    setError(''); return true;
  };

  const validateProducts = () => {
    if (prefs.length === 0) { setError('Select at least one product the client wants access to.'); return false; }
    setError(''); return true;
  };

  // Map step index to logical step name
  const stepName = STEPS[step];

  const handleNext = async () => {
    if (stepName === 'Source' && !validateSource()) return;
    if (stepName === 'DSA Details' && !validateDsaForm()) return;
    if (stepName === 'Basic Info') {
      if (!validateStep0Client()) return;
      // PAN verification is mandatory: the RM must click "Verify PAN & fetch name"
      // (a successful Cashfree verify) before advancing — even if every other field
      // is filled. panVerifiedName resets to null whenever the PAN is edited.
      if (!panVerifiedName) {
        setError("Please verify the client's PAN — click 'Verify PAN & fetch name' — before continuing.");
        return;
      }
      // A client with this PAN cannot be onboarded twice. Re-check on the way out
      // (covers the debounced check not having fired yet, or a pasted PAN) and
      // block progression until the RM enters a PAN not already in our records.
      const panDup = await checkDuplicate('pan', form.pan.toUpperCase());
      if (panDup) {
        setError('A client with this PAN already exists. Change the PAN to one not already in our records to continue.');
        return;
      }
    }
    if (stepName === 'Demat & Bank' && !validateDematBank()) return;
    if (stepName === 'Products' && !validateProducts()) return;
    setError('');
    setStep(s => s + 1);
  };

  const uploadFile = async (file: File, path: string): Promise<string | null> => {
    const { data, error: upErr } = await supabase.storage.from('crm-documents').upload(path, file, { upsert: true });
    if (upErr || !data) return null;
    return data.path;
  };

  // Empty string (not null) when there's no demat — the column is NOT NULL DEFAULT ''.
  const depository = !form.demat_account.trim()
    ? ''
    : form.demat_account.toUpperCase().startsWith("IN")
      ? "NSDL"
      : "CDSL";

  const handleSubmit = async () => {
    if (missingDocs.length > 0) {
      setError(`Please upload all required documents: ${missingDocs.map(d => d.label).join(', ')}`);
      return;
    }
    setError('');
    setSaving(true);

    try {
      let dsaId: string | null = null;

      // If DSA sourced, either use existing DSA or create a new one
      if (isDSA) {
        if (dsaMode === 'existing' && selectedExistingDSA) {
          dsaId = selectedExistingDSA.id;
        } else {
        const { data: dsaCode, error: codeErr } = await supabase.rpc('nw2_generate_dsa_code', { p_employee_id: employee.id });
        if (codeErr) throw codeErr;

        // Upload DSA documents to crm-documents bucket
        const dsaSlot = `dsa/${dsaCode}`;
        const photoUrl = dsaDocs.photo ? await uploadFile(dsaDocs.photo, `${dsaSlot}/photo_${Date.now()}${dsaDocs.photo.name.substring(dsaDocs.photo.name.lastIndexOf('.'))}`) : null;
        const panUrl   = dsaDocs.pan   ? await uploadFile(dsaDocs.pan,   `${dsaSlot}/pan_${Date.now()}${dsaDocs.pan.name.substring(dsaDocs.pan.name.lastIndexOf('.'))}`) : null;
        const bankUrl  = dsaDocs.bank  ? await uploadFile(dsaDocs.bank,  `${dsaSlot}/bank_${Date.now()}${dsaDocs.bank.name.substring(dsaDocs.bank.name.lastIndexOf('.'))}`) : null;

        const { data: dsaRecord, error: dsaErr } = await supabase.from('nw_dsa').insert([{
          dsa_code: dsaCode,
          employee_id: employee.id,
          full_name: dsaForm.full_name.trim(),
          email: dsaForm.email.trim().toLowerCase(),
          mobile: dsaForm.mobile,
          pan: dsaForm.pan.toUpperCase(),
          address: dsaForm.address.trim(),
          bank_name: dsaForm.bank_name.trim(),
          bank_account: dsaForm.bank_account.trim(),
          bank_ifsc: dsaForm.bank_ifsc.toUpperCase(),
          photo_url: photoUrl,
          pan_doc_url: panUrl,
          bank_doc_url: bankUrl,
        }]).select().single();

        if (dsaErr) throw dsaErr;
        dsaId = dsaRecord.id;
        } // end else (new DSA)
      }

      const { data: clientCode, error: codeErr } = await supabase.rpc('nw2_generate_client_code', { p_employee_id: employee.id });
      if (codeErr) throw codeErr;

      const { data: client, error: clientErr } = await supabase.from('nw_clients').insert([{
        client_code: clientCode,
        employee_id: employee.id,
        full_name: form.full_name.trim(),
        pan: form.pan.toUpperCase(),
        dob: form.dob,
        phone: form.phone,
        email: form.email.trim().toLowerCase(),
        address: form.address,
        city: form.city,
        state: form.state,
        pincode: form.pincode,
        demat_account: form.demat_account,
        dp_name: form.dp_name,
        depository: depository,
        bank_account: form.bank_account,
        bank_ifsc: form.bank_ifsc.toUpperCase(),
        bank_name: form.bank_name,
        notes: form.notes,
        // Products the client wants access to (chosen in the Products step).
        investment_preferences: prefs,
        cml_required: prefs.some(p => CML_PRODUCTS.has(p)),
        verification_status: 'pending',
        sourced_via: sourcedVia || 'direct',
        dsa_id: dsaId,
        // Onboarding funnel: the RM has collected full KYC here, so the client's
        // portal shows "KYC Under Review" (not the self-service checklist) until
        // an RM verifies. Mirror the docs actually uploaded so the CRM's
        // Onboarding/KYC panel reads accurately. phone_verified / pan_verified stay
        // false (no mobile OTP / Cashfree API verify happens in the CRM path).
        onboarding_status: 'kyc_under_review',
        pan_doc_uploaded: docFiles.some(d => d.type === 'PAN Card'),
        bank_verified: docFiles.some(d => d.type === 'Bank Document'),
        cml_uploaded: docFiles.some(d => d.type === 'CML'),
      }]).select().single();

      if (clientErr) throw clientErr;

      // Sprint 5: seed the client's PRIMARY bank account. nw_clients.bank_* was
      // already written above (the mirror); this creates the matching primary row.
      if (form.bank_account.trim() || form.bank_ifsc.trim() || form.bank_name.trim()) {
        await supabase.from('nw_client_bank_accounts').insert([{
          client_id: client.id,
          account_number: form.bank_account.trim(),
          ifsc: form.bank_ifsc.trim().toUpperCase(),
          bank_name: form.bank_name.trim(),
          is_primary: true,
        }]);
      }

      // Document type → folder key mapping. Onboarding only ever collects the
      // three KYC docs below (CLIENT_DOC_TYPES), all mapped here; the fallback is
      // defensive/unreachable (the 'Other Documents' folder was removed in 6A).
      const DOC_FOLDER_MAP: Record<string, string> = {
        'PAN Card': 'PAN', 'CML': 'CML', 'Bank Document': 'BANK',
      };
      for (const doc of docFiles) {
        const folderKey = DOC_FOLDER_MAP[doc.type] || 'PAN';
        const ext = doc.file.name.substring(doc.file.name.lastIndexOf('.'));
        const now = new Date();
        const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}${now.getHours()<12?'AM':'PM'}`;
        const fname = `${doc.type.replace(/ /g,'_')}_${ts}${ext}`;
        const path = `clients/${clientCode}/${folderKey}/${fname}`;
        const storedPath = await uploadFile(doc.file, path);
        if (!storedPath) continue;
        await supabase.from('nw_documents').insert([{
          client_id: client.id,
          employee_id: employee.id,
          document_type: folderKey,
          file_name: fname,
          file_path: storedPath,
          file_size: doc.file.size,
          mime_type: doc.file.type,
          uploaded_by_name: employee.full_name,
        }]);
      }

      // Create client login if enabled
      if (clientLoginEnabled && clientInitialPassword.trim()) {
        const { data: { session } } = await supabase.auth.getSession();
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const resp = await fetch(`${supabaseUrl}/functions/v1/create-client-login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            client_id: client.id,
            email: form.email.trim().toLowerCase(),
            pan: form.pan.toUpperCase(),
            initial_password: clientInitialPassword.trim(),
          }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          console.warn('Client login creation failed:', errData.error);
          // Non-fatal — client is still onboarded, login can be set up later
        }
      }

      await supabase.from('nw_activity_logs').insert([{
        employee_id: employee.id, client_id: client.id,
        action: 'Client Onboarded',
        description: `${form.full_name} onboarded with code ${clientCode}${isDSA ? ' (via DSA)' : ''}${clientLoginEnabled ? ' · Client login enabled' : ''}`,
      }]);

      // If this onboarding came from a lead conversion, mark that lead converted
      // (archived + locked) and link it to the new client. Non-fatal on failure.
      if (fromLeadId) {
        await supabase.rpc('nw_mark_lead_converted', { p_lead_id: fromLeadId, p_client_id: client.id })
          .then(() => {}, () => {});
      }

      setSuccess(`Client ${form.full_name} onboarded successfully with code ${clientCode}!`);
      setSaving(false);
      setTimeout(() => onNavigate('clients'), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to save client');
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>New Client</p>
        <h1 className="text-2xl font-bold text-text-primary">Client Onboarding</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>Complete the form to onboard a new client</p>
      </div>

      {leadBanner && (
        <div className="p-3 rounded-xl flex items-center gap-2.5" style={{ background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
          <UserCheck className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Converting lead <span className="font-mono font-bold" style={{ color: 'var(--accent)' }}>{leadBanner}</span> — details pre-filled. The lead will be marked <strong>Converted</strong> and locked once onboarding completes.
          </p>
        </div>
      )}

      {/* Stepper */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <button onClick={() => i < step && setStep(i)}
              className="flex items-center gap-2 text-sm font-medium transition-all flex-shrink-0"
              style={{ color: i === step ? 'var(--accent)' : i < step ? 'var(--success)' : 'var(--text-faint)' }}>
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ background: i === step ? 'rgba(var(--accent-rgb),0.15)' : i < step ? 'rgba(16,185,129,0.15)' : 'var(--bg-raised)', border: `1px solid ${i === step ? 'var(--accent)' : i < step ? 'var(--success)' : 'var(--border)'}` }}>
                {i < step ? '✓' : i + 1}
              </span>
              <span className="hidden sm:inline">{s}</span>
            </button>
            {i < STEPS.length - 1 && <div className="flex-1 h-px min-w-4" style={{ background: i < step ? 'var(--success)' : 'var(--border)' }} />}
          </React.Fragment>
        ))}
      </div>

      {error && (
        <div className="p-4 rounded-2xl flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle className="w-4 h-4 text-c-red flex-shrink-0" />
          <p className="text-sm text-c-red">{error}</p>
        </div>
      )}
      {success && (
        <div className="p-4 rounded-2xl flex items-center gap-3" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
          <CheckCircle2 className="w-4 h-4 text-c-emerald flex-shrink-0" />
          <p className="text-sm text-c-emerald">{success}</p>
        </div>
      )}

      <div className="rounded-2xl p-6" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>

        {/* Step: Source Selection */}
        {stepName === 'Source' && (
          <div className="space-y-5">
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <Users className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Client Source
            </h3>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>How is this client being onboarded?</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {
                  value: 'direct' as const,
                  icon: User,
                  title: 'Direct',
                  desc: 'Client sourced directly by the employee. Standard onboarding process.',
                  color: 'var(--success)',
                },
                {
                  value: 'dsa' as const,
                  icon: Handshake,
                  title: 'DSA',
                  desc: 'Client sourced through a Direct Selling Agent. DSA details required.',
                  color: 'var(--accent)',
                },
              ].map(opt => (
                <button key={opt.value} onClick={() => setSourcedVia(opt.value)}
                  className="text-left p-5 rounded-2xl transition-all space-y-3"
                  style={{
                    background: sourcedVia === opt.value ? `color-mix(in srgb, ${opt.color} 6%, transparent)` : 'var(--bg-base)',
                    border: `2px solid ${sourcedVia === opt.value ? opt.color : 'var(--border)'}`,
                  }}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ background: `color-mix(in srgb, ${opt.color} 8%, transparent)` }}>
                      <opt.icon className="w-5 h-5" style={{ color: opt.color }} />
                    </div>
                    <div>
                      <p className="text-sm font-bold" style={{ color: sourcedVia === opt.value ? opt.color : 'var(--text-primary)' }}>{opt.title}</p>
                      {sourcedVia === opt.value && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: `color-mix(in srgb, ${opt.color} 12%, transparent)`, color: opt.color }}>Selected</span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step: DSA Details (only for DSA sourced) */}
        {stepName === 'DSA Details' && (
          <div className="space-y-5">
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <Handshake className="w-4 h-4" style={{ color: 'var(--accent)' }} /> DSA Details
            </h3>

            {/* New vs Existing DSA toggle */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>DSA Registration</p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: 'new' as const, icon: UserPlus, title: 'New DSA', desc: 'Register a new DSA with full details and documents.' },
                  { value: 'existing' as const, icon: UserCheck, title: 'Existing DSA', desc: 'Link this client to a DSA already registered in the system.' },
                ].map(opt => (
                  <button key={opt.value} onClick={() => { setDsaMode(opt.value); setSelectedExistingDSA(null); setError(''); }}
                    className="text-left p-4 rounded-xl transition-all space-y-2"
                    style={{
                      background: dsaMode === opt.value ? 'rgba(var(--accent-rgb),0.08)' : 'var(--bg-base)',
                      border: `2px solid ${dsaMode === opt.value ? 'var(--accent)' : 'var(--border)'}`,
                    }}>
                    <div className="flex items-center gap-2">
                      <opt.icon className="w-4 h-4" style={{ color: dsaMode === opt.value ? 'var(--accent)' : 'var(--text-muted)' }} />
                      <p className="text-sm font-bold" style={{ color: dsaMode === opt.value ? 'var(--accent)' : 'var(--text-bright)' }}>{opt.title}</p>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Existing DSA selector */}
            {dsaMode === 'existing' && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Select DSA</p>
                {existingDSAs.length === 0 ? (
                  <div className="p-4 rounded-xl text-sm text-center" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-faint)' }}>
                    No active DSAs found. Please register a New DSA.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {existingDSAs.map(dsa => (
                      <button key={dsa.id} onClick={() => setSelectedExistingDSA(dsa)}
                        className="w-full text-left p-3.5 rounded-xl transition-all flex items-center gap-3"
                        style={{
                          background: selectedExistingDSA?.id === dsa.id ? 'rgba(var(--accent-rgb),0.08)' : 'var(--bg-base)',
                          border: `1px solid ${selectedExistingDSA?.id === dsa.id ? 'var(--accent)' : 'var(--border)'}`,
                        }}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                          style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)' }}>
                          {dsa.full_name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-text-primary truncate">{dsa.full_name}</p>
                          <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--accent)' }}>{dsa.dsa_code}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{dsa.mobile}</p>
                          {selectedExistingDSA?.id === dsa.id && (
                            <CheckCircle2 className="w-4 h-4 ml-auto mt-1" style={{ color: 'var(--success)' }} />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* New DSA form — only shown when dsaMode === 'new' */}
            {dsaMode === 'new' && (
            <>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>All fields and documents are mandatory for DSA registration.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="DSA Full Name" required>
                <Input value={dsaForm.full_name} onChange={e => setDsa('full_name', e.target.value)} placeholder="Full name as per PAN" />
              </Field>
              <Field label="DSA Mobile Number" required>
                <Input type="tel" value={dsaForm.mobile} onChange={e => setDsa('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="9876543210" />
              </Field>
              <Field label="DSA Email" required>
                <Input type="email" value={dsaForm.email} onChange={e => setDsa('email', e.target.value)} placeholder="dsa@example.com" />
              </Field>
              <Field label="DSA PAN Number" required>
                <Input value={dsaForm.pan} onChange={e => setDsa('pan', e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
              </Field>
            </div>
            <Field label="DSA Address" required>
              <Textarea value={dsaForm.address} onChange={e => setDsa('address', e.target.value)} placeholder="Full address..." />
            </Field>

            {/* DSA Bank Details */}
            <div className="pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--accent)' }}>Bank Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Bank Name" required>
                  <Input value={dsaForm.bank_name} onChange={e => setDsa('bank_name', e.target.value)} placeholder="HDFC Bank" />
                </Field>
                <Field label="Account Number" required>
                  <Input value={dsaForm.bank_account} onChange={e => setDsa('bank_account', e.target.value)} placeholder="123456789012" />
                </Field>
                <Field label="IFSC Code" required>
                  <Input value={dsaForm.bank_ifsc} onChange={e => setDsa('bank_ifsc', e.target.value.toUpperCase())} placeholder="HDFC0001234" />
                </Field>
              </div>
            </div>

            {/* DSA Documents */}
            <div className="pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--accent)' }}>DSA Documents</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { label: 'PAN Card',  key: 'pan' as const },
                  { label: 'Bank Cheque / Statement', key: 'bank' as const },
                ].map(({ label, key }) => {
                  const file = dsaDocs[key];
                  return (
                    <label key={key} className="flex flex-col items-center gap-2 p-4 rounded-xl cursor-pointer transition-all text-center"
                      style={{ background: file ? 'rgba(16,185,129,0.05)' : 'var(--bg-base)', border: `1px solid ${file ? 'rgba(16,185,129,0.25)' : 'rgba(var(--accent-rgb),0.2)'}` }}>
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                        style={{ background: file ? 'rgba(16,185,129,0.1)' : 'rgba(var(--accent-rgb),0.08)' }}>
                        {file ? <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--success)' }} /> : <Upload className="w-4 h-4" style={{ color: 'var(--accent)' }} />}
                      </div>
                      <p className="text-xs font-semibold" style={{ color: file ? 'var(--success)' : 'var(--text-bright)' }}>{label}</p>
                      <p className="text-xs truncate w-full" style={{ color: 'var(--text-faint)' }}>{file ? file.name : 'Required'}</p>
                      <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                        onChange={e => setDsaDocs(prev => ({ ...prev, [key]: e.target.files?.[0] || null }))} />
                    </label>
                  );
                })}
              </div>
              {missingDsaDocs.length > 0 && (
                <p className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-lg mt-3" style={{ background: 'rgba(239,68,68,0.06)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.15)' }}>
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                  Missing: {missingDsaDocs.map(d => d.label).join(', ')}
                </p>
              )}
            </div>
            </> /* end dsaMode === 'new' */
            )}
          </div>
        )}

        {/* Step: Basic Info */}
        {stepName === 'Basic Info' && (
          <div className="space-y-5">
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <User className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Basic Information
              {isDSA && <span className="text-xs px-2 py-0.5 rounded-lg" style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>DSA Client</span>}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Full Name" required>
                <Input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="John Smith" />
              </Field>
              <Field label="PAN Number" required>
                <Input value={form.pan} onChange={e => { onFieldChange('pan', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)); setPanVerifiedName(null); setPanVerifyErr(''); }} placeholder="ABCDE1234F" maxLength={10} />
                <DupWarn msg={dupWarnings.pan} block />
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={handleVerifyPan}
                    disabled={panVerifying || !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan)}
                    className="text-xs font-semibold px-2.5 py-1 rounded-lg disabled:opacity-40 transition-colors"
                    style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
                    {panVerifying ? 'Verifying…' : 'Verify PAN & fetch name'}
                  </button>
                  {panVerifiedName && (
                    <span className="text-xs font-medium" style={{ color: 'var(--success)' }}>✓ Name as per PAN: {panVerifiedName}</span>
                  )}
                </div>
                {panVerifyErr && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{panVerifyErr}</p>}
              </Field>
              <Field label="Date of Birth" required>
                <Input type="date" value={form.dob} onChange={e => set('dob', e.target.value)} />
              </Field>
              <Field label="Mobile Number" required>
                <Input type="tel" value={form.phone} onChange={e => onFieldChange('phone', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="9876543210" maxLength={10} />
                <DupWarn msg={dupWarnings.phone} />
              </Field>
              <Field label="Email Address" required>
                <Input type="email" value={form.email} onChange={e => onFieldChange('email', e.target.value)} placeholder="client@example.com" />
                <DupWarn msg={dupWarnings.email} />
              </Field>
            </div>
            <Field label="Address" required>
              <Textarea value={form.address} onChange={e => set('address', e.target.value)} placeholder="Full address..." />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="City" required>
                <Input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Mumbai" />
              </Field>
              <Field label="State" required>
                <Input value={form.state} onChange={e => set('state', e.target.value)} placeholder="Maharashtra" />
              </Field>
              <Field label="Pincode" required>
                <Input value={form.pincode} onChange={e => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="400001" maxLength={6} />
              </Field>
            </div>
          </div>
        )}

        {/* Step: Demat & Bank */}
        {stepName === 'Demat & Bank' && (
          <div className="space-y-5">
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <Building2 className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Demat & Bank Details
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {dematRequired
                ? 'Demat details are required — the selected products (Bonds / Unlisted Shares) need a demat account.'
                : 'Demat details are optional for the selected products — add them if the client has a demat account.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Demat Account No." required={dematRequired}>
                <Input value={form.demat_account} onChange={e => set('demat_account', e.target.value)} placeholder="1234567890123456" />
              </Field>
              <Field label="DP Name" required={dematRequired}>
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
            <Field label="Notes">
              <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Additional notes..." />
            </Field>
          </div>
        )}

        {/* Step: Products */}
        {stepName === 'Products' && (
          <div className="space-y-5">
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Products
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Select the products this client wants access to. Choose at least one — Bonds &amp; Unlisted Shares additionally need a Demat proof (CML).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PRODUCTS.map(({ value, label }) => {
                const on = prefs.includes(value);
                const needsCml = CML_PRODUCTS.has(value);
                return (
                  <button key={value} type="button" onClick={() => togglePref(value)}
                    className="flex items-center justify-between p-3.5 rounded-xl text-left transition-all"
                    style={{
                      background: on ? 'rgba(var(--accent-rgb),0.08)' : 'var(--bg-base)',
                      border: `2px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                    }}>
                    <div>
                      <p className="text-sm font-bold" style={{ color: on ? 'var(--accent)' : 'var(--text-primary)' }}>{label}</p>
                      {needsCml && <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>Requires Demat proof (CML)</p>}
                    </div>
                    {on
                      ? <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
                      : <span className="w-5 h-5 rounded-full flex-shrink-0" style={{ border: '1px solid var(--border)' }} />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step: Documents */}
        {stepName === 'Documents' && (
          <div className="space-y-5">
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <Upload className="w-4 h-4" style={{ color: 'var(--accent)' }} /> KYC Documents
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {dematRequired
                ? <>All three documents are <span style={{ color: 'var(--accent)' }}>mandatory</span> for the selected products. Files are securely stored.</>
                : <>Both documents are <span style={{ color: 'var(--accent)' }}>mandatory</span>. CML is needed only for Bonds / Unlisted Shares. Files are securely stored.</>}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {requiredDocTypes.map(({ type, label }) => {
                const existing = docFiles.find(d => d.type === type);
                return (
                  <label key={type} className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all"
                    style={{ background: existing ? 'rgba(16,185,129,0.05)' : 'var(--bg-base)', border: `1px solid ${existing ? 'rgba(16,185,129,0.25)' : 'rgba(var(--accent-rgb),0.2)'}` }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: existing ? 'rgba(16,185,129,0.1)' : 'rgba(var(--accent-rgb),0.08)' }}>
                      <FileText className="w-4 h-4" style={{ color: existing ? 'var(--success)' : 'var(--accent)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-semibold" style={{ color: existing ? 'var(--success)' : 'var(--text-bright)' }}>{label}</p>
                        {existing
                          ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--success)' }} />
                          : <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>Required</span>
                        }
                      </div>
                      <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-faint)' }}>{existing ? existing.file.name : 'Click to upload'}</p>
                    </div>
                    <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={e => handleDocFile(type, e.target.files?.[0] || null)} />
                  </label>
                );
              })}
            </div>
            {missingDocs.length > 0 && (
              <p className="text-xs flex items-center gap-1.5 px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.06)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.15)' }}>
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                Missing: {missingDocs.map(d => d.label).join(', ')}
              </p>
            )}
          </div>
        )}

        {/* Step: Review */}
        {stepName === 'Review' && (
          <div className="space-y-5">
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Review Details
            </h3>
            <div className="space-y-4">
              {/* Source badge */}
              <div className="flex items-center gap-2">
                <span className="text-xs px-2.5 py-1 rounded-lg font-semibold"
                  style={{ background: isDSA ? 'rgba(var(--accent-rgb),0.1)' : 'rgba(16,185,129,0.1)', color: isDSA ? 'var(--accent)' : 'var(--success)', border: `1px solid ${isDSA ? 'rgba(var(--accent-rgb),0.3)' : 'rgba(16,185,129,0.3)'}` }}>
                  {isDSA ? 'DSA Sourced' : 'Direct'}
                </span>
              </div>

              {isDSA && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>
                    DSA Info {dsaMode === 'existing' && <span className="ml-2 font-normal normal-case text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.2)' }}>Existing</span>}
                    {dsaMode === 'new' && <span className="ml-2 font-normal normal-case text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>New</span>}
                  </p>
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                    {(dsaMode === 'existing' && selectedExistingDSA
                      ? [['DSA Name', selectedExistingDSA.full_name], ['DSA Code', selectedExistingDSA.dsa_code], ['Mobile', selectedExistingDSA.mobile], ['Email', selectedExistingDSA.email]]
                      : [['DSA Name', dsaForm.full_name], ['Mobile', dsaForm.mobile], ['Email', dsaForm.email], ['PAN', dsaForm.pan], ['Bank', dsaForm.bank_name + ' · ' + dsaForm.bank_account]]
                    ).filter(r => r[1]).map(([k, v]) => (
                      <div key={k} className="flex gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                        <p className="text-xs w-28 flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{k}</p>
                        <p className="text-xs text-text-primary">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {[
                { title: 'Personal', rows: [['Name', form.full_name], ['PAN', form.pan], ['DOB', form.dob], ['Mobile', form.phone], ['Email', form.email]] },
                { title: 'Address', rows: [['Address', form.address], ['City', form.city], ['State', form.state], ['Pincode', form.pincode]] },
                { title: 'Demat & Bank', rows: [['Demat A/C', form.demat_account], ['DP Name', form.dp_name], ['Bank A/C', form.bank_account], ['IFSC', form.bank_ifsc], ['Bank', form.bank_name]] },
                { title: 'Products', rows: [['Selected', prefs.map(v => PRODUCTS.find(p => p.value === v)?.label).filter(Boolean).join(', ')]] },
              ].map(section => (
                <div key={section.title}>
                  <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>{section.title}</p>
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
                    {section.rows.filter(r => r[1]).map(([k, v]) => (
                      <div key={k} className="flex gap-3 px-4 py-2.5" style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                        <p className="text-xs w-28 flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{k}</p>
                        <p className="text-xs text-text-primary">{v}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Client Login Setup */}
              <div>
                <p className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--accent)' }}>Client Portal Login</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: false, label: 'No Login', desc: 'Client will not have portal access.' },
                    { value: true, label: 'Enable Login', desc: 'Client can login using PAN + password.' },
                  ].map(opt => (
                    <button key={String(opt.value)} onClick={() => { setClientLoginEnabled(opt.value); if (!opt.value) setClientInitialPassword(''); }}
                      className="text-left p-3.5 rounded-xl transition-all"
                      style={{
                        background: clientLoginEnabled === opt.value ? (opt.value ? 'rgba(16,185,129,0.08)' : 'rgba(107,107,107,0.08)') : 'var(--bg-base)',
                        border: `2px solid ${clientLoginEnabled === opt.value ? (opt.value ? 'var(--success)' : 'var(--text-muted)') : 'var(--border)'}`,
                      }}>
                      <p className="text-sm font-bold" style={{ color: clientLoginEnabled === opt.value ? (opt.value ? 'var(--success)' : 'var(--text-bright)') : 'var(--text-muted)' }}>{opt.label}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{opt.desc}</p>
                    </button>
                  ))}
                </div>
                {clientLoginEnabled === true && (
                  <div className="mt-3 space-y-3">
                    <Field label="First-Time Password" required hint="Client will be prompted to change this on first login.">
                      <Input
                        type="password"
                        value={clientInitialPassword}
                        onChange={e => setClientInitialPassword(e.target.value)}
                        placeholder="Create a strong password"
                      />
                    </Field>
                    {clientInitialPassword.length > 0 && passwordError(clientInitialPassword) && (
                      <p className="text-xs" style={{ color: 'var(--danger)' }}>{passwordError(clientInitialPassword)}</p>
                    )}
                    <div className="p-3 rounded-xl text-xs" style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', color: 'var(--text-muted)' }}>
                      Login ID: <span className="font-mono font-bold text-text-primary">{form.pan.toUpperCase() || 'PAN'}</span> &nbsp;&middot;&nbsp; Email: <span className="text-text-primary">{form.email || '—'}</span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--accent)' }}>Documents</p>
                <div className="flex flex-wrap gap-2">
                  {requiredDocTypes.map(({ type, label }) => {
                    const uploaded = docFiles.find(d => d.type === type);
                    return (
                      <span key={type} className="text-xs px-2.5 py-1 rounded-lg flex items-center gap-1"
                        style={uploaded
                          ? { background: 'rgba(16,185,129,0.1)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.2)' }
                          : { background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.2)' }}>
                        {uploaded ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                        {label}{!uploaded ? ' (Missing)' : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-30"
          style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
          Back
        </button>
        {step < STEPS.length - 1 ? (
          <button onClick={handleNext}
            disabled={stepName === 'Basic Info' && (!!dupWarnings.pan || !panVerifiedName)}
            className="px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            Next <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={saving || missingDocs.length > 0 || clientLoginEnabled === null || (clientLoginEnabled === true && !isPasswordStrong(clientInitialPassword.trim()))}
            className="px-6 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            {saving ? 'Saving...' : 'Complete Onboarding'}
          </button>
        )}
      </div>
    </div>
  );
}
