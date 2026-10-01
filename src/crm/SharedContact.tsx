import { AlertCircle, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';

// ---------------------------------------------------------------------------
// Shared mobile / email between related clients.
//
// A husband and wife often use one mobile number and one email. Two clients may
// share either ONLY when both belong to the same employee; the RM is then asked
// how the new client is related to the existing one (nw_client_relationships).
// The same contact under ANOTHER employee stays blocked.
//
// One implementation for Client Onboarding and Manage Clients → Edit, so the
// rule cannot drift between the two screens.
// ---------------------------------------------------------------------------

export interface ContactMatch {
  /** Null when the match belongs to another employee and the caller is not an admin. */
  client_id: string | null;
  full_name: string | null;
  client_code: string | null;
  matched_on: 'phone' | 'email' | 'both';
  same_employee: boolean;
  /** Already-recorded relationship with the client being edited, if any. */
  existing_relationship: string | null;
}

export const RELATIONSHIP_OPTIONS = [
  'Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister',
  'Other family member', 'Other',
];

const MATCH_LABEL: Record<ContactMatch['matched_on'], string> = {
  phone: 'mobile number', email: 'email', both: 'mobile number and email',
};

/**
 * Clients already using this mobile / email. Goes through an RPC because an
 * employee's RLS hides other employees' clients, and those are exactly the
 * ones that must block.
 */
export async function findContactMatches(
  phone: string, email: string, employeeId: string | null, excludeClientId?: string,
): Promise<ContactMatch[]> {
  const p = /^\d{10}$/.test(phone) ? phone : '';
  const e = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? email.trim().toLowerCase() : '';
  if (!p && !e) return [];
  const { data, error } = await supabase.rpc('nw_client_contact_matches', {
    p_phone: p, p_email: e,
    p_employee_id: employeeId as string,
    p_exclude_client_id: excludeClientId,
  });
  if (error) throw error;
  return (data ?? []) as ContactMatch[];
}

/** Matches the RM must still give a relationship for. */
export function relationshipsNeeded(matches: ContactMatch[]): ContactMatch[] {
  return matches.filter(m => m.same_employee && m.client_id && !m.existing_relationship);
}

/** Why saving must stop, or null when the shared contact is acceptable. */
export function sharedContactError(matches: ContactMatch[], chosen: Record<string, string>): string | null {
  const blocked = matches.find(m => !m.same_employee);
  if (blocked) {
    return `This ${MATCH_LABEL[blocked.matched_on]} is already used by a client of another employee. `
      + 'A mobile number or email can be shared only between clients of the same employee.';
  }
  const missing = relationshipsNeeded(matches).find(m => !chosen[m.client_id!]);
  if (missing) return `Select how this client is related to ${missing.full_name}.`;
  return null;
}

export async function saveRelationships(
  clientId: string, matches: ContactMatch[], chosen: Record<string, string>, createdBy: string,
) {
  const rows = relationshipsNeeded(matches)
    .filter(m => chosen[m.client_id!])
    .map(m => ({
      client_id: clientId,
      related_client_id: m.client_id!,
      relationship: chosen[m.client_id!],
      shared_contact: m.matched_on,
      created_by: createdBy,
    }));
  if (rows.length === 0) return { error: null };
  return supabase.from('nw_client_relationships')
    .upsert(rows, { onConflict: 'client_id,related_client_id' });
}

export function SharedContactPanel({ matches, chosen, onChoose }: {
  matches: ContactMatch[];
  chosen: Record<string, string>;
  onChoose: (clientId: string, relationship: string) => void;
}) {
  if (matches.length === 0) return null;
  const blocked = matches.filter(m => !m.same_employee);
  const shared = matches.filter(m => m.same_employee && m.client_id);

  return (
    <div className="space-y-2">
      {blocked.map((m, i) => (
        <div key={`b${i}`} className="flex items-start gap-2 px-3 py-2 rounded-lg"
          style={{ background: 'rgba(var(--danger-rgb),0.08)', border: '1px solid rgba(var(--danger-rgb),0.3)' }}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
          <p className="text-xs" style={{ color: 'var(--danger)' }}>
            This {MATCH_LABEL[m.matched_on]} is already used by
            {m.full_name ? ` ${m.full_name} (${m.client_code}), a client of another employee` : ' a client of another employee'}.
            A mobile number or email can be shared only between clients of the same employee.
          </p>
        </div>
      ))}
      {shared.map(m => (
        <div key={m.client_id} className="px-3 py-2.5 rounded-lg"
          style={{ background: 'rgba(var(--accent-rgb),0.06)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
          <div className="flex items-start gap-2">
            <Users className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Same {MATCH_LABEL[m.matched_on]} as existing client{' '}
              <strong className="text-text-primary">{m.full_name}</strong> ({m.client_code}).
              {m.existing_relationship && <> Relationship on record: <strong className="text-text-primary">{m.existing_relationship}</strong>.</>}
            </p>
          </div>
          {!m.existing_relationship && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                This client is the <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <select
                value={chosen[m.client_id!] || ''}
                onChange={e => onChoose(m.client_id!, e.target.value)}
                className="rounded-lg border px-2.5 py-1.5 text-xs outline-none"
                style={{ background: 'var(--bg-base)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
              >
                <option value="">Select relationship…</option>
                {RELATIONSHIP_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>of {m.full_name}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
