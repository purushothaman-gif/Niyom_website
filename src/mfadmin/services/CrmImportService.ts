/**
 * CrmImportService — an optional source of typing, not a dependency.
 *
 * The MF Admin console stands alone: BSE owns the UCC, and no screen here reads
 * CRM data to display it. This module exists only so that registering a client
 * who already exists in the CRM doesn't mean re-typing their details, and it is
 * used at exactly one moment — prefilling the registration form. Nothing calls
 * it afterwards, and the console works normally if the CRM is empty or
 * unreachable.
 *
 * Accuracy is the real reason, not convenience: `pan_name` here is the name
 * Cashfree returned for the PAN, and BSE's KYC check compares the holder name
 * against exactly that. Hand-typing names is how a UCC ends up stuck.
 */
import { supabase } from '../../lib/supabase';
import { clientCodeOrClause } from '../../../shared/crm/clientCode';
import {
  BANK_ACC_TYPE_CODE, NOMINEE_ID_TYPE_CODE, NOMINEE_RELATION_CODE, toBseDeclaration, type BseDeclaration,
} from '../../../supabase/functions/_shared/profile/bseCodes';

/** A nominee from the client record, already in the shape BSE's form wants. */
export interface CrmNominee {
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  /** BSE nomination_relation code, or '' when the stored relationship has none. */
  relation: string;
  percent: string;
  /** '' when the stored document (a driving licence) has no confirmed BSE key. */
  identifierType: 'pan' | 'aadhaar' | 'passport' | '';
  identifierNumber: string;
  isMinor: boolean;
  guardianFirstName: string;
  guardianLastName: string;
  guardianDob: string;
  guardianPan: string;
}

/**
 * Everything beyond name, address and bank that the client record holds for a
 * BSE registration: the investor's own declaration (as BSE codes), the
 * nomination, and the bank proof they uploaded during KYC.
 */
export interface CrmClientDetails {
  /** Null when the client has not completed the investor profile. */
  declaration: BseDeclaration | null;
  /** BSE bank_acc_type code, when the client stated their account type. */
  accountType: string | null;
  fatherName: string;
  spouseName: string;
  nominationChoice: 'nominate' | 'opt_out' | null;
  nominees: CrmNominee[];
  bankProof: { fileName: string; fileSize: number; fileBlob: string } | null;
  /** Things staff must look at — never silently defaulted. */
  notes: string[];
}

const MAX_DOC_BYTES = 3 * 1024 * 1024;
const DOC_TYPES = /\.(pdf|jpe?g|png)$/i;

const splitName = (full: string): [string, string, string] => {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return [parts[0] ?? '', '', ''];
  return [parts[0], parts.slice(1, -1).join(' '), parts[parts.length - 1]];
};

const ageOf = (dob: string): number | null => {
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age;
};

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export interface CrmClientLookup {
  id: string;
  clientCode: string;
  fullName: string;
  /** Name as registered against the PAN — preferred over fullName for BSE. */
  panName: string | null;
  panVerified: boolean;
  pan: string;
  dob: string;
  gender: string | null;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  bankAccount: string;
  bankIfsc: string;
  /** Fields BSE requires that this client is missing. */
  missing: string[];
}

const REQUIRED: [keyof CrmClientLookup, string][] = [
  ['pan', 'PAN'],
  ['dob', 'date of birth'],
  ['gender', 'gender'],
  ['email', 'email'],
  ['phone', 'mobile'],
  ['city', 'city'],
  ['state', 'state'],
  ['pincode', 'pincode'],
  ['bankAccount', 'bank account'],
  ['bankIfsc', 'IFSC'],
];

function shape(r: Record<string, unknown>): CrmClientLookup {
  const c: CrmClientLookup = {
    id: String(r.id ?? ''),
    clientCode: String(r.client_code ?? ''),
    fullName: String(r.full_name ?? ''),
    panName: (r.pan_name as string) || null,
    panVerified: Boolean(r.pan_verified),
    pan: String(r.pan ?? '').toUpperCase(),
    dob: String(r.dob ?? ''),
    gender: (r.gender as string) || null,
    email: String(r.email ?? ''),
    phone: String(r.phone ?? ''),
    address: String(r.address ?? ''),
    city: String(r.city ?? ''),
    state: String(r.state ?? ''),
    pincode: String(r.pincode ?? ''),
    bankAccount: String(r.bank_account ?? ''),
    bankIfsc: String(r.bank_ifsc ?? '').toUpperCase(),
    missing: [],
  };
  c.missing = REQUIRED.filter(([k]) => !String(c[k] ?? '').trim()).map(([, label]) => label);
  return c;
}

const COLUMNS =
  'id, client_code, full_name, pan_name, pan_verified, pan, dob, gender, email, phone, address, city, state, pincode, bank_account, bank_ifsc';

const DETAIL_COLUMNS =
  'bank_account_type, father_name, spouse_name, nomination_choice, occupation, income_slab, wealth_source, pep_status, ' +
  'birth_place, birth_country, tax_resident_outside_india, foreign_tax_country, foreign_tax_id, mobile_belongs_to, ' +
  'email_belongs_to, investor_profile_completed_at';

export const CrmImportService = {
  /**
   * The investor profile, nomination and stored bank proof for a CRM client.
   * Best-effort like everything here: null means "nothing to add", and the
   * form simply stays as staff would have had it before.
   */
  async details(clientId: string): Promise<CrmClientDetails | null> {
    try {
      const [{ data: row }, { data: nomineeRows }, { data: docs }] = await Promise.all([
        supabase.from('nw_clients').select(DETAIL_COLUMNS).eq('id', clientId).maybeSingle(),
        supabase
          .from('nw_client_nominees')
          .select('full_name, relationship, dob, share_percent, id_type, id_number, guardian_name, guardian_dob, guardian_pan')
          .eq('client_id', clientId)
          .order('created_at'),
        supabase
          .from('nw_documents')
          .select('file_name, file_path, file_size')
          .eq('client_id', clientId)
          .eq('document_type', 'BANK')
          .order('created_at', { ascending: false })
          .limit(1),
      ]);
      if (!row) return null;
      const r = row as unknown as Record<string, unknown>;
      const notes: string[] = [];

      const declaration = toBseDeclaration(r);
      if (!declaration) {
        notes.push(
          'The client has not completed the investor profile (occupation, income, source of wealth, politically exposed status, birth and tax details). ' +
            'Ask them to finish it under Complete KYC in the portal — otherwise BSE receives standard defaults, not their own declaration.',
        );
      }

      const nominees: CrmNominee[] = ((nomineeRows as Record<string, unknown>[] | null) ?? []).slice(0, 3).map((n, i) => {
        const [firstName, middleName, lastName] = splitName(String(n.full_name ?? ''));
        const relation = NOMINEE_RELATION_CODE[String(n.relationship ?? '')] ?? '';
        if (!relation) notes.push(`Nominee ${i + 1}: the recorded relationship "${n.relationship}" has no BSE code — choose it below.`);
        const identifierType = NOMINEE_ID_TYPE_CODE[String(n.id_type ?? '')] ?? '';
        if (!identifierType) {
          notes.push(
            n.id_type === 'driving_licence'
              ? `Nominee ${i + 1}: the client gave a driving licence (${n.id_number}). Choose the ID type below and confirm BSE accepts it.`
              : `Nominee ${i + 1}: no identity document on record — add one below.`,
          );
        }
        const dob = String(n.dob ?? '');
        const age = dob ? ageOf(dob) : null;
        const [gFirst, , gLast] = splitName(String(n.guardian_name ?? ''));
        const [, gMiddle] = splitName(String(n.guardian_name ?? ''));
        return {
          firstName,
          middleName,
          lastName,
          dob,
          relation,
          percent: String(Math.round(Number(n.share_percent) || 0)),
          identifierType,
          identifierNumber: identifierType ? String(n.id_number ?? '') : '',
          isMinor: age !== null && age < 18,
          guardianFirstName: gFirst,
          guardianLastName: [gMiddle, gLast].filter(Boolean).join(' '),
          guardianDob: String(n.guardian_dob ?? ''),
          guardianPan: String(n.guardian_pan ?? ''),
        };
      });
      const total = nominees.reduce((s, n) => s + Number(n.percent || 0), 0);
      if (nominees.length && total !== 100) notes.push(`Nominee shares on record total ${total}%, not 100% — correct them below.`);

      // The bank proof the client uploaded during KYC, so staff need not find
      // and re-upload the same file. Skipped (with a note) if it is too large
      // or a type BSE does not take.
      let bankProof: CrmClientDetails['bankProof'] = null;
      const doc = (docs as { file_name: string; file_path: string; file_size: number | null }[] | null)?.[0];
      if (doc) {
        if (!DOC_TYPES.test(doc.file_name) || (doc.file_size ?? 0) > MAX_DOC_BYTES) {
          notes.push(`The stored bank proof (${doc.file_name}) is over 3 MB or not a PDF/JPG/PNG — attach a suitable copy below.`);
        } else {
          const { data: blob } = await supabase.storage.from('crm-documents').download(doc.file_path);
          if (blob && blob.size <= MAX_DOC_BYTES) {
            bankProof = { fileName: doc.file_name, fileSize: blob.size, fileBlob: await blobToBase64(blob) };
          } else {
            notes.push('The stored bank proof could not be loaded — attach it below.');
          }
        }
      }

      const choice = r.nomination_choice === 'nominate' || r.nomination_choice === 'opt_out' ? r.nomination_choice : null;
      return {
        declaration,
        accountType: BANK_ACC_TYPE_CODE[String(r.bank_account_type ?? '')] ?? null,
        fatherName: String(r.father_name ?? ''),
        spouseName: String(r.spouse_name ?? ''),
        nominationChoice: choice,
        nominees,
        bankProof,
        notes,
      };
    } catch {
      return null;
    }
  },

  /**
   * Record the UCC BSE assigned against the CRM client.
   *
   * This is what lets the proxy answer "which UCC does this caller own?" when
   * the client later signs into the portal — without it they cannot transact,
   * however complete their BSE registration is. Best-effort: registration at
   * BSE has already succeeded by this point and must not be reported as failed.
   */
  async linkUcc(clientId: string, ucc: string, status: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('nw_clients')
        .update({
          bse_ucc: ucc,
          bse_ucc_status: status,
          bse_ucc_synced_at: new Date().toISOString(),
        })
        .eq('id', clientId);
      return !error;
    } catch {
      return false;
    }
  },

  /**
   * Search CRM clients by name, code or PAN. Returns [] rather than throwing if
   * the CRM is unavailable — this is a convenience, and it must never be the
   * reason a client can't be registered at BSE.
   */
  async search(term: string): Promise<CrmClientLookup[]> {
    const q = term.trim();
    if (q.length < 2) return [];
    try {
      const { data, error } = await supabase
        .from('nw_clients')
        .select(COLUMNS)
        .or(`full_name.ilike.%${q}%,client_code.ilike.%${q}%,pan.ilike.%${q}%${clientCodeOrClause(q)}`)
        .limit(20);
      if (error) return [];
      return ((data as Record<string, unknown>[]) ?? []).map(shape);
    } catch {
      return [];
    }
  },
};
