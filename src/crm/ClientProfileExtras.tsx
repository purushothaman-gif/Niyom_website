/**
 * CRM: a client's nominees and the history of profile changes they made
 * themselves in the portal (contact details, nominees, bank accounts). Read
 * under the CRM's own RLS — the RM sees their clients, admins see all.
 */
import { useEffect, useState } from 'react';
import { ClipboardCopy, Download, FileCheck2, History, Loader2, Pencil, UserRound, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  BANK_ACCOUNT_TYPES, CONTACT_OWNERS, GENDERS, INCOME_SLABS, NOMINEE_ID_TYPES, OCCUPATIONS,
  PEP_STATUSES, WEALTH_SOURCES, labelOf,
} from '../../supabase/functions/_shared/profile/investorProfile';
import { countryName } from '../../supabase/functions/_shared/profile/countries';
import {
  buildMfAccountSheet, sheetToCsv, sheetToText, type SheetClient, type SheetNominee,
} from '../../supabase/functions/_shared/profile/mfAccountSheet';
import { InvestorProfileEditorModal } from './InvestorProfileEditor';

/** The mutual-fund investor profile the client declared in onboarding. */
interface InvestorProfile {
  gender: string | null;
  investment_preferences: string[] | null;
  bank_account_type: string | null;
  occupation: string | null;
  income_slab: string | null;
  wealth_source: string | null;
  pep_status: string | null;
  birth_place: string | null;
  birth_country: string | null;
  tax_resident_outside_india: boolean | null;
  foreign_tax_country: string | null;
  foreign_tax_id: string | null;
  father_name: string | null;
  spouse_name: string | null;
  mobile_belongs_to: string | null;
  email_belongs_to: string | null;
  nomination_choice: string | null;
  investor_profile_completed_at: string | null;
  investor_profile_source: string | null;
}

interface Nominee {
  id: string;
  full_name: string;
  relationship: string;
  dob: string | null;
  share_percent: number;
  guardian_name: string | null;
  guardian_pan: string | null;
  guardian_dob: string | null;
  guardian_relationship: string | null;
  id_type: string | null;
  id_number: string | null;
  added_via: string;
}

interface Change {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  created_at: string;
}

const LABEL: Record<string, string> = {
  phone: 'Mobile',
  email: 'Email',
  address: 'Address',
  city: 'City',
  state: 'State',
  pincode: 'PIN code',
  nominees: 'Nominees',
  bank_account_added: 'Bank account added',
  bank_account_removed: 'Bank account removed',
  bank_account_approved: 'Bank account approved',
  bank_account_rejected: 'Bank account rejected',
  primary_bank: 'Primary bank changed',
};

/** Who made the change: the client in the portal, or staff reviewing it in the CRM. */
const SOURCE: Record<string, string> = {
  client_portal: 'Client · email OTP',
  crm: 'CRM review',
};

const when = (d: string) =>
  new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ClientProfileExtrasModal({ clientId, clientName, employeeId, onClose }: { clientId: string; clientName: string; employeeId?: string; onClose: () => void }) {
  const [nominees, setNominees] = useState<Nominee[] | null>(null);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [profile, setProfile] = useState<(InvestorProfile & SheetClient) | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase
      .from('nw_clients')
      .select('*')
      .eq('id', clientId)
      .maybeSingle()
      .then(({ data }) => setProfile((data as unknown as (InvestorProfile & SheetClient) | null) ?? null));
    supabase
      .from('nw_client_nominees')
      .select('id, full_name, relationship, dob, share_percent, guardian_name, guardian_pan, guardian_dob, guardian_relationship, id_type, id_number, added_via')
      .eq('client_id', clientId)
      .order('created_at')
      .then(({ data }) => setNominees((data as Nominee[]) ?? []));
    supabase
      .from('nw_client_profile_changes')
      .select('id, field, old_value, new_value, source, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setChanges((data as Change[]) ?? []));
  }, [clientId, reload]);

  // One sheet for whichever platform opens the mutual fund account.
  const sheet = profile && nominees ? buildMfAccountSheet(profile, nominees as SheetNominee[]) : null;
  const copySheet = async () => {
    if (!sheet) return;
    try {
      await navigator.clipboard.writeText(sheetToText(sheet));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the download still works */ }
  };
  const downloadSheet = () => {
    if (!sheet) return;
    const url = URL.createObjectURL(new Blob([sheetToCsv(sheet)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mf-account-${String(profile?.client_code ?? 'client')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      {editing && employeeId && (
        <div onClick={(e) => e.stopPropagation()}>
          <InvestorProfileEditorModal
            clientId={clientId} clientName={clientName} employeeId={employeeId}
            onClose={() => setEditing(false)}
            onSaved={() => { setEditing(false); setReload((n) => n + 1); }}
          />
        </div>
      )}
      <div
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
          <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
Investor profile, nominees & changes — {clientName}
          </h3>
          <button type="button" onClick={onClose} style={{ color: 'var(--text-faint)' }} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-5">
          {sheet && (
            <section className="rounded-lg border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  <FileCheck2 className="h-4 w-4" style={{ color: 'var(--accent)' }} /> Mutual fund account readiness
                </h4>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={copySheet} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                    <ClipboardCopy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy account sheet'}
                  </button>
                  <button type="button" onClick={downloadSheet} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                    <Download className="h-3.5 w-3.5" /> CSV
                  </button>
                </div>
              </div>
              <p className="mt-2 text-sm font-semibold" style={{ color: sheet.ready ? 'var(--success)' : 'var(--warning, #d97706)' }}>
                {sheet.ready ? 'Ready — everything needed to open the account is on record.' : `Not ready — ${sheet.missing.length} thing${sheet.missing.length === 1 ? '' : 's'} still needed:`}
              </p>
              {!sheet.ready && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {sheet.missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              )}
              {sheet.notes.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs" style={{ color: 'var(--text-faint)' }}>
                  {sheet.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}
              <p className="mt-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                The account sheet lists every field with its BSE StAR MF code — use it to open the account on the fund platform today; the same data registers the account at BSE directly later.
              </p>
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              <UserRound className="h-4 w-4" style={{ color: 'var(--accent)' }} /> Investor profile (mutual funds)
            </h4>
            {employeeId && profile && (
              <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}>
                <Pencil className="h-3.5 w-3.5" /> {profile.investor_profile_completed_at ? 'Edit' : 'Record for client'}
              </button>
            )}
            </div>
            {profile === undefined ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : !profile ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Could not load the profile.</p>
            ) : !profile.investor_profile_completed_at ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
                {profile.investment_preferences?.includes('mutual_funds')
                  ? 'Not completed yet — the client is asked for it in the portal under Complete KYC, or you can record it for them here. Needed before a mutual fund account can be opened.'
                  : 'Not applicable — the client has not chosen mutual funds.'}
              </p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  {([
                    ['Gender', labelOf(GENDERS, profile.gender)],
                    ['Occupation', labelOf(OCCUPATIONS, profile.occupation)],
                    ['Annual income', labelOf(INCOME_SLABS, profile.income_slab)],
                    ['Source of wealth', labelOf(WEALTH_SOURCES, profile.wealth_source)],
                    ['Politically exposed', labelOf(PEP_STATUSES, profile.pep_status)],
                    ['Father’s name', profile.father_name || '—'],
                    ['Spouse’s name', profile.spouse_name || '—'],
                    ['Born in', [profile.birth_place, profile.birth_country ? countryName(profile.birth_country) : null].filter(Boolean).join(', ') || '—'],
                    ['Tax resident abroad', profile.tax_resident_outside_india
                      ? `Yes — ${countryName(profile.foreign_tax_country)} (${profile.foreign_tax_id ?? ''})`
                      : 'No'],
                    ['Mobile belongs to', labelOf(CONTACT_OWNERS, profile.mobile_belongs_to)],
                    ['Email belongs to', labelOf(CONTACT_OWNERS, profile.email_belongs_to)],
                    ['Bank account type', labelOf(BANK_ACCOUNT_TYPES, profile.bank_account_type)],
                    ['Nomination', profile.nomination_choice === 'opt_out' ? 'Opted out' : 'Nominees below'],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs uppercase" style={{ color: 'var(--text-faint)' }}>{k}</dt>
                      <dd className="font-medium" style={{ color: 'var(--text-primary)' }}>{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                  {profile.investor_profile_source === 'staff' ? 'Recorded by staff on the client’s behalf' : 'Declared by the client'} on {when(profile.investor_profile_completed_at)}.
                </p>
              </>
            )}
          </section>

          <section>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              <Users className="h-4 w-4" style={{ color: 'var(--accent)' }} /> Nominees
            </h4>
            {nominees === null ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : nominees.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No nominees recorded.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--text-faint)' }} className="text-left text-xs uppercase">
                    <th className="py-1.5">Name</th>
                    <th>Relationship</th>
                    <th>DOB</th>
                    <th>ID</th>
                    <th>Guardian</th>
                    <th className="text-right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {nominees.map((n) => (
                    <tr key={n.id} className="border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}>
                      <td className="py-2 font-medium">{n.full_name}</td>
                      <td>{n.relationship}</td>
                      <td>{n.dob ?? '—'}</td>
                      <td>{n.id_type ? `${labelOf(NOMINEE_ID_TYPES, n.id_type)} ${n.id_number ?? ''}` : '—'}</td>
                      <td>{n.guardian_name ? `${n.guardian_name}${n.guardian_pan ? ` (${n.guardian_pan})` : ''}` : '—'}</td>
                      <td className="text-right font-semibold">{n.share_percent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              <History className="h-4 w-4" style={{ color: 'var(--accent)' }} /> Profile change history
            </h4>
            {changes === null ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : changes.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No profile changes yet.</p>
            ) : (
              <ul className="space-y-2">
                {changes.map((c) => (
                  <li key={c.id} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{LABEL[c.field] ?? c.field}</span>
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                        {SOURCE[c.source] ?? c.source} · {when(c.created_at)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {c.old_value ?? '—'} → <b style={{ color: 'var(--text-primary)' }}>{c.new_value ?? '—'}</b>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
