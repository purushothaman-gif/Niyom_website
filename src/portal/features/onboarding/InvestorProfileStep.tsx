import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Landmark, Loader2, Plus, Trash2, UserRound, Users } from 'lucide-react';
import { clientSupabase as supabase } from '../../../lib/supabase';
import type { NWClient } from '../../../crm/types';
import { OnboardingService } from './onboardingService';
import { ageOn } from '../../../../supabase/functions/_shared/profile/profileRules';
import {
  BANK_ACCOUNT_TYPES, CONTACT_OWNERS, GENDERS, GUARDIAN_RELATIONSHIPS, INCOME_SLABS, MANDATE_PREFERENCES, MAX_MF_NOMINEES, MAX_PARENT_NAME,
  NOMINEE_ID_TYPES, NOMINEE_RELATIONSHIPS, OCCUPATIONS, PEP_STATUSES, WEALTH_SOURCES, validateInvestorProfile,
  validateMandatePreference, validateNomination,
  type InvestorProfileInput, type MandatePreferenceInput, type MfNomineeInput, type NominationInput, type Option,
} from '../../../../supabase/functions/_shared/profile/investorProfile';
import { COUNTRIES, isCountryCode } from '../../../../supabase/functions/_shared/profile/countries';

const COUNTRY_OPTIONS: Option[] = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));

/**
 * The investor profile a mutual-fund exchange account needs — asked only of
 * clients who chose mutual funds. Everything here is the investor's own
 * declaration, so nothing is pre-ticked: a choice the client did not make is
 * not a choice we may send in their name.
 *
 * One form, two ways in. A client fills it in the portal's KYC wizard and it
 * is saved through public-onboard-save-profile, which re-validates with the
 * same rules. An employee onboarding a client fills the same form in the CRM
 * (`staff`), with `save` and `loadNominees` supplied by the CRM so it is
 * written under the employee's own access and recorded as entered by staff.
 * Either way the same shared rules decide what is acceptable.
 */

export type NomineeRecord = {
  full_name: string | null; relationship: string | null; dob: string | null; share_percent: number | string | null;
  id_type: string | null; id_number: string | null; guardian_name: string | null; guardian_dob: string | null;
  guardian_pan: string | null; guardian_relationship: string | null;
};

export type SaveInvestorProfile = (
  profile: InvestorProfileInput,
  nomination: NominationInput,
  mandate: MandatePreferenceInput,
  /** Staff only: details the client's own wizard collects on an earlier step. */
  extras?: { bank_account_type?: string },
) => Promise<{ ok: boolean; error?: string }>;

interface Props {
  client: NWClient | null;
  clientId: string;
  onSaved: () => void;
  onBack?: () => void;
  /** An employee is recording the client's answers on their behalf. */
  staff?: boolean;
  /** Defaults to the client's own save through the edge function. */
  save?: SaveInvestorProfile;
  /** Defaults to reading the client's own nominees under their RLS. */
  loadNominees?: () => Promise<NomineeRecord[]>;
}

type NomineeRow = {
  full_name: string;
  relationship: string;
  dob: string;
  share_percent: string;
  id_type: string;
  id_number: string;
  guardian_name: string;
  guardian_dob: string;
  guardian_pan: string;
  guardian_relationship: string;
};

const blankNominee = (share: string): NomineeRow => ({
  full_name: '', relationship: '', dob: '', share_percent: share, id_type: 'pan', id_number: '',
  guardian_name: '', guardian_dob: '', guardian_pan: '', guardian_relationship: '',
});

const inputCls =
  'w-full rounded-token-md border border-border bg-bg-base px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-accent';

function Field({ label, hint, optional, children }: { label: string; hint?: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-muted">
        {label}{!optional && <span className="ml-0.5 text-accent">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-text-faint">{hint}</p>}
    </div>
  );
}

function Select({ value, onChange, options, placeholder = 'Select…' }:
  { value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** Two or three mutually exclusive answers, none chosen until the client picks. */
function Choice({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Option[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value} type="button" onClick={() => onChange(o.value)} aria-pressed={on}
            className={`rounded-token-md border px-3.5 py-2 text-sm font-semibold transition-colors ${
              on ? 'border-accent/40 bg-selected text-text-primary' : 'border-border bg-bg-elevated text-text-muted hover:text-text-primary'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function InvestorProfileStep({ client, clientId, onSaved, onBack, staff, save: saveWith, loadNominees }: Props) {
  const [gender, setGender] = useState(client?.gender || '');
  const [occupation, setOccupation] = useState(client?.occupation || '');
  const [incomeSlab, setIncomeSlab] = useState(client?.income_slab || '');
  const [wealthSource, setWealthSource] = useState(client?.wealth_source || '');
  const [pep, setPep] = useState(client?.pep_status || '');
  const [birthPlace, setBirthPlace] = useState(client?.birth_place || '');
  // India is by far the common answer; anything stored before the country
  // picker existed (free text) falls back to it rather than to a blank.
  const [birthCountry, setBirthCountry] = useState(isCountryCode(client?.birth_country) ? client.birth_country : 'IND');
  const [taxAbroad, setTaxAbroad] = useState(
    client?.tax_resident_outside_india == null ? '' : client.tax_resident_outside_india ? 'yes' : 'no',
  );
  const [foreignCountry, setForeignCountry] = useState(isCountryCode(client?.foreign_tax_country) ? client.foreign_tax_country : '');
  const [foreignTaxId, setForeignTaxId] = useState(client?.foreign_tax_id || '');
  const [fatherName, setFatherName] = useState(client?.father_name || '');
  const [spouseName, setSpouseName] = useState(client?.spouse_name || '');
  const [mobileOwner, setMobileOwner] = useState(client?.mobile_belongs_to || '');
  const [emailOwner, setEmailOwner] = useState(client?.email_belongs_to || '');

  // The client's own wizard asks for this on its Details step; an employee
  // has no such step, so in staff mode it is asked here.
  const [accountType, setAccountType] = useState(client?.bank_account_type || '');
  const [mandatePref, setMandatePref] = useState(client?.mandate_preference || '');
  const [mandateAmount, setMandateAmount] = useState(client?.mandate_max_amount ? String(Math.round(Number(client.mandate_max_amount))) : '');
  const [mandateUpi, setMandateUpi] = useState(client?.mandate_upi_id || '');

  const [nomination, setNomination] = useState<string>(client?.nomination_choice || '');
  const [nominees, setNominees] = useState<NomineeRow[]>([blankNominee('100')]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Nominees already on file (from the portal's Profile page or an earlier
  // visit to this step) — read under the client's own RLS, or by the CRM.
  useEffect(() => {
    let alive = true;
    const fetchNominees = loadNominees ?? (async (): Promise<NomineeRecord[]> => {
      const { data } = await supabase
        .from('nw_client_nominees')
        .select('full_name, relationship, dob, share_percent, id_type, id_number, guardian_name, guardian_dob, guardian_pan, guardian_relationship')
        .eq('client_id', clientId)
        .order('created_at');
      return (data as NomineeRecord[] | null) ?? [];
    });
    void fetchNominees()
      .then((data) => {
        if (!alive || !data?.length) return;
        setNominees(data.slice(0, MAX_MF_NOMINEES).map((n) => ({
          full_name: n.full_name || '',
          // An older free-text relationship ("Spouse") has no exchange code — ask again.
          relationship: (NOMINEE_RELATIONSHIPS as readonly string[]).includes(n.relationship ?? '') ? n.relationship! : '',
          dob: n.dob || '',
          share_percent: String(Math.round(Number(n.share_percent) || 0) || ''),
          id_type: n.id_type || 'pan',
          id_number: n.id_number || '',
          guardian_name: n.guardian_name || '',
          guardian_dob: n.guardian_dob || '',
          guardian_pan: n.guardian_pan || '',
          guardian_relationship: (GUARDIAN_RELATIONSHIPS as readonly string[]).includes(n.guardian_relationship ?? '') ? n.guardian_relationship! : '',
        })));
        setNomination((cur) => cur || 'nominate');
      })
      .catch(() => { /* the form still works without the prefill */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const upd = (i: number, patch: Partial<NomineeRow>) =>
    setNominees((list) => list.map((n, j) => (j === i ? { ...n, ...patch } : n)));

  const shareTotal = nominees.reduce((sum, n) => sum + (Number(n.share_percent) || 0), 0);

  const save = async () => {
    setError('');
    const profile = {
      gender, occupation, income_slab: incomeSlab, wealth_source: wealthSource, pep_status: pep,
      birth_place: birthPlace, birth_country: birthCountry,
      tax_resident_outside_india: taxAbroad === '' ? null : taxAbroad === 'yes',
      foreign_tax_country: foreignCountry, foreign_tax_id: foreignTaxId,
      father_name: fatherName, spouse_name: spouseName,
      mobile_belongs_to: mobileOwner, email_belongs_to: emailOwner,
    };
    const checkedProfile = validateInvestorProfile(profile);
    if (!checkedProfile.ok) return setError(checkedProfile.error);

    const nominationInput = nomination === 'opt_out'
      ? { choice: 'opt_out' as const }
      : {
          choice: nomination as 'nominate',
          nominees: nominees.map((n): MfNomineeInput => ({
            full_name: n.full_name,
            relationship: n.relationship,
            dob: n.dob || null,
            share_percent: Number(n.share_percent),
            id_type: n.id_type,
            id_number: n.id_number,
            guardian_name: n.guardian_name,
            guardian_dob: n.guardian_dob || null,
            guardian_pan: n.guardian_pan,
            guardian_relationship: n.guardian_relationship,
          })),
        };
    const checkedNomination = validateNomination(nominationInput as NominationInput);
    if (!checkedNomination.ok) return setError(checkedNomination.error);

    if (staff && !accountType) return setError('Select the client’s bank account type.');
    const mandate: MandatePreferenceInput = { preference: mandatePref, max_amount: mandateAmount, upi_id: mandateUpi };
    const checkedMandate = validateMandatePreference(mandate);
    if (!checkedMandate.ok) return setError(checkedMandate.error);

    setBusy(true);
    const r = saveWith
      ? await saveWith(profile, nominationInput as NominationInput, mandate, staff ? { bank_account_type: accountType } : undefined)
      : await OnboardingService.saveInvestorProfile(clientId, profile, nominationInput, mandate);
    setBusy(false);
    if (!r.ok) return setError(r.error || 'We could not save your profile. Please try again.');
    onSaved();
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <UserRound className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-bold text-text-primary">{staff ? 'Investor profile' : 'Your investor profile'}</h2>
        </div>
        <p className="mt-1 text-xs text-text-muted">
          {staff
            ? 'Mutual fund regulations ask every investor for these details. Enter the client’s own answers — it is recorded as entered by you on their behalf.'
            : 'Mutual fund regulations ask every investor for these details. They are your own declaration, so please answer each one.'}
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-token-md border border-danger-soft/20 bg-danger-soft/10 px-3.5 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-danger-soft" />
          <p className="text-sm text-danger-soft">{error}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Gender"><Choice value={gender} onChange={setGender} options={GENDERS} /></Field>
        <Field label="Occupation"><Select value={occupation} onChange={setOccupation} options={OCCUPATIONS} /></Field>
        <Field label="Annual income"><Select value={incomeSlab} onChange={setIncomeSlab} options={INCOME_SLABS} /></Field>
        <Field label="Main source of wealth"><Select value={wealthSource} onChange={setWealthSource} options={WEALTH_SOURCES} /></Field>
        <Field label="Father’s name" optional hint="Father’s or spouse’s name — at least one is needed.">
          <input className={inputCls} value={fatherName} maxLength={MAX_PARENT_NAME} onChange={(e) => setFatherName(e.target.value)} placeholder="As on your records" />
        </Field>
        <Field label="Spouse’s name" optional>
          <input className={inputCls} value={spouseName} maxLength={MAX_PARENT_NAME} onChange={(e) => setSpouseName(e.target.value)} placeholder="If married" />
        </Field>
        <Field label="Place of birth">
          <input className={inputCls} value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} placeholder="City or town" />
        </Field>
        <Field label="Country of birth">
          <Select value={birthCountry} onChange={setBirthCountry} options={COUNTRY_OPTIONS} />
        </Field>
      </div>

      <div className="space-y-4 border-t border-border pt-4">
        <Field label="Are you a politically exposed person?" hint="Someone who holds, or has held, a prominent public position — or is closely related to such a person.">
          <Select value={pep} onChange={setPep} options={PEP_STATUSES} />
        </Field>
        <Field label="Do you pay tax in any country other than India?">
          <Choice value={taxAbroad} onChange={setTaxAbroad} options={[{ value: 'no', label: 'No, only in India' }, { value: 'yes', label: 'Yes' }]} />
        </Field>
        {taxAbroad === 'yes' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Other country of tax residence">
              <Select value={foreignCountry} onChange={setForeignCountry} options={COUNTRY_OPTIONS.filter((c) => c.value !== 'IND')} />
            </Field>
            <Field label="Tax identification number there">
              <input className={inputCls} value={foreignTaxId} onChange={(e) => setForeignTaxId(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`The mobile ${client?.phone ? `ending ${String(client.phone).slice(-4)}` : 'number'} is`}>
            <Select value={mobileOwner} onChange={setMobileOwner} options={CONTACT_OWNERS} />
          </Field>
          <Field label="The email address is">
            <Select value={emailOwner} onChange={setEmailOwner} options={CONTACT_OWNERS} />
          </Field>
        </div>
      </div>

      <div className="space-y-4 border-t border-border pt-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-bold text-text-primary">Nomination</h3>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            A nominee receives your investments if something happens to you. You can add up to {MAX_MF_NOMINEES}, or choose not to nominate.
          </p>
        </div>
        <Choice
          value={nomination} onChange={setNomination}
          options={[{ value: 'nominate', label: 'Add a nominee' }, { value: 'opt_out', label: 'I do not wish to nominate' }]}
        />

        {nomination === 'opt_out' && (
          <p className="rounded-token-md border border-warning-soft/30 bg-warning-soft/10 p-3.5 text-xs leading-relaxed text-text-muted">
            Without a nominee, your legal heirs will need to produce court or succession documents to claim your investments. You can add a nominee later.
          </p>
        )}

        {nomination === 'nominate' && (
          <div className="space-y-4">
            {nominees.map((n, i) => {
              const age = n.dob ? ageOn(n.dob) : null;
              const minor = age !== null && age < 18;
              return (
                <div key={i} className="space-y-4 rounded-token-lg border border-border-subtle bg-bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wider text-accent">Nominee {i + 1}</p>
                    {nominees.length > 1 && (
                      <button type="button" onClick={() => setNominees((l) => l.filter((_, j) => j !== i))}
                        className="flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-danger-soft" aria-label={`Remove nominee ${i + 1}`}>
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    )}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Full name">
                      <input className={inputCls} value={n.full_name} onChange={(e) => upd(i, { full_name: e.target.value })} />
                    </Field>
                    <Field label="Relationship to you">
                      <select className={inputCls} value={n.relationship} onChange={(e) => upd(i, { relationship: e.target.value })}>
                        <option value="">Select…</option>
                        {NOMINEE_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </Field>
                    <Field label="Date of birth">
                      <input type="date" className={inputCls} value={n.dob} onChange={(e) => upd(i, { dob: e.target.value })} />
                    </Field>
                    <Field label="Share (%)">
                      <input className={inputCls} inputMode="numeric" value={n.share_percent}
                        onChange={(e) => upd(i, { share_percent: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
                    </Field>
                    <Field label="Identity document">
                      <Select value={n.id_type} onChange={(v) => upd(i, { id_type: v, id_number: '' })} options={NOMINEE_ID_TYPES} />
                    </Field>
                    <Field label={n.id_type === 'aadhaar_last4' ? 'Last 4 digits of Aadhaar' : 'Document number'}
                      hint={n.id_type === 'aadhaar_last4' ? 'Only the last four digits — we never store the full number.' : undefined}>
                      <input className={inputCls} value={n.id_number}
                        maxLength={n.id_type === 'aadhaar_last4' ? 4 : n.id_type === 'pan' ? 10 : 20}
                        inputMode={n.id_type === 'aadhaar_last4' ? 'numeric' : 'text'}
                        onChange={(e) => upd(i, {
                          id_number: n.id_type === 'aadhaar_last4'
                            ? e.target.value.replace(/\D/g, '').slice(0, 4)
                            : e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
                        })} />
                    </Field>
                  </div>
                  {minor && (
                    <div className="space-y-3 border-t border-border pt-4">
                      <p className="text-xs text-text-muted">This nominee is under 18, so a guardian is needed.</p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Guardian’s full name">
                          <input className={inputCls} value={n.guardian_name} onChange={(e) => upd(i, { guardian_name: e.target.value })} />
                        </Field>
                        <Field label="Guardian is the nominee’s">
                          <Select value={n.guardian_relationship} onChange={(v) => upd(i, { guardian_relationship: v })}
                            options={GUARDIAN_RELATIONSHIPS.map((g) => ({ value: g, label: g }))} />
                        </Field>
                        <Field label="Guardian’s date of birth">
                          <input type="date" className={inputCls} value={n.guardian_dob} onChange={(e) => upd(i, { guardian_dob: e.target.value })} />
                        </Field>
                        <Field label="Guardian’s PAN">
                          <input className={inputCls} value={n.guardian_pan} maxLength={10}
                            onChange={(e) => upd(i, { guardian_pan: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="ABCDE1234F" />
                        </Field>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex items-center justify-between">
              {nominees.length < MAX_MF_NOMINEES ? (
                <button type="button" onClick={() => setNominees((l) => [...l, blankNominee('')])}
                  className="flex items-center gap-1.5 text-xs font-bold text-accent">
                  <Plus className="h-3.5 w-3.5" /> Add another nominee
                </button>
              ) : <span />}
              <p className={`text-xs font-semibold ${shareTotal === 100 ? 'text-success-soft' : 'text-text-muted'}`}>
                Shares total {shareTotal}% {shareTotal === 100 ? '' : '— must be 100%'}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4 border-t border-border pt-4">
        <div>
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-bold text-text-primary">Auto-debit for SIPs</h3>
          </div>
          <p className="mt-1 text-xs text-text-muted">
            A SIP is paid by an auto-debit from {client?.bank_account ? `the bank account ending ${String(client.bank_account).slice(-4)}` : 'the bank account on record'}.
            Nothing is debited until a SIP is started and the mandate is approved with the bank.
          </p>
        </div>
        {staff && (
          <Field label="Bank account type">
            <Choice value={accountType} onChange={setAccountType} options={BANK_ACCOUNT_TYPES} />
          </Field>
        )}
        <Choice value={mandatePref} onChange={setMandatePref} options={MANDATE_PREFERENCES} />
        {(mandatePref === 'enach' || mandatePref === 'upi') && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Maximum per debit (₹)" hint="The most that may be debited at one time — set it above the largest SIP planned.">
              <input className={inputCls} inputMode="numeric" value={mandateAmount} placeholder="e.g. 25000"
                onChange={(e) => setMandateAmount(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            </Field>
            {mandatePref === 'upi' && (
              <Field label="UPI ID">
                <input className={inputCls} value={mandateUpi} placeholder="name@bank" onChange={(e) => setMandateUpi(e.target.value.trim())} />
              </Field>
            )}
          </div>
        )}
      </div>

      <div className={`flex ${onBack ? 'justify-between' : 'justify-end'}`}>
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-2 rounded-token-md border border-border bg-bg-raised px-5 py-2.5 text-sm font-semibold text-text-muted">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
        )}
        <button
          onClick={save} disabled={busy}
          className="press flex items-center gap-2 rounded-token-md px-6 py-2.5 text-sm font-bold text-text-on-accent disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {staff ? 'Save profile' : 'Save and continue'}
        </button>
      </div>
    </div>
  );
}
