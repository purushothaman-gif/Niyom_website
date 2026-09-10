import React, { useState, useEffect, useCallback } from 'react';
import { LogoLoader } from '../components/LogoLoader';
import { supabase } from '../lib/supabase';
import { NWEmployee, NWDSA, NWDSABankAccount } from './types';
import { PartnerOnboardLinks } from './PartnerOnboardLinks';
import { isPasswordStrong, passwordChecks, passwordError } from '../lib/passwordPolicy';
import {
  Handshake, Plus, X, Upload, CheckCircle2, AlertCircle,
  Search, Phone, Mail, CreditCard, Building2, User, Eye,
  ToggleLeft, ToggleRight, Trash2, ChevronDown, Pencil,
  KeyRound, ShieldOff, ShieldCheck, Copy, RefreshCw, MailCheck, UserCog,
  Landmark, Star,
} from 'lucide-react';

/** Policy-compliant temp password (8+, upper, lower, digit, symbol). */
function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const symbol = '!@#$%&*?';
  const all = upper + lower + digit + symbol;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  const chars = [pick(upper), pick(lower), pick(digit), pick(symbol)];
  while (chars.length < 12) chars.push(pick(all));
  // Fisher-Yates so the guaranteed characters aren't always in the first four slots.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

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
  // Partner Portal login provisioning
  const [loginDSA, setLoginDSA] = useState<NWDSA | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPw, setLoginPw] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginDone, setLoginDone] = useState(false);
  // Reassign a DSA — and its whole client book — to another employee/admin.
  const [reassignDSA, setReassignDSA] = useState<NWDSA | null>(null);
  const [reassignToId, setReassignToId] = useState('');
  const [reassignReason, setReassignReason] = useState('');
  const [reassignBusy, setReassignBusy] = useState(false);
  const [reassignError, setReassignError] = useState('');
  const [reassignCounts, setReassignCounts] =
    useState<{ clients: number; deals: number; txns: number } | null>(null);
  // Bank Accounts manager — up to 5 accounts per partner, exactly one Primary.
  // Mirrors the client-side manager in ManageClients.tsx.
  const [bankDSA, setBankDSA] = useState<NWDSA | null>(null);
  const [bankAccounts, setBankAccounts] = useState<NWDSABankAccount[]>([]);
  const [bankBusy, setBankBusy] = useState(false);
  const [bankError, setBankError] = useState('');
  const [bankFormOpen, setBankFormOpen] = useState<'new' | string | null>(null); // 'new' | account id | null
  const [bankForm, setBankForm] = useState<{ account_number: string; ifsc: string; bank_name: string; holder_name: string; label: string }>({ account_number: '', ifsc: '', bank_name: '', holder_name: '', label: '' });

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

  // --- Reassign DSA (admin only) -------------------------------------------
  // Ownership of a partner is nw_dsa.employee_id alone, and every client the
  // partner sources is filed under that same employee. Moving one without the
  // other would split the book, so the nw_reassign_dsa RPC moves the partner,
  // their clients, and those clients' deals / transactions / leads together.
  const openReassign = async (dsa: NWDSA) => {
    setReassignDSA(dsa);
    setReassignToId('');
    setReassignReason('');
    setReassignError('');
    setReassignCounts(null);
    // Impact preview: what actually travels with the partner.
    const { data: clients } = await supabase.from('nw_clients').select('id').eq('dsa_id', dsa.id);
    const ids = ((clients ?? []) as { id: string }[]).map(c => c.id);
    if (!ids.length) { setReassignCounts({ clients: 0, deals: 0, txns: 0 }); return; }
    const [dcRes, txRes] = await Promise.all([
      supabase.from('nw_deal_confirmations').select('id', { count: 'exact', head: true }).in('client_id', ids),
      supabase.from('nw_transactions').select('id', { count: 'exact', head: true }).in('client_id', ids),
    ]);
    setReassignCounts({ clients: ids.length, deals: dcRes.count ?? 0, txns: txRes.count ?? 0 });
  };

  const confirmReassign = async () => {
    if (!reassignDSA || !reassignToId) return;
    setReassignBusy(true);
    setReassignError('');
    const { data, error: rpcErr } = await supabase.rpc('nw_reassign_dsa', {
      p_dsa_id: reassignDSA.id,
      p_to_employee: reassignToId,
      p_reason: reassignReason.trim(),
    });
    setReassignBusy(false);
    if (rpcErr) { setReassignError(rpcErr.message); return; }
    const r = (data ?? {}) as {
      unchanged?: boolean; clients?: number; deals?: number; transactions?: number; leads?: number;
    };
    const toName = empList.find(e => e.id === reassignToId)?.full_name ?? 'the selected employee';
    const movedName = reassignDSA.full_name;
    setReassignDSA(null);
    setSuccess(r.unchanged
      ? `${movedName} is already mapped to ${toName}.`
      : `${movedName} mapped to ${toName} — ${r.clients ?? 0} client(s), ${r.deals ?? 0} deal(s) and ` +
        `${r.transactions ?? 0} transaction(s) moved across.`);
    fetchDSAs();
  };

  // --- Bank Accounts manager ------------------------------------------------
  // nw_dsa.bank_* is the explicit primary mirror — the payout debit note, the
  // partner profile RPC and the list column all read it. Updated here on every
  // change to the primary account (no DB trigger), exactly as on the client side.
  const mirrorPrimaryBank = async (dsaId: string, acct: { account_number: string; ifsc: string; bank_name: string } | null) => {
    await supabase.from('nw_dsa').update({
      bank_account: acct?.account_number ?? '',
      bank_ifsc: acct?.ifsc ?? '',
      bank_name: acct?.bank_name ?? '',
      updated_at: new Date().toISOString(),
    }).eq('id', dsaId);
  };

  /**
   * Keep the primary bank-account ROW in step with the bank fields on the DSA
   * form. The form still writes nw_dsa.bank_* (the mirror every payout reads);
   * without this the primary row would drift away from it the first time
   * someone edited a DSA. Secondary accounts are untouched.
   */
  const syncPrimaryBankRow = async (
    dsaId: string,
    acct: { account_number: string; ifsc: string; bank_name: string; holder_name: string },
  ) => {
    if (!acct.account_number) return;
    const { data } = await supabase.from('nw_dsa_bank_accounts')
      .select('id').eq('dsa_id', dsaId).eq('is_primary', true).maybeSingle();
    if (data?.id) {
      await supabase.from('nw_dsa_bank_accounts')
        .update({ ...acct, updated_at: new Date().toISOString() }).eq('id', (data as { id: string }).id);
    } else {
      await supabase.from('nw_dsa_bank_accounts').insert({ dsa_id: dsaId, ...acct, is_primary: true });
    }
  };

  const loadBankAccounts = async (dsaId: string) => {
    const { data } = await supabase.from('nw_dsa_bank_accounts')
      .select('*').eq('dsa_id', dsaId)
      .order('is_primary', { ascending: false }).order('created_at', { ascending: true });
    setBankAccounts((data as NWDSABankAccount[]) || []);
  };

  const openBankManager = async (dsa: NWDSA) => {
    setBankDSA(dsa);
    setBankFormOpen(null);
    setBankError('');
    setBankAccounts([]);
    await loadBankAccounts(dsa.id);
  };
  const closeBankManager = () => { setBankDSA(null); setBankFormOpen(null); setBankError(''); fetchDSAs(); };

  const startAddBank = () => {
    // Holder defaults to the partner's own name — the payout account is theirs.
    setBankForm({ account_number: '', ifsc: '', bank_name: '', holder_name: bankDSA?.full_name || '', label: '' });
    setBankError('');
    setBankFormOpen('new');
  };
  const startEditBank = (a: NWDSABankAccount) => {
    setBankForm({ account_number: a.account_number, ifsc: a.ifsc, bank_name: a.bank_name, holder_name: a.holder_name, label: a.label });
    setBankError('');
    setBankFormOpen(a.id);
  };

  const saveBankAccount = async () => {
    if (!bankDSA) return;
    const acct = {
      account_number: bankForm.account_number.trim(),
      ifsc: bankForm.ifsc.trim().toUpperCase(),
      bank_name: bankForm.bank_name.trim(),
      holder_name: bankForm.holder_name.trim(),
      label: bankForm.label.trim(),
    };
    if (!acct.account_number) { setBankError('Account number is required.'); return; }
    // Same IFSC rule the DSA form enforces, but only when one is supplied.
    if (acct.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(acct.ifsc)) { setBankError('Enter a valid IFSC code.'); return; }
    setBankBusy(true);
    setBankError('');
    try {
      if (bankFormOpen === 'new') {
        // First account for the partner automatically becomes the primary.
        const isFirst = bankAccounts.length === 0;
        const { error } = await supabase.from('nw_dsa_bank_accounts').insert({ dsa_id: bankDSA.id, ...acct, is_primary: isFirst });
        if (error) throw error;
        if (isFirst) await mirrorPrimaryBank(bankDSA.id, acct);
      } else if (bankFormOpen) {
        // Narrowed rather than asserted: bankFormOpen is 'new' | id | null, and
        // null here would mean updating a row with no id — nothing to do.
        const existing = bankAccounts.find(a => a.id === bankFormOpen);
        const { error } = await supabase.from('nw_dsa_bank_accounts')
          .update({ ...acct, updated_at: new Date().toISOString() }).eq('id', bankFormOpen);
        if (error) throw error;
        if (existing?.is_primary) await mirrorPrimaryBank(bankDSA.id, acct);
      }
      setBankFormOpen(null);
      await loadBankAccounts(bankDSA.id);
    } catch (e: any) {
      setBankError(e?.message || 'Could not save bank account.');
    } finally {
      setBankBusy(false);
    }
  };

  const makeBankPrimary = async (a: NWDSABankAccount) => {
    if (!bankDSA || a.is_primary) return;
    setBankBusy(true);
    setBankError('');
    try {
      // Unset the current primary FIRST to satisfy the one-primary unique index.
      const { error: e1 } = await supabase.from('nw_dsa_bank_accounts')
        .update({ is_primary: false, updated_at: new Date().toISOString() })
        .eq('dsa_id', bankDSA.id).eq('is_primary', true);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from('nw_dsa_bank_accounts')
        .update({ is_primary: true, updated_at: new Date().toISOString() }).eq('id', a.id);
      if (e2) throw e2;
      await mirrorPrimaryBank(bankDSA.id, a);
      await loadBankAccounts(bankDSA.id);
    } catch (e: any) {
      setBankError(e?.message || 'Could not change the primary account.');
    } finally {
      setBankBusy(false);
    }
  };

  const deleteBankAccount = async (a: NWDSABankAccount) => {
    if (!bankDSA) return;
    // Never leave a partner with accounts but no primary: block deleting the
    // primary while others exist — pick a new primary first.
    if (a.is_primary && bankAccounts.length > 1) {
      setBankError('Set another account as Primary before deleting this one.');
      return;
    }
    setBankBusy(true);
    setBankError('');
    try {
      const wasLast = bankAccounts.length === 1;
      const { error } = await supabase.from('nw_dsa_bank_accounts').delete().eq('id', a.id);
      if (error) throw error;
      // Only clear the mirror when the deleted account was the last one — a
      // partner with no bank account on file cannot be paid out.
      if (a.is_primary && wasLast) await mirrorPrimaryBank(bankDSA.id, null);
      await loadBankAccounts(bankDSA.id);
    } catch (e: any) {
      setBankError(e?.message || 'Could not delete bank account.');
    } finally {
      setBankBusy(false);
    }
  };

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

        await syncPrimaryBankRow(editingId, {
          account_number: updates.bank_account,
          ifsc: updates.bank_ifsc,
          bank_name: updates.bank_name,
          holder_name: updates.full_name,
        });

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

        const { data: created, error: insertErr } = await supabase.from('nw_dsa').insert([{
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
        }]).select('id').single();
        if (insertErr) throw insertErr;

        // Seed the partner's first (Primary) bank account row from the form, so
        // the manager and the nw_dsa.bank_* mirror start out agreeing.
        if (created?.id) {
          await syncPrimaryBankRow((created as { id: string }).id, {
            account_number: form.bank_account.trim(),
            ifsc: form.bank_ifsc.toUpperCase(),
            bank_name: form.bank_name.trim(),
            holder_name: form.full_name.trim(),
          });
        }

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

  // ── Partner Portal login ────────────────────────────────────────────────
  // Issuing credentials is a distinct, audited action, so it gets its own modal
  // rather than a field in the save-everything edit form (which would invite an
  // accidental credential reissue on an unrelated edit).

  const openLoginModal = (dsa: NWDSA) => {
    setLoginDSA(dsa);
    setLoginEmail(dsa.email || '');
    setLoginPw(generatePassword());
    setLoginError('');
    setLoginDone(false);
  };

  const handleEnableLogin = async () => {
    if (!loginDSA) return;
    setLoginError('');

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail.trim())) {
      setLoginError('Enter a valid email address for the partner.');
      return;
    }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test((loginDSA.pan || '').toUpperCase())) {
      setLoginError('This DSA has an invalid PAN. Fix it on the DSA record first — PAN is the login ID.');
      return;
    }
    if (!isPasswordStrong(loginPw)) {
      setLoginError(passwordError(loginPw) || 'Password does not meet the policy.');
      return;
    }

    setLoginBusy(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-partner-login`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
            Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            dsa_id: loginDSA.id,
            email: loginEmail.trim().toLowerCase(),
            pan: loginDSA.pan,
            initial_password: loginPw,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoginError(body?.error || 'Could not enable partner login.');
        setLoginBusy(false);
        return;
      }
      setLoginDone(true);
      fetchDSAs();
    } catch {
      setLoginError('Network error. Please try again.');
    }
    setLoginBusy(false);
  };

  // Enable/disable portal access for a login that already exists. Goes through
  // nw_partner_set_login_enabled() rather than a direct UPDATE so the change is
  // audited in the same transaction — nw_dsa_login_audit has no INSERT policy
  // (service-role only), so a client-side UPDATE could never record itself, and
  // a guard trigger now rejects that path outright.
  //
  // nw_current_dsa_id() requires dsa_login_enabled, so a disable takes effect on
  // the partner's very next query — no waiting for their JWT to expire.
  // Welcome email — one partner at a time, deliberately. The confirm names the
  // recipient because the address comes off the DSA record and is easy to get
  // wrong; the "sent" tick is per-session only, the durable record is the
  // welcome_email_sent row in nw_dsa_login_audit.
  const [welcomeBusyId, setWelcomeBusyId] = useState<string | null>(null);
  const [welcomeSentIds, setWelcomeSentIds] = useState<Set<string>>(new Set());

  const sendWelcomeEmail = async (dsa: NWDSA) => {
    if (!window.confirm(
      `Send partner portal sign-in instructions to ${dsa.full_name}?\n\n` +
      `It will go to ${dsa.email}.\n\n` +
      `The email contains no password — it tells them to set their own using ` +
      `Forgot Password on the sign-in page.`
    )) return;

    setWelcomeBusyId(dsa.id);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-partner-welcome-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sess.session?.access_token ?? ''}`,
            Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ dsa_id: dsa.id }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { alert(body?.error || 'Could not send the welcome email.'); return; }
      setWelcomeSentIds(prev => new Set(prev).add(dsa.id));
      alert(`Welcome email sent to ${body?.to || dsa.email}.`);
    } catch {
      alert('Network error. Please try again.');
    } finally {
      setWelcomeBusyId(null);
    }
  };

  const setLoginEnabled = async (dsa: NWDSA, enabled: boolean) => {
    const { error } = await supabase.rpc('nw_partner_set_login_enabled', {
      p_dsa_id: dsa.id,
      p_enabled: enabled,
    });
    if (error) { alert(error.message); return; }
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

      {/* Partner self-onboarding links (copy-paste) */}
      <PartnerOnboardLinks employee={employee} />

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

      {/* Bank Accounts manager — 1 Primary + up to 4 Secondary */}
      {bankDSA && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}>
          <div className="w-full max-w-2xl rounded-2xl overflow-hidden max-h-[90vh] flex flex-col" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <p className="text-xs font-mono" style={{ color: 'var(--accent)' }}>{bankDSA.dsa_code}</p>
                <h2 className="text-lg font-bold text-text-primary">Bank Accounts — {bankDSA.full_name}</h2>
              </div>
              <button onClick={closeBankManager} style={{ color: 'var(--text-faint)' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--text-bright)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-faint)')}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  Up to 5 accounts. Exactly one is Primary — payouts and debit notes use it.
                </p>
                <button onClick={startAddBank} disabled={bankAccounts.length >= 5 || bankFormOpen === 'new'}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                  style={{ background: 'var(--bg-raised)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                  <Plus className="w-3.5 h-3.5" /> Add Account{bankAccounts.length >= 5 ? ' (max 5)' : ''}
                </button>
              </div>

              {bankError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}>
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
                  <p className="text-xs" style={{ color: 'var(--danger)' }}>{bankError}</p>
                </div>
              )}

              {bankFormOpen && (
                <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
                    {bankFormOpen === 'new' ? 'Add Bank Account' : 'Edit Bank Account'}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Account Number" required>
                      <Input value={bankForm.account_number} className="font-mono"
                        onChange={e => setBankForm(f => ({ ...f, account_number: e.target.value.replace(/\D/g, '') }))}
                        placeholder="Account number" />
                    </Field>
                    <Field label="IFSC">
                      <Input value={bankForm.ifsc} className="font-mono"
                        onChange={e => setBankForm(f => ({ ...f, ifsc: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11) }))}
                        placeholder="HDFC0001234" />
                    </Field>
                    <Field label="Bank Name">
                      <Input value={bankForm.bank_name}
                        onChange={e => setBankForm(f => ({ ...f, bank_name: e.target.value }))}
                        placeholder="HDFC Bank" />
                    </Field>
                    <Field label="Account Holder">
                      <Input value={bankForm.holder_name}
                        onChange={e => setBankForm(f => ({ ...f, holder_name: e.target.value }))}
                        placeholder={bankDSA.full_name} />
                    </Field>
                    <Field label="Label (optional)">
                      <Input value={bankForm.label}
                        onChange={e => setBankForm(f => ({ ...f, label: e.target.value }))}
                        placeholder="e.g. Payout, Savings" />
                    </Field>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setBankFormOpen(null); setBankError(''); }}
                      className="px-3 py-1.5 rounded-lg text-xs" style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
                    <button onClick={saveBankAccount} disabled={bankBusy || !bankForm.account_number.trim()}
                      className="px-4 py-1.5 rounded-lg text-xs font-bold text-on-accent disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                      {bankBusy ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}

              {bankAccounts.length === 0 && !bankFormOpen ? (
                <p className="text-sm text-center py-6" style={{ color: 'var(--text-faint)' }}>
                  No bank accounts yet. Add the first account (it becomes Primary).
                </p>
              ) : (
                <div className="space-y-2">
                  {bankAccounts.map(a => (
                    <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-text-primary truncate">{a.bank_name || '—'}</p>
                          {a.is_primary && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold" style={{ background: 'rgba(var(--accent-rgb),0.12)', color: 'var(--accent)' }}>
                              <Star className="w-3 h-3" /> Primary
                            </span>
                          )}
                          {a.label && <span className="text-xs px-2 py-0.5 rounded-lg" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}>{a.label}</span>}
                        </div>
                        <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-faint)' }}>{a.account_number}{a.ifsc ? ` · ${a.ifsc}` : ''}</p>
                        {a.holder_name && <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{a.holder_name}</p>}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {!a.is_primary && (
                          <button onClick={() => makeBankPrimary(a)} disabled={bankBusy} title="Make Primary"
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                            style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                            Make Primary
                          </button>
                        )}
                        <button onClick={() => startEditBank(a)} disabled={bankBusy} title="Edit"
                          className="p-1.5 rounded-lg disabled:opacity-50" style={{ color: 'var(--text-faint)' }}><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => deleteBankAccount(a)} disabled={bankBusy} title="Delete"
                          className="p-1.5 rounded-lg disabled:opacity-50" style={{ color: 'var(--text-faint)' }}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4" style={{ borderTop: '1px solid var(--border)' }}>
              <button onClick={closeBankManager} className="w-full py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Enable Partner Portal login */}
      {loginDSA && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--overlay)', backdropFilter: 'blur(4px)' }}>
          <div className="w-full max-w-md rounded-2xl p-6" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <KeyRound className="w-5 h-5" style={{ color: 'var(--accent)' }} />
                <h3 className="text-base font-bold text-text-primary">Enable Partner Login</h3>
              </div>
              <button onClick={() => setLoginDSA(null)} style={{ color: 'var(--text-faint)' }}><X className="w-5 h-5" /></button>
            </div>

            {loginDone ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl flex items-start gap-2.5" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--success)' }} />
                  <p className="text-sm" style={{ color: 'var(--success)' }}>
                    Partner login enabled for {loginDSA.full_name}.
                  </p>
                </div>
                <div className="p-4 rounded-xl space-y-3" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Share these credentials</p>
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sign in at</p>
                    <p className="text-sm font-mono text-text-primary">niyomwealth.com/partner-login</p>
                  </div>
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Login ID (PAN)</p>
                    <p className="text-sm font-mono text-text-primary">{loginDSA.pan}</p>
                  </div>
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Temporary password</p>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-mono font-bold flex-1" style={{ color: 'var(--accent)' }}>{loginPw}</p>
                      <button onClick={() => navigator.clipboard?.writeText(loginPw)} title="Copy"
                        className="p-1.5 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    This password is shown once. The partner must set their own password on first sign-in.
                  </p>
                </div>
                <button onClick={() => setLoginDSA(null)} className="w-full py-2.5 rounded-xl text-sm font-bold text-on-accent"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                  Done
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Give <span className="font-semibold text-text-primary">{loginDSA.full_name}</span>{' '}
                  (<span className="font-mono" style={{ color: 'var(--accent)' }}>{loginDSA.dsa_code}</span>)
                  access to the Partner Portal. They sign in with their PAN and a temporary password.
                </p>

                {loginError && (
                  <div className="p-3 rounded-xl flex items-start gap-2.5" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--danger)' }} />
                    <p className="text-sm" style={{ color: 'var(--danger)' }}>{loginError}</p>
                  </div>
                )}

                <Field label="Login ID (PAN)">
                  <Input value={loginDSA.pan} readOnly className="font-mono" style={{ opacity: 0.7 }} />
                </Field>

                <Field label="Partner Email" required>
                  <Input value={loginEmail} onChange={e => setLoginEmail(e.target.value)}
                    placeholder="partner@example.com" type="email" />
                </Field>
                <p className="text-xs -mt-2" style={{ color: 'var(--text-faint)' }}>
                  Must not be an email that already has a client login — partner and client
                  logins are kept separate.
                </p>

                <Field label="Temporary Password" required>
                  <div className="flex items-center gap-2">
                    <Input value={loginPw} onChange={e => setLoginPw(e.target.value)} className="font-mono flex-1" />
                    <button type="button" onClick={() => setLoginPw(generatePassword())} title="Generate a new password"
                      className="p-2.5 rounded-xl" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </Field>
                <div className="space-y-1">
                  {passwordChecks(loginPw).map(r => (
                    <p key={r.text} className="text-xs flex items-center gap-1.5" style={{ color: r.met ? 'var(--success)' : 'var(--text-faint)' }}>
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: r.met ? 'var(--success)' : 'var(--text-faint)' }} />
                      {r.text}
                    </p>
                  ))}
                </div>

                <div className="flex gap-3 pt-1">
                  <button onClick={() => setLoginDSA(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                    style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                    Cancel
                  </button>
                  <button onClick={handleEnableLogin} disabled={loginBusy || !isPasswordStrong(loginPw)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                    {loginBusy ? 'Enabling…' : 'Enable Login'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {/* Reassign DSA Modal — admin only */}
      {reassignDSA && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.8)' }}>
          <div className="w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <h2 className="text-sm font-bold text-text-primary">Reassign DSA</h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {reassignDSA.full_name}{' '}
                  <span className="font-mono" style={{ color: 'var(--accent)' }}>({reassignDSA.dsa_code})</span>
                </p>
              </div>
              <button onClick={() => setReassignDSA(null)} style={{ color: 'var(--text-faint)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div className="p-4 rounded-xl" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2 text-xs flex-wrap" style={{ color: 'var(--text-secondary)' }}>
                  <span className="font-semibold text-text-primary">Currently mapped to:</span>
                  <span className="px-2 py-0.5 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                    {reassignDSA.employee?.full_name || 'Unassigned'}
                  </span>
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
                  Every client sourced through this partner moves to the new employee too,
                  along with their deals and transactions, so the partner and their book stay
                  with one owner. DSA payouts are unaffected.
                </p>
              </div>

              {/* Impact preview */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: 'Clients', value: reassignCounts?.clients },
                  { label: 'Deals', value: reassignCounts?.deals },
                  { label: 'Transactions', value: reassignCounts?.txns },
                ].map(c => (
                  <div key={c.label} className="px-3 py-2 rounded-xl text-center" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
                    <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
                      {reassignCounts ? c.value : '—'}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{c.label}</p>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Map To
                </label>
                <select value={reassignToId} onChange={e => setReassignToId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm text-text-primary outline-none"
                  style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
                  <option value="">— Select an employee —</option>
                  {empList
                    .filter(e => e.id !== reassignDSA.employee_id)
                    .map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Reason (optional)
                </label>
                <textarea value={reassignReason} onChange={e => setReassignReason(e.target.value)} rows={2}
                  placeholder="Why this reassignment?"
                  className="w-full px-3 py-2.5 rounded-xl text-sm text-text-primary outline-none resize-none"
                  style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }} />
              </div>

              {reassignError && (
                <div className="p-3 rounded-xl flex items-start gap-2 text-sm"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger)' }}>
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {reassignError}
                </div>
              )}
            </div>

            <div className="px-6 pb-5 flex justify-end gap-3">
              <button onClick={() => setReassignDSA(null)} disabled={reassignBusy}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <button onClick={confirmReassign} disabled={reassignBusy || !reassignToId}
                className="px-5 py-2 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50 flex items-center gap-2"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                <UserCog className="w-3.5 h-3.5" />
                {reassignBusy ? 'Reassigning...' : 'Reassign DSA'}
              </button>
            </div>
          </div>
        </div>
      )}

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
            { label: 'Portal', value: dsas.filter(d => d.dsa_login_enabled).length, color: 'var(--accent)' },
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
            <LogoLoader size={48} />
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
                    {dsa.dsa_login_enabled ? (
                      <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold inline-flex items-center gap-1"
                        style={{
                          background: dsa.dsa_password_changed ? 'rgba(var(--accent-rgb),0.1)' : 'rgba(245,158,11,0.12)',
                          color: dsa.dsa_password_changed ? 'var(--accent)' : 'var(--warning)',
                        }}
                        title={dsa.dsa_password_changed ? 'Partner portal access is active' : 'Temporary password not yet changed by the partner'}>
                        <KeyRound className="w-3 h-3" />
                        {dsa.dsa_password_changed ? 'Portal' : 'Temp pw'}
                      </span>
                    ) : dsa.dsa_auth_user_id ? (
                      /* Provisioned but switched off — distinct from "never had
                         a login", because restoring it reuses their password. */
                      <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold inline-flex items-center gap-1"
                        style={{ background: 'rgba(107,107,107,0.12)', color: 'var(--text-muted)' }}
                        title="Partner portal access is switched off. Restoring it keeps the password they already set.">
                        <ShieldOff className="w-3 h-3" />
                        Portal off
                      </span>
                    ) : null}
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
                  {/* Bank accounts — 1 primary + up to 4 secondary. Same
                      stewardship as Edit (matches the nw_dsa_bank_accounts
                      policies). */}
                  {(isAdmin || dsa.employee_id === employee.id) && (
                    <button onClick={() => openBankManager(dsa)} title="Bank accounts"
                      className="p-2 rounded-lg transition-colors"
                      style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                      <Landmark className="w-4 h-4" />
                    </button>
                  )}
                  {/* Reassign — admin only. Hands the partner and their whole
                      client book to another employee in one step. */}
                  {isAdmin && (
                    <button onClick={() => openReassign(dsa)} title="Reassign DSA to another employee"
                      className="p-2 rounded-lg transition-colors"
                      style={{ background: 'var(--bg-raised)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                      onMouseEnter={e => (e.currentTarget.style.color = 'rgb(var(--info-soft-rgb))')}
                      onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                      <UserCog className="w-4 h-4" />
                    </button>
                  )}
                  {/* Partner Portal login — stewardship: assigned employee or
                      admin, matching the ownership check inside
                      create-partner-login. Disabled for inactive DSAs, since
                      nw_current_dsa_id() requires status='active' anyway. */}
                  {(isAdmin || dsa.employee_id === employee.id) && (
                    dsa.dsa_login_enabled ? (
                      <button onClick={() => setLoginEnabled(dsa, false)} title="Disable partner portal login"
                        className="p-2 rounded-lg transition-colors"
                        style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', color: 'var(--accent)' }}
                        onMouseEnter={e => (e.currentTarget.style.color = 'var(--danger)')}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--accent)')}>
                        <ShieldOff className="w-4 h-4" />
                      </button>
                    ) : dsa.dsa_auth_user_id ? (
                      /* Login exists but is switched off. create-partner-login
                         refuses once an auth user exists (409), so restoring
                         access must flip the flag rather than reissue
                         credentials — the partner keeps the password they set. */
                      <button onClick={() => setLoginEnabled(dsa, true)} disabled={dsa.status !== 'active'}
                        title={dsa.status === 'active' ? 'Restore partner portal login' : 'Reactivate the DSA before restoring login'}
                        className="p-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', color: 'var(--warning)' }}
                        onMouseEnter={e => { if (dsa.status === 'active') e.currentTarget.style.color = 'var(--accent)'; }}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--warning)')}>
                        <ShieldCheck className="w-4 h-4" />
                      </button>
                    ) : (
                      <button onClick={() => openLoginModal(dsa)} disabled={dsa.status !== 'active'}
                        title={dsa.status === 'active' ? 'Enable partner portal login' : 'Reactivate the DSA before enabling login'}
                        className="p-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                        onMouseEnter={e => { if (dsa.status === 'active') e.currentTarget.style.color = 'var(--accent)'; }}
                        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                        <KeyRound className="w-4 h-4" />
                      </button>
                    )
                  )}
                  {/* Welcome email. Only offered once the login actually exists:
                      the mail walks the partner through signing in, and
                      send-partner-reset-otp (the "set your own password" step it
                      points at) requires dsa_login_enabled + an auth user. */}
                  {(isAdmin || dsa.employee_id === employee.id) && dsa.dsa_auth_user_id && (
                    <button onClick={() => sendWelcomeEmail(dsa)}
                      disabled={welcomeBusyId === dsa.id || !dsa.dsa_login_enabled}
                      title={
                        !dsa.dsa_login_enabled
                          ? 'Restore this partner’s login before sending the welcome email'
                          : welcomeSentIds.has(dsa.id)
                            ? 'Welcome email already sent — click to send again'
                            : 'Email sign-in instructions to this partner'
                      }
                      className="p-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: 'var(--bg-raised)', border: '1px solid var(--border)',
                        color: welcomeSentIds.has(dsa.id) ? 'var(--success)' : 'var(--text-muted)',
                      }}
                      onMouseEnter={e => { if (dsa.dsa_login_enabled) e.currentTarget.style.color = 'var(--accent)'; }}
                      onMouseLeave={e => (e.currentTarget.style.color = welcomeSentIds.has(dsa.id) ? 'var(--success)' : 'var(--text-muted)')}>
                      {welcomeBusyId === dsa.id
                        ? <RefreshCw className="w-4 h-4 animate-spin" />
                        : welcomeSentIds.has(dsa.id) ? <MailCheck className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
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
