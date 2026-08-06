import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { NWEmployee } from '../types';
import { AlertCircle, CheckCircle2, ShieldAlert, ExternalLink, UserCog } from 'lucide-react';
import { LeadFormData, NWLead, LeadPriority } from './leadTypes';
import { PRIORITIES, INTERESTED_PRODUCTS, LEAD_SOURCES } from './leadConstants';
import { Drawer, Field, Input, Textarea, Select, PrimaryButton, GhostButton } from './leadUi';
import { isAdminRole, isValidMobile, isValidEmail, isValidPan, formatDate } from './leadUtils';

interface DupMatch {
  entity: 'lead' | 'client';
  entity_id: string;
  matched_on: string;
  display_name: string;
  owner_name: string | null;
  status: string;
  created_at: string;
}

interface Props {
  employee: NWEmployee;
  mode: 'create' | 'edit';
  lead?: NWLead | null;
  onClose: () => void;
  onSaved: (lead: NWLead) => void;
  onOpenExisting?: (leadId: string) => void;
}

const EMPTY: LeadFormData = {
  lead_name: '', mobile: '', alternate_number: '', email: '', pan: '', address: '',
  city: '', state: '', occupation: '', company_name: '', age: '', annual_income: '',
  investment_capacity: '', interested_product: '', lead_source: '', campaign: '',
  priority: 'medium', remarks: '',
};

function fromLead(l: NWLead): LeadFormData {
  return {
    lead_name: l.lead_name, mobile: l.mobile, alternate_number: l.alternate_number,
    email: l.email, pan: l.pan, address: l.address, city: l.city, state: l.state,
    occupation: l.occupation, company_name: l.company_name,
    age: l.age?.toString() ?? '', annual_income: l.annual_income?.toString() ?? '',
    investment_capacity: l.investment_capacity?.toString() ?? '',
    interested_product: l.interested_product, lead_source: l.lead_source,
    campaign: l.campaign, priority: l.priority, remarks: l.remarks,
  };
}

const LEAD_SELECT =
  '*, owner:nw_employees!nw_leads_owner_employee_id_fkey(full_name, employee_code), ' +
  'created_by:nw_employees!nw_leads_created_by_employee_id_fkey(full_name, employee_code)';

export default function LeadForm({ employee, mode, lead, onClose, onSaved, onOpenExisting }: Props) {
  const isAdmin = isAdminRole(employee);
  const [form, setForm] = useState<LeadFormData>(mode === 'edit' && lead ? fromLead(lead) : EMPTY);
  const [ownerId, setOwnerId] = useState<string>(
    mode === 'edit' && lead ? (lead.owner_employee_id ?? '') : (isAdmin ? '' : employee.id));
  const [employees, setEmployees] = useState<{ id: string; full_name: string; employee_code: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Duplicate detection
  const [dupMatches, setDupMatches] = useState<DupMatch[]>([]);
  const [dupIgnored, setDupIgnored] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);
  const dupTimer = useRef<ReturnType<typeof setTimeout>>();

  const set = (k: keyof LeadFormData, v: string) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from('nw_employees').select('id, full_name, employee_code')
      .eq('status', 'active').order('full_name')
      .then(({ data }) => setEmployees(data || []));
  }, [isAdmin]);

  // Debounced cross-CRM duplicate scan on mobile / email / pan.
  const runDupCheck = useCallback(async (f: LeadFormData) => {
    const mobile = isValidMobile(f.mobile) ? f.mobile : '';
    const email = isValidEmail(f.email) ? f.email : '';
    const pan = isValidPan(f.pan) ? f.pan : '';
    if (!mobile && !email && !pan) { setDupMatches([]); return; }
    const { data } = await supabase.rpc('nw_check_lead_duplicate', {
      p_mobile: mobile, p_email: email, p_pan: pan,
      /*
       * `p_exclude_lead_id uuid DEFAULT NULL` — optional, so omitting it lets
       * the SQL default apply. That is the same thing as passing NULL and needs
       * no cast, unlike the required uuid parameter in requestReview below.
       */
      p_exclude_lead_id: mode === 'edit' && lead ? lead.id : undefined,
    });
    setDupMatches((data as DupMatch[]) || []);
    setDupIgnored(false); setRequested(false);
  }, [mode, lead]);

  useEffect(() => {
    clearTimeout(dupTimer.current);
    dupTimer.current = setTimeout(() => runDupCheck(form), 500);
    return () => clearTimeout(dupTimer.current);
  }, [form.mobile, form.email, form.pan, runDupCheck]);

  const validate = (): string | null => {
    if (!form.lead_name.trim()) return 'Lead name is required.';
    if (!form.mobile.trim()) return 'Mobile number is required.';
    if (!isValidMobile(form.mobile)) return 'Enter a valid 10-digit Indian mobile number.';
    if (form.email.trim() && !isValidEmail(form.email)) return 'Enter a valid email address.';
    if (form.pan.trim() && !isValidPan(form.pan)) return 'PAN format is invalid (e.g. ABCDE1234F).';
    if (form.age.trim() && (isNaN(+form.age) || +form.age < 1 || +form.age > 120)) return 'Enter a valid age.';
    return null;
  };

  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

  const buildPayload = () => ({
    lead_name: form.lead_name.trim(),
    mobile: form.mobile.trim(),
    alternate_number: form.alternate_number.trim(),
    email: form.email.trim().toLowerCase(),
    pan: form.pan.trim().toUpperCase(),
    address: form.address.trim(), city: form.city.trim(), state: form.state.trim(),
    occupation: form.occupation.trim(), company_name: form.company_name.trim(),
    age: form.age.trim() === '' ? null : parseInt(form.age, 10),
    annual_income: numOrNull(form.annual_income),
    investment_capacity: numOrNull(form.investment_capacity),
    interested_product: form.interested_product.trim(),
    lead_source: form.lead_source.trim(), campaign: form.campaign.trim(),
    priority: form.priority, remarks: form.remarks.trim(),
  });

  // Hard duplicate = an exact match against an existing LEAD (clients are advisory).
  const hardDup = dupMatches.some(m => m.entity === 'lead');
  const blockingDup = hardDup && !dupIgnored;

  const handleSubmit = async () => {
    const v = validate();
    if (v) { setError(v); return; }
    if (blockingDup) { setError('Resolve the duplicate warning before saving.'); return; }
    setSaving(true); setError('');
    try {
      if (mode === 'edit' && lead) {
        const { data, error: e } = await supabase.from('nw_leads')
          .update(buildPayload()).eq('id', lead.id).select(LEAD_SELECT).single();
        if (e) throw e;
        await supabase.from('nw_lead_activities').insert([{
          lead_id: lead.id, employee_id: employee.id, action: 'Edited',
          description: `Lead details updated by ${employee.full_name}`,
        }]);
        onSaved(data as unknown as NWLead);
      } else {
        const origin = isAdmin ? 'admin_manual' : 'employee_manual';
        const owner = isAdmin ? (ownerId || null) : employee.id;
        const insertRow = {
          ...buildPayload(),
          lead_origin: origin,
          created_by_employee_id: employee.id,
          owner_employee_id: owner,
          status: owner ? 'Assigned' : 'New',
        };
        const { data, error: e } = await supabase.from('nw_leads')
          .insert([insertRow]).select(LEAD_SELECT).single();
        if (e) throw e;
        const created = data as unknown as NWLead;
        await supabase.from('nw_lead_activities').insert([{
          lead_id: created.id, employee_id: employee.id, action: 'Lead Created',
          description: `Lead ${created.lead_code} created (${origin.replace('_', ' ')})` +
            (owner ? '' : ' — placed in Admin Lead Pool'),
        }]);
        onSaved(created);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save lead.');
    } finally {
      setSaving(false);
    }
  };

  const requestReview = async () => {
    setRequesting(true); setError('');
    const leadMatch = dupMatches.find(m => m.entity === 'lead');
    const { error: e } = await supabase.rpc('nw_request_duplicate_review', {
      /*
       * `p_existing_lead_id uuid` is required with no default, so the generator
       * types it `string` — but uuid accepts NULL, and NULL is the real "no
       * existing lead" value. Omitting it (undefined) would drop a required
       * argument, so the cast is deliberate.
       */
      p_existing_lead_id: (leadMatch?.entity_id ?? null) as string,
      p_payload: buildPayload(),
    });
    setRequesting(false);
    if (e) { setError(e.message); return; }
    setRequested(true);
  };

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <GhostButton onClick={onClose}>Cancel</GhostButton>
      <PrimaryButton onClick={handleSubmit} disabled={saving || blockingDup}>
        {saving ? 'Saving…' : mode === 'edit' ? 'Save Changes' : 'Create Lead'}
      </PrimaryButton>
    </div>
  );

  return (
    <Drawer open onClose={onClose}
      title={mode === 'edit' ? 'Edit Lead' : 'New Lead'}
      subtitle={mode === 'edit' && lead ? lead.lead_code : isAdmin ? 'Admin manual entry' : 'Assigned to you automatically'}
      footer={footer}>
      <div className="space-y-5">
        {error && (
          <div className="p-3 rounded-xl flex items-center gap-2.5" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--danger)' }} />
            <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
          </div>
        )}

        {/* Duplicate panel */}
        {dupMatches.length > 0 && (
          isAdmin ? (
            <div className="p-4 rounded-xl space-y-3" style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.3)' }}>
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" style={{ color: 'rgb(var(--warning-soft-rgb))' }} />
                <p className="text-sm font-bold" style={{ color: 'rgb(var(--warning-soft-rgb))' }}>
                  Possible duplicate{dupMatches.length > 1 ? 's' : ''} found
                </p>
              </div>
              <div className="space-y-2">
                {dupMatches.map(m => (
                  <div key={m.entity + m.entity_id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {m.display_name}
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold" style={{ background: 'var(--bg-raised)', color: 'var(--text-faint)' }}>{m.entity}</span>
                      </p>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                        Matched on {m.matched_on} · {m.status} · {m.owner_name || 'Unassigned'} · {formatDate(m.created_at)}
                      </p>
                    </div>
                    {m.entity === 'lead' && onOpenExisting && (
                      <button onClick={() => onOpenExisting(m.entity_id)}
                        className="text-xs font-semibold flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--accent)' }}>
                        Open <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {hardDup && (
                <div className="flex items-center gap-2 pt-1">
                  <button onClick={() => setDupIgnored(true)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                    style={{ background: dupIgnored ? 'rgba(16,185,129,0.12)' : 'var(--bg-raised)', color: dupIgnored ? 'var(--success)' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                    {dupIgnored ? '✓ Ignored — you can save' : 'Ignore & Continue'}
                  </button>
                  <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>Merge is available from the duplicate review queue.</span>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-xl space-y-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" style={{ color: 'var(--danger)' }} />
                <p className="text-sm font-bold" style={{ color: 'var(--danger)' }}>This lead already exists.</p>
              </div>
              {/* Only non-confidential summary is shown to employees. */}
              {(() => {
                const m = dupMatches.find(x => x.entity === 'lead') ?? dupMatches[0];
                return (
                  <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                    {[['Current Owner', m.owner_name || 'Unassigned (Admin Pool)'],
                      ['Current Status', m.status],
                      ['Date Created', formatDate(m.created_at)]].map(([k, v]) => (
                      <div key={k} className="flex gap-3 px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-base)' }}>
                        <p className="text-[11px] w-28 flex-shrink-0" style={{ color: 'var(--text-faint)' }}>{k}</p>
                        <p className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>{v}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {requested ? (
                <div className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--success)' }}>
                  <CheckCircle2 className="w-4 h-4" /> Request sent to admin for review.
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <GhostButton onClick={onClose} className="!py-1.5 !px-3 text-xs">Cancel</GhostButton>
                  <button onClick={requestReview} disabled={requesting}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                    style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
                    {requesting ? 'Sending…' : 'Request Admin Review'}
                  </button>
                </div>
              )}
            </div>
          )
        )}

        {/* Owner (admin only) */}
        {isAdmin && (
          <div className="p-4 rounded-xl" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
            <Field label="Lead Owner" hint="Leave as Admin Lead Pool to distribute later.">
              <div className="flex items-center gap-2">
                <UserCog className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--accent)' }} />
                <Select value={ownerId} onChange={e => setOwnerId(e.target.value)}>
                  <option value="">Admin Lead Pool (Unassigned)</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name} · {e.employee_code}</option>)}
                </Select>
              </div>
            </Field>
          </div>
        )}

        {/* Contact block */}
        <SectionTitle>Contact</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Lead Name" required>
            <Input value={form.lead_name} onChange={e => set('lead_name', e.target.value)} placeholder="Full name" />
          </Field>
          <Field label="Mobile Number" required>
            <Input type="tel" value={form.mobile} onChange={e => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="9876543210" maxLength={10} />
          </Field>
          <Field label="Alternate Number">
            <Input type="tel" value={form.alternate_number} onChange={e => set('alternate_number', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="Optional" maxLength={10} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="name@example.com" />
          </Field>
          <Field label="PAN" hint="Optional — helps duplicate detection.">
            <Input value={form.pan} onChange={e => set('pan', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} placeholder="ABCDE1234F" maxLength={10} />
          </Field>
        </div>
        <Field label="Address">
          <Textarea value={form.address} onChange={e => set('address', e.target.value)} placeholder="Full address…" />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="City"><Input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Mumbai" /></Field>
          <Field label="State"><Input value={form.state} onChange={e => set('state', e.target.value)} placeholder="Maharashtra" /></Field>
        </div>

        {/* Professional / financial */}
        <SectionTitle>Profile & Investment</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Occupation"><Input value={form.occupation} onChange={e => set('occupation', e.target.value)} placeholder="e.g. Business Owner" /></Field>
          <Field label="Company Name"><Input value={form.company_name} onChange={e => set('company_name', e.target.value)} placeholder="Company" /></Field>
          <Field label="Age"><Input type="number" value={form.age} onChange={e => set('age', e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="35" /></Field>
          <Field label="Annual Income (₹)"><Input type="number" value={form.annual_income} onChange={e => set('annual_income', e.target.value)} placeholder="1200000" /></Field>
          <Field label="Investment Capacity (₹)"><Input type="number" value={form.investment_capacity} onChange={e => set('investment_capacity', e.target.value)} placeholder="500000" /></Field>
          <Field label="Interested Product">
            <Select value={form.interested_product} onChange={e => set('interested_product', e.target.value)}>
              <option value="">Select…</option>
              {INTERESTED_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
        </div>

        {/* Source & priority */}
        <SectionTitle>Source & Priority</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Lead Source">
            <Select value={form.lead_source} onChange={e => set('lead_source', e.target.value)}>
              <option value="">Select…</option>
              {LEAD_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Campaign"><Input value={form.campaign} onChange={e => set('campaign', e.target.value)} placeholder="e.g. Diwali FD Drive" /></Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={e => set('priority', e.target.value as LeadPriority)}>
              {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Remarks">
          <Textarea value={form.remarks} onChange={e => set('remarks', e.target.value)} placeholder="Initial notes about this lead…" />
        </Field>
      </div>
    </Drawer>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold uppercase tracking-wider pt-1" style={{ color: 'var(--accent)' }}>{children}</p>
  );
}
