/**
 * Client Management — register a client directly at BSE StAR MF.
 *
 * Standalone by design: this creates a UCC from details entered here, with no
 * dependency on CRM records. BSE is the system of record for who can transact,
 * and a client existing elsewhere says nothing about their BSE registration.
 *
 * Registers a PHYSICAL, resident-individual UCC — the shape the proxy's
 * toAddUcc mapper builds and the only one verified end-to-end against BSE.
 * Demat, joint holders and NRI are not offered rather than half-supported.
 */
import { useState } from 'react';
import { BadgeCheck, ExternalLink, Paperclip, Plus, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { Card } from '../../../portal/components/Card';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { StatusPill } from '../../../portal/components/StatusPill';
import {
  BseOpsExtra,
  BseOpsService,
  isBseConfigured,
  NOMINEE_RELATIONS,
  type BseUccRow,
} from '../../services/BseOpsService';
import { CrmImportService, type CrmClientLookup } from '../../services/CrmImportService';
import { useBseData } from '../../hooks/useBseData';
import {
  ConfirmBox,
  ErrorNote,
  Field,
  NotConfigured,
  SuccessCard,
  inputCls,
  selectCls,
} from './formBits';

interface Form {
  clientCode: string;
  pan: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  gender: 'M' | 'F' | 'O';
  email: string;
  mobile: string;
  line1: string;
  city: string;
  state: string;
  pincode: string;
  accountNumber: string;
  ifsc: string;
  accountType: string;
  fatherName: string;
  spouseName: string;
  /** 'pending' until staff actively choose — an opt-out must be deliberate. */
  nominationChoice: 'pending' | 'nominate' | 'decline';
  nominees: NomineeDraft[];
  bankProof: DocDraft | null;
  bankProofType: 'cancel_cheque' | 'bank_statement';
  aof: DocDraft | null;
}

interface DocDraft {
  fileName: string;
  fileSize: number;
  fileBlob: string;
}

interface NomineeDraft {
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  relation: string;
  percent: string;
  identifierType: 'pan' | 'aadhaar' | 'passport';
  identifierNumber: string;
  isMinor: boolean;
  guardianFirstName: string;
  guardianLastName: string;
  guardianDob: string;
  guardianPan: string;
}

const EMPTY_NOMINEE: NomineeDraft = {
  firstName: '',
  middleName: '',
  lastName: '',
  dob: '',
  relation: '18',
  percent: '100',
  identifierType: 'pan',
  identifierNumber: '',
  isMinor: false,
  guardianFirstName: '',
  guardianLastName: '',
  guardianDob: '',
  guardianPan: '',
};

const EMPTY: Form = {
  clientCode: '',
  pan: '',
  firstName: '',
  middleName: '',
  lastName: '',
  dob: '',
  gender: 'M',
  email: '',
  mobile: '',
  line1: '',
  city: '',
  state: '',
  pincode: '',
  accountNumber: '',
  ifsc: '',
  accountType: 'SB',
  fatherName: '',
  spouseName: '',
  nominationChoice: 'pending',
  nominees: [],
  bankProof: null,
  bankProofType: 'cancel_cheque',
  aof: null,
};

/** BSE encodes entity type in the PAN's 4th character — 'P' for an individual. */
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** BSE caps each supporting document at 3 MB and accepts these types. */
const MAX_DOC_BYTES = 3 * 1024 * 1024;
const DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png';

/** Read a file into the base64 blob BSE's identifier blocks carry. */
async function readAsDoc(file: File): Promise<DocDraft> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000; // chunked — String.fromCharCode blows the stack on big files
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { fileName: file.name, fileSize: file.size, fileBlob: btoa(binary) };
}

/** Per-nominee problems, positionally aligned with form.nominees. */
function nomineeIssues(f: Form): (string | null)[] {
  return f.nominees.map((n) => {
    if (!n.firstName.trim()) return 'First name is required.';
    if (!n.identifierNumber.trim()) return 'An ID number is required.';
    if (n.identifierType === 'pan' && !PAN_RE.test(n.identifierNumber.trim().toUpperCase()))
      return 'PAN format must be ABCDE1234F.';
    if (n.identifierType === 'aadhaar' && !/^\d{4}$/.test(n.identifierNumber.trim()))
      return 'BSE takes only the last 4 digits of the Aadhaar number.';
    const pct = Number(n.percent);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100)
      return 'Share must be a whole number between 1 and 100.';
    if (n.isMinor) {
      if (!n.guardianFirstName.trim()) return 'A minor nominee needs a guardian name.';
      if (!n.guardianDob) return "A minor nominee needs the guardian's date of birth.";
      if (!PAN_RE.test(n.guardianPan.trim().toUpperCase()))
        return "The guardian's PAN is required, format ABCDE1234F.";
    }
    return null;
  });
}

function validate(f: Form): Partial<Record<keyof Form, string>> {
  const e: Partial<Record<keyof Form, string>> = {};
  // BSE accepts more than plain alphanumerics here — hyphenated codes such as
  // NW-002-0001 were confirmed against live BSE — so the code is passed through
  // as typed. Only length is enforced; BSE is the authority on the rest.
  if (!f.clientCode.trim()) e.clientCode = 'Required — must be unique for this member.';
  else if (f.clientCode.trim().length > 20) e.clientCode = 'Up to 20 characters.';

  const pan = f.pan.trim().toUpperCase();
  if (!pan) e.pan = 'Required.';
  else if (!PAN_RE.test(pan)) e.pan = 'Format must be ABCDE1234F.';
  else if (pan[3] !== 'P') e.pan = 'Fourth character must be “P” for an individual — BSE rejects others.';

  if (!f.firstName.trim()) e.firstName = 'Required.';
  if (!f.dob) e.dob = 'Required.';
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = 'A valid email is required.';
  if (!/^\d{10}$/.test(f.mobile.replace(/\D/g, ''))) e.mobile = '10-digit mobile number.';
  // BSE enforces a 10-character minimum on address_line_1; catching it here
  // beats a rejection after the client code has been consumed.
  if (!f.line1.trim()) e.line1 = 'Required.';
  else if (f.line1.trim().length < 10) e.line1 = 'BSE needs at least 10 characters.';
  if (!f.city.trim()) e.city = 'Required.';
  if (!f.state.trim()) e.state = 'Required.';
  if (!/^\d{6}$/.test(f.pincode.trim())) e.pincode = '6-digit pincode.';
  if (!/^\d{9,20}$/.test(f.accountNumber.trim()))
    e.accountNumber = 'Account number: 9–20 digits, including leading zeros.';
  if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(f.ifsc.trim()))
    e.ifsc = 'IFSC format, e.g. HDFC0000123.';

  // Nomination is a regulatory choice, so it has to be made rather than
  // defaulted. Declining is fine; leaving it unanswered is not.
  if (f.nominationChoice === 'pending') {
    e.nominees = 'Record the client’s nomination, or that they have declined.';
  } else if (f.nominationChoice === 'nominate') {
    if (f.nominees.length === 0) e.nominees = 'Add at least one nominee, or record a decline.';
    else if (nomineeIssues(f).some(Boolean)) e.nominees = 'Fix the highlighted nominee details.';
    else {
      const total = f.nominees.reduce((sum, n) => sum + Number(n.percent || 0), 0);
      if (total !== 100) e.nominees = `Shares must total exactly 100% — currently ${total}%.`;
    }
  }
  return e;
}

export function ClientOnboardingPage() {
  const uccs = useBseData<BseUccRow[]>(() => BseOpsService.uccs());
  const [form, setForm] = useState<Form>(EMPTY);
  const [touched, setTouched] = useState(false);
  // CRM import is a source of typing only — see CrmImportService.
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<CrmClientLookup[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [importedFrom, setImportedFrom] = useState<string | null>(null);
  // CRM row this form was prefilled from — needed to store the UCC afterwards.
  const [importedId, setImportedId] = useState<string | null>(null);
  // PAN check against Cashfree — its registered name is what BSE's KYC compares.
  const [panCheck, setPanCheck] = useState<{ state: 'ok' | 'bad'; name?: string; msg?: string } | null>(null);
  const [panBusy, setPanBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<
    { clientCode: string; status: string; url?: string; linked?: boolean | null } | null
  >(null);

  const errors = validate(form);
  const valid = Object.keys(errors).length === 0;
  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const codeTaken = (uccs.data ?? []).some(
    (u) => u.clientCode.toLowerCase() === form.clientCode.trim().toLowerCase(),
  );

  const issues = nomineeIssues(form);
  const shareTotal = form.nominees.reduce((sum, n) => sum + Number(n.percent || 0), 0);

  const setNominee = (i: number, patch: Partial<NomineeDraft>) =>
    setForm((f) => ({
      ...f,
      nominees: f.nominees.map((n, idx) => (idx === i ? { ...n, ...patch } : n)),
    }));

  const addNominee = () =>
    setForm((f) => {
      // Split evenly so the total lands on 100 without staff doing the sum.
      const next = [...f.nominees, { ...EMPTY_NOMINEE, percent: '' }];
      const even = Math.floor(100 / next.length);
      return {
        ...f,
        nominees: next.map((n, idx) => ({
          ...n,
          percent: String(idx === 0 ? 100 - even * (next.length - 1) : even),
        })),
      };
    });

  const removeNominee = (i: number) =>
    setForm((f) => ({ ...f, nominees: f.nominees.filter((_, idx) => idx !== i) }));

  /** Read a chosen file into base64, rejecting anything over BSE's cap. */
  const pickDoc = (key: 'bankProof' | 'aof') => async (file: File | undefined) => {
    if (!file) return setForm((f) => ({ ...f, [key]: null }));
    if (file.size > MAX_DOC_BYTES) {
      setError(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB — BSE's limit is 3 MB.`);
      return;
    }
    setError(null);
    setForm((f) => ({ ...f, [key]: null }));
    const doc = await readAsDoc(file);
    setForm((f) => ({ ...f, [key]: doc }));
  };

  const search = async () => {
    setSearching(true);
    try {
      setResults(await CrmImportService.search(term));
    } finally {
      setSearching(false);
    }
  };

  /** Copy a CRM client into the form. Preferring pan_name is the whole point:
   *  BSE's KYC compares the holder name to the PAN-registered one. */
  const importClient = (c: CrmClientLookup) => {
    const source = (c.panName?.trim() || c.fullName).trim();
    const [first, ...rest] = source.split(/\s+/);
    setForm({
      // Nomination and documents have no CRM equivalent — they stay at their
      // empty defaults so an import can never silently opt a client out.
      ...EMPTY,
      clientCode: c.clientCode,
      pan: c.pan,
      firstName: first ?? source,
      middleName: rest.length > 1 ? rest.slice(0, -1).join(' ') : '',
      lastName: rest.length ? rest[rest.length - 1] : '',
      dob: c.dob,
      gender: (c.gender as Form['gender']) || 'M',
      email: c.email,
      mobile: c.phone.replace(/\D/g, '').slice(-10),
      line1: c.address || c.city,
      city: c.city,
      state: c.state,
      pincode: c.pincode,
      accountNumber: c.bankAccount,
      ifsc: c.bankIfsc,
      accountType: 'SB',
    });
    setImportedFrom(`${c.fullName} (${c.clientCode})`);
    setImportedId(c.id);
    setPanCheck(c.panVerified && c.panName ? { state: 'ok', name: c.panName } : null);
    setResults(null);
    setTerm('');
    setTouched(false);
  };

  const checkPan = async () => {
    setPanBusy(true);
    setPanCheck(null);
    try {
      const r = await BseOpsExtra.verifyPan(form.pan.trim().toUpperCase());
      if (r.valid && r.registered_name) {
        // Adopt the registered name verbatim — a near-miss still fails BSE KYC.
        const [first, ...rest] = r.registered_name.trim().split(/\s+/);
        setForm((f) => ({
          ...f,
          firstName: first ?? f.firstName,
          middleName: rest.length > 1 ? rest.slice(0, -1).join(' ') : '',
          lastName: rest.length ? rest[rest.length - 1] : '',
        }));
        setPanCheck({ state: 'ok', name: r.registered_name });
      } else {
        setPanCheck({ state: 'bad', msg: r.message ?? 'PAN could not be verified.' });
      }
    } catch (e) {
      setPanCheck({ state: 'bad', msg: e instanceof Error ? e.message : 'Verification failed.' });
    } finally {
      setPanBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await BseOpsService.registerUcc({
        clientCode: form.clientCode.trim(),
        pan: form.pan.trim().toUpperCase(),
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim(),
        lastName: form.lastName.trim(),
        dob: form.dob,
        gender: form.gender,
        email: form.email.trim(),
        mobile: form.mobile.replace(/\D/g, '').slice(-10),
        address: {
          line1: form.line1.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          pincode: form.pincode.trim(),
        },
        bank: {
          accountNumber: form.accountNumber.trim(),
          ifsc: form.ifsc.trim().toUpperCase(),
          accountType: form.accountType,
        },
        fatca: {
          fatherName: form.fatherName.trim() || undefined,
          spouseName: form.spouseName.trim() || undefined,
        },
        // Absent means declined — the proxy reads that as a recorded opt-out.
        nominees:
          form.nominationChoice === 'nominate'
            ? form.nominees.map((n) => ({
                firstName: n.firstName.trim(),
                middleName: n.middleName.trim() || undefined,
                lastName: n.lastName.trim() || undefined,
                dob: n.dob || undefined,
                relation: n.relation,
                percent: Number(n.percent),
                identifierType: n.identifierType,
                identifierNumber:
                  n.identifierType === 'pan'
                    ? n.identifierNumber.trim().toUpperCase()
                    : n.identifierNumber.trim(),
                isMinor: n.isMinor || undefined,
                guardian: n.isMinor
                  ? {
                      firstName: n.guardianFirstName.trim(),
                      lastName: n.guardianLastName.trim() || undefined,
                      dob: n.guardianDob,
                      pan: n.guardianPan.trim().toUpperCase(),
                    }
                  : undefined,
              }))
            : [],
        documents: {
          // BSE wants an identifier number alongside each blob: the account
          // number identifies a cheque, the client code an AOF.
          bankProof: form.bankProof
            ? { docNumber: form.accountNumber.trim(), ...form.bankProof }
            : undefined,
          bankProofType: form.bankProofType,
          aof: form.aof ? { docNumber: form.clientCode.trim(), ...form.aof } : undefined,
        },
      });
      // Nothing progresses at BSE until the investor approves, so fetch the
      // link immediately rather than making staff hunt for it.
      let url: string | undefined;
      try {
        const links = await BseOpsService.uccTwoFaLink(res.clientCode);
        url = links.links?.[0]?.url;
      } catch {
        /* best effort — registration itself succeeded */
      }
      // Store the UCC on the CRM client so they can transact in the portal.
      // Without this the proxy cannot resolve their UCC and will refuse them.
      let linked: boolean | null = null;
      if (importedId) linked = await CrmImportService.linkUcc(importedId, res.clientCode, res.status);
      setDone({ clientCode: res.clientCode, status: res.status, url, linked });
      setForm(EMPTY);
      setTouched(false);
      setConfirming(false);
      uccs.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (!isBseConfigured()) return <NotConfigured title="Client Management" />;

  const err = (k: keyof Form) => (touched ? errors[k] : undefined);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {done && (
        <SuccessCard title="Client registered at BSE">
          <p className="mt-1 text-sm text-text-secondary">
            UCC <span className="font-mono font-semibold">{done.clientCode}</span> created — status{' '}
            {done.status}.
          </p>
          {done.linked === false && (
            <p className="mt-2 text-xs text-warning">
              Registered at BSE, but the UCC could not be saved against the client record — they
              won&rsquo;t be able to invest from the portal until it is. Re-run the import or set it
              manually.
            </p>
          )}
          {done.linked === true && (
            <p className="mt-2 text-xs text-text-secondary">
              Linked to their client record — they can invest from the portal once BSE marks the
              UCC active.
            </p>
          )}
          {done.url ? (
            <p className="mt-2 text-xs text-text-secondary">
              Send the investor this approval link — verification only starts once they complete it:{' '}
              <a
                href={done.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
              >
                Open 2FA link <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          ) : (
            <p className="mt-2 text-xs text-text-secondary">
              Generate the investor’s 2FA link from the KYC screen to continue onboarding.
            </p>
          )}
        </SuccessCard>
      )}

      <Card>
        <div className="flex items-start justify-between gap-3">
          <SectionHeader title="Register a client at BSE" icon={UserPlus} />
          <StatusPill tone="muted">
            <Users className="mr-1 inline h-3 w-3 align-[-2px]" />
            {uccs.data?.length ?? 0} registered
          </StatusPill>
        </div>

        {error && <ErrorNote title="The client was not registered." message={error} />}

        {/* Optional import. The console works fine without it — this only saves
            typing, and using the PAN-registered name avoids the mismatch that
            leaves a UCC stuck in KYC. */}
        <div className="mb-4 rounded-token-md border border-border bg-bg-base p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
              placeholder="Prefill from an existing client — name, code or PAN"
              className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-faint"
            />
            <button
              type="button"
              onClick={() => void search()}
              disabled={searching || term.trim().length < 2}
              className="shrink-0 rounded-token-md border border-border bg-bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-primary hover:text-accent disabled:opacity-50"
            >
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>

          {results && results.length === 0 && (
            <p className="mt-2 text-[11px] text-text-faint">
              No match — enter the details manually below.
            </p>
          )}

          {results && results.length > 0 && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => importClient(c)}
                    className="flex w-full items-center gap-2 rounded-token-md px-2 py-1.5 text-left hover:bg-bg-surface"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-text-primary">
                        {c.fullName || c.clientCode}
                        {c.panVerified && (
                          <BadgeCheck className="ml-1 inline h-3 w-3 align-[-2px] text-success" />
                        )}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-text-faint">
                        {c.clientCode} · {c.pan || 'no PAN'}
                      </span>
                    </span>
                    {c.missing.length > 0 && (
                      <span
                        className="shrink-0 text-[10px] text-warning"
                        title={`Missing: ${c.missing.join(', ')}`}
                      >
                        {c.missing.length} missing
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {importedFrom && (
            <p className="mt-2 text-[11px] text-success">
              Prefilled from {importedFrom}. Review everything below — BSE is the record that
              counts.
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client code (UCC)">
              <input
                value={form.clientCode}
                onChange={(e) => set('clientCode')(e.target.value)}
                placeholder="NW0000012"
                className={inputCls}
              />
              {err('clientCode') && <p className="mt-1 text-[11px] text-danger">{err('clientCode')}</p>}
              {!err('clientCode') && codeTaken && (
                <p className="mt-1 text-[11px] text-danger">Already registered at BSE.</p>
              )}
            </Field>
            <Field label="PAN">
              <input
                value={form.pan}
                onChange={(e) => set('pan')(e.target.value.toUpperCase())}
                placeholder="ABCPE1234F"
                className={`${inputCls} font-mono`}
              />
              {err('pan') && <p className="mt-1 text-[11px] text-danger">{err('pan')}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void checkPan()}
                  disabled={panBusy || !PAN_RE.test(form.pan.trim().toUpperCase())}
                  className="rounded-token-md border border-border bg-bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-primary hover:text-accent disabled:opacity-50"
                >
                  {panBusy ? 'Verifying…' : 'Verify PAN'}
                </button>
                {panCheck?.state === 'ok' && (
                  <span className="text-[11px] text-success">
                    <BadgeCheck className="mr-0.5 inline h-3 w-3 align-[-2px]" />
                    {panCheck.name}
                  </span>
                )}
                {panCheck?.state === 'bad' && (
                  <span className="text-[11px] text-danger">{panCheck.msg}</span>
                )}
              </div>
              <p className="mt-1 text-[10px] text-text-faint">
                Verifying fills the name exactly as registered against the PAN — which is what
                BSE&rsquo;s KYC check compares.
              </p>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="First name">
              <input value={form.firstName} onChange={(e) => set('firstName')(e.target.value)} className={inputCls} />
              {err('firstName') && <p className="mt-1 text-[11px] text-danger">{err('firstName')}</p>}
            </Field>
            <Field label="Middle name">
              <input value={form.middleName} onChange={(e) => set('middleName')(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Last name">
              <input value={form.lastName} onChange={(e) => set('lastName')(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date of birth">
              <input type="date" value={form.dob} onChange={(e) => set('dob')(e.target.value)} className={inputCls} />
              {err('dob') && <p className="mt-1 text-[11px] text-danger">{err('dob')}</p>}
            </Field>
            <Field label="Gender">
              <select value={form.gender} onChange={(e) => set('gender')(e.target.value)} className={selectCls}>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="O">Other</option>
              </select>
            </Field>
            <Field label="Mobile">
              <input value={form.mobile} onChange={(e) => set('mobile')(e.target.value)} placeholder="9876543210" className={inputCls} />
              {err('mobile') && <p className="mt-1 text-[11px] text-danger">{err('mobile')}</p>}
            </Field>
          </div>

          <Field label="Email">
            <input value={form.email} onChange={(e) => set('email')(e.target.value)} className={inputCls} />
            {err('email') && <p className="mt-1 text-[11px] text-danger">{err('email')}</p>}
          </Field>

          {/* Both are conditional at BSE and can hold up FATCA if the RTA asks
              for them, so capture them rather than sending blanks. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Father's name (optional)">
              <input value={form.fatherName} onChange={(e) => set('fatherName')(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Spouse's name (optional)">
              <input value={form.spouseName} onChange={(e) => set('spouseName')(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <Field label="Address">
            <input value={form.line1} onChange={(e) => set('line1')(e.target.value)} placeholder="Flat / street" className={inputCls} />
            {err('line1') && <p className="mt-1 text-[11px] text-danger">{err('line1')}</p>}
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City">
              <input value={form.city} onChange={(e) => set('city')(e.target.value)} className={inputCls} />
              {err('city') && <p className="mt-1 text-[11px] text-danger">{err('city')}</p>}
            </Field>
            <Field label="State">
              <input value={form.state} onChange={(e) => set('state')(e.target.value)} className={inputCls} />
              {err('state') && <p className="mt-1 text-[11px] text-danger">{err('state')}</p>}
            </Field>
            <Field label="Pincode">
              <input value={form.pincode} onChange={(e) => set('pincode')(e.target.value)} className={inputCls} />
              {err('pincode') && <p className="mt-1 text-[11px] text-danger">{err('pincode')}</p>}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Bank account">
              <input value={form.accountNumber} onChange={(e) => set('accountNumber')(e.target.value)} className={inputCls} />
              {err('accountNumber') && <p className="mt-1 text-[11px] text-danger">{err('accountNumber')}</p>}
            </Field>
            <Field label="IFSC">
              <input value={form.ifsc} onChange={(e) => set('ifsc')(e.target.value.toUpperCase())} placeholder="HDFC0000123" className={`${inputCls} font-mono`} />
              {err('ifsc') && <p className="mt-1 text-[11px] text-danger">{err('ifsc')}</p>}
            </Field>
            <Field label="Account type">
              <select value={form.accountType} onChange={(e) => set('accountType')(e.target.value)} className={selectCls}>
                <option value="SB">Savings</option>
                <option value="CB">Current</option>
                <option value="NE">NRE</option>
                <option value="NO">NRO</option>
              </select>
            </Field>
          </div>

          {/* Supporting documents. Bank verification cannot pass without proof
              of the account, which is why it reads "Verification failed" on
              every UCC registered before this existed. */}
          <div className="rounded-token-md border border-border bg-bg-base p-3">
            <p className="text-xs font-semibold text-text-primary">Supporting documents</p>
            <p className="mt-0.5 text-[11px] text-text-faint">
              PDF, JPG or PNG, up to 3 MB each.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-xs font-semibold text-text-primary">Bank proof</span>
                  <select
                    value={form.bankProofType}
                    onChange={(e) => set('bankProofType')(e.target.value)}
                    className="rounded-token-md border border-border bg-bg-surface px-1.5 py-0.5 text-[10px] text-text-secondary outline-none"
                  >
                    <option value="cancel_cheque">Cancelled cheque</option>
                    <option value="bank_statement">Bank statement</option>
                  </select>
                </div>
                <input
                  type="file"
                  accept={DOC_ACCEPT}
                  onChange={(e) => void pickDoc('bankProof')(e.target.files?.[0])}
                  className="block w-full text-[11px] text-text-secondary file:mr-2 file:rounded-token-md file:border file:border-border file:bg-bg-surface file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-text-primary"
                />
                <p className="mt-1 text-[11px] text-text-faint">
                  {form.bankProof ? (
                    <span className="text-success">
                      <Paperclip className="mr-1 inline h-3 w-3 align-[-2px]" />
                      {form.bankProof.fileName}
                    </span>
                  ) : (
                    'Without this, BSE cannot verify the bank account.'
                  )}
                </p>
              </div>

              <div>
                <span className="mb-1.5 block text-xs font-semibold text-text-primary">
                  Account opening form
                </span>
                <input
                  type="file"
                  accept={DOC_ACCEPT}
                  onChange={(e) => void pickDoc('aof')(e.target.files?.[0])}
                  className="block w-full text-[11px] text-text-secondary file:mr-2 file:rounded-token-md file:border file:border-border file:bg-bg-surface file:px-2 file:py-1 file:text-[11px] file:font-semibold file:text-text-primary"
                />
                <p className="mt-1 text-[11px] text-text-faint">
                  {form.aof ? (
                    <span className="text-success">
                      <Paperclip className="mr-1 inline h-3 w-3 align-[-2px]" />
                      {form.aof.fileName}
                    </span>
                  ) : (
                    'Signed AOF, checked by the RTA for physical UCCs.'
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Nomination. Not optional as a decision — SEBI requires either a
              nomination or a recorded opt-out, so neither is the default. */}
          <div className="rounded-token-md border border-border bg-bg-base p-3">
            <p className="text-xs font-semibold text-text-primary">Nomination</p>
            <p className="mt-0.5 text-[11px] text-text-faint">
              The client must either nominate or decline. Up to 3 nominees, shares totalling 100%.
            </p>

            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    nominationChoice: 'nominate',
                    nominees: f.nominees.length ? f.nominees : [{ ...EMPTY_NOMINEE }],
                  }))
                }
                className={`rounded-token-md border px-2.5 py-1 text-[11px] font-semibold ${
                  form.nominationChoice === 'nominate'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-bg-surface text-text-secondary hover:text-text-primary'
                }`}
              >
                Add nominees
              </button>
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({ ...f, nominationChoice: 'decline', nominees: [] }))
                }
                className={`rounded-token-md border px-2.5 py-1 text-[11px] font-semibold ${
                  form.nominationChoice === 'decline'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-bg-surface text-text-secondary hover:text-text-primary'
                }`}
              >
                Client declines to nominate
              </button>
            </div>

            {form.nominationChoice === 'decline' && (
              <p className="mt-2 text-[11px] text-warning">
                Recorded as an opt-out. The client can add a nominee later through BSE.
              </p>
            )}

            {form.nominationChoice === 'nominate' && (
              <div className="mt-3 space-y-3">
                {form.nominees.map((n, i) => (
                  <div key={i} className="rounded-token-md border border-border bg-bg-surface p-2.5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-text-secondary">
                        Nominee {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeNominee(i)}
                        className="text-text-faint hover:text-danger"
                        aria-label={`Remove nominee ${i + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3">
                      <input
                        value={n.firstName}
                        onChange={(e) => setNominee(i, { firstName: e.target.value })}
                        placeholder="First name"
                        className={inputCls}
                      />
                      <input
                        value={n.middleName}
                        onChange={(e) => setNominee(i, { middleName: e.target.value })}
                        placeholder="Middle name"
                        className={inputCls}
                      />
                      <input
                        value={n.lastName}
                        onChange={(e) => setNominee(i, { lastName: e.target.value })}
                        placeholder="Last name"
                        className={inputCls}
                      />
                    </div>

                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <select
                        value={n.relation}
                        onChange={(e) => setNominee(i, { relation: e.target.value })}
                        className={selectCls}
                      >
                        {NOMINEE_RELATIONS.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={n.dob}
                        onChange={(e) => setNominee(i, { dob: e.target.value })}
                        className={inputCls}
                      />
                      <div className="flex items-center gap-1">
                        <input
                          value={n.percent}
                          onChange={(e) => setNominee(i, { percent: e.target.value })}
                          inputMode="numeric"
                          className={inputCls}
                        />
                        <span className="text-xs text-text-faint">%</span>
                      </div>
                    </div>

                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <select
                        value={n.identifierType}
                        onChange={(e) =>
                          setNominee(i, {
                            identifierType: e.target.value as NomineeDraft['identifierType'],
                            identifierNumber: '',
                          })
                        }
                        className={selectCls}
                      >
                        <option value="pan">PAN</option>
                        <option value="aadhaar">Aadhaar (last 4)</option>
                        <option value="passport">Passport</option>
                      </select>
                      <input
                        value={n.identifierNumber}
                        onChange={(e) =>
                          setNominee(i, {
                            identifierNumber:
                              n.identifierType === 'pan'
                                ? e.target.value.toUpperCase()
                                : e.target.value,
                          })
                        }
                        placeholder={n.identifierType === 'aadhaar' ? '1234' : 'ABCDE1234F'}
                        className={`${inputCls} font-mono sm:col-span-2`}
                      />
                    </div>

                    <label className="mt-2 flex items-center gap-2 text-[11px] text-text-secondary">
                      <input
                        type="checkbox"
                        checked={n.isMinor}
                        onChange={(e) => setNominee(i, { isMinor: e.target.checked })}
                      />
                      Nominee is a minor — a guardian is required
                    </label>

                    {n.isMinor && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-4">
                        <input
                          value={n.guardianFirstName}
                          onChange={(e) => setNominee(i, { guardianFirstName: e.target.value })}
                          placeholder="Guardian first name"
                          className={inputCls}
                        />
                        <input
                          value={n.guardianLastName}
                          onChange={(e) => setNominee(i, { guardianLastName: e.target.value })}
                          placeholder="Guardian last name"
                          className={inputCls}
                        />
                        <input
                          type="date"
                          value={n.guardianDob}
                          onChange={(e) => setNominee(i, { guardianDob: e.target.value })}
                          className={inputCls}
                        />
                        <input
                          value={n.guardianPan}
                          onChange={(e) =>
                            setNominee(i, { guardianPan: e.target.value.toUpperCase() })
                          }
                          placeholder="Guardian PAN"
                          className={`${inputCls} font-mono`}
                        />
                      </div>
                    )}

                    {touched && issues[i] && (
                      <p className="mt-1.5 text-[11px] text-danger">{issues[i]}</p>
                    )}
                  </div>
                ))}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  {form.nominees.length < 3 ? (
                    <button
                      type="button"
                      onClick={addNominee}
                      className="inline-flex items-center gap-1 rounded-token-md border border-border bg-bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-primary hover:text-accent"
                    >
                      <Plus className="h-3 w-3" /> Add another
                    </button>
                  ) : (
                    <span className="text-[11px] text-text-faint">BSE allows at most 3.</span>
                  )}
                  <span
                    className={`text-[11px] font-semibold ${
                      shareTotal === 100 ? 'text-success' : 'text-warning'
                    }`}
                  >
                    Total {shareTotal}%
                  </span>
                </div>
              </div>
            )}

            {err('nominees') && <p className="mt-2 text-[11px] text-danger">{err('nominees')}</p>}
          </div>

          {!confirming ? (
            <button
              type="button"
              onClick={() => {
                setTouched(true);
                setError(null);
                setDone(null);
                if (valid && !codeTaken) setConfirming(true);
              }}
              disabled={touched && (!valid || codeTaken)}
              className="w-full rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              Review Registration
            </button>
          ) : (
            <ConfirmBox
              rows={[
                { label: 'Client code', value: form.clientCode },
                { label: 'Name', value: [form.firstName, form.middleName, form.lastName].filter(Boolean).join(' ') },
                { label: 'PAN', value: form.pan },
                { label: 'Date of birth', value: form.dob },
                { label: 'Contact', value: `${form.email} · ${form.mobile}` },
                { label: 'Bank', value: `${form.ifsc} · ${form.accountNumber} (${form.accountType})` },
                { label: 'Address', value: `${form.city}, ${form.state} ${form.pincode}` },
                {
                  label: 'Nomination',
                  value:
                    form.nominationChoice === 'decline'
                      ? 'Declined'
                      : form.nominees
                          .map(
                            (n) =>
                              `${[n.firstName, n.lastName].filter(Boolean).join(' ')} ${n.percent}%`,
                          )
                          .join(', '),
                },
                {
                  label: 'Documents',
                  value:
                    [form.bankProof && 'Bank proof', form.aof && 'AOF']
                      .filter(Boolean)
                      .join(', ') || 'None attached',
                },
              ]}
              note="Registers a physical, resident-individual UCC at BSE StAR MF. The investor must then approve a 2FA link before KYC and PAN verification begin."
              busy={busy}
              submitLabel="Register at BSE"
              onBack={() => setConfirming(false)}
              onConfirm={submit}
            />
          )}
        </div>
      </Card>
    </div>
  );
}
