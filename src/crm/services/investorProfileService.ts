/**
 * Investor profile, entered by an employee on a client's behalf.
 *
 * The client's own path is the public-onboard-save-profile edge function. An
 * employee onboarding a client records the same declaration here, under their
 * own CRM access (the row policies already limit them to their clients), and
 * it is validated by the very same shared rules — so a profile is acceptable
 * or not regardless of who typed it. What differs is the record of who did:
 * `investor_profile_source = 'staff'` and `investor_profile_by`.
 */
import { supabase } from '../../lib/supabase';
import {
  BANK_ACCOUNT_TYPES, validateInvestorProfile, validateMandatePreference, validateNomination,
  type InvestorProfileInput, type MandatePreferenceInput, type NominationInput,
} from '../../../supabase/functions/_shared/profile/investorProfile';
import type { NomineeRecord } from '../../portal/features/onboarding/InvestorProfileStep';

const NOMINEE_COLUMNS =
  'full_name, relationship, dob, share_percent, id_type, id_number, guardian_name, guardian_dob, guardian_pan, guardian_relationship';

export const InvestorProfileStaffService = {
  async loadNominees(clientId: string): Promise<NomineeRecord[]> {
    const { data } = await supabase.from('nw_client_nominees').select(NOMINEE_COLUMNS).eq('client_id', clientId).order('created_at');
    return (data as NomineeRecord[] | null) ?? [];
  },

  async save(
    clientId: string,
    employeeId: string,
    profileInput: InvestorProfileInput,
    nominationInput: NominationInput,
    mandateInput: MandatePreferenceInput,
    extras?: { bank_account_type?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const accountType = extras?.bank_account_type;
    if (accountType !== undefined && !BANK_ACCOUNT_TYPES.some((o) => o.value === accountType)) {
      return { ok: false, error: 'Select the client’s bank account type.' };
    }
    const profile = validateInvestorProfile(profileInput);
    if (!profile.ok) return { ok: false, error: profile.error };
    const nomination = validateNomination(nominationInput);
    if (!nomination.ok) return { ok: false, error: nomination.error };
    const mandate = validateMandatePreference(mandateInput);
    if (!mandate.ok) return { ok: false, error: mandate.error };

    try {
      // Nominees are a full replacement; if the insert fails, put the previous
      // rows back rather than leave the client with none.
      const { data: before } = await supabase.from('nw_client_nominees').select('*').eq('client_id', clientId);
      const { error: delErr } = await supabase.from('nw_client_nominees').delete().eq('client_id', clientId);
      if (delErr) throw delErr;
      if (nomination.value.nominees.length > 0) {
        const { error: insErr } = await supabase.from('nw_client_nominees').insert(
          nomination.value.nominees.map((n) => ({
            client_id: clientId,
            full_name: n.full_name,
            relationship: n.relationship,
            dob: n.dob ?? null,
            share_percent: n.share_percent,
            guardian_name: n.guardian_name ?? null,
            guardian_dob: n.guardian_dob ?? null,
            guardian_pan: n.guardian_pan ?? null,
            guardian_relationship: n.guardian_relationship ?? null,
            id_type: n.id_type ?? null,
            id_number: n.id_number ?? null,
            added_via: 'crm',
          })),
        );
        if (insErr) {
          if (before?.length) await supabase.from('nw_client_nominees').insert(before);
          throw insErr;
        }
      }

      const { error: updErr } = await supabase.from('nw_clients').update({
        ...profile.value,
        ...(accountType ? { bank_account_type: accountType } : {}),
        nomination_choice: nomination.value.choice,
        mandate_preference: mandate.value.preference,
        mandate_max_amount: mandate.value.max_amount,
        mandate_upi_id: mandate.value.upi_id,
        investor_profile_completed_at: new Date().toISOString(),
        investor_profile_source: 'staff',
        investor_profile_by: employeeId,
      }).eq('id', clientId);
      if (updErr) throw updErr;

      await supabase.from('nw_activity_logs').insert([{
        employee_id: employeeId,
        client_id: clientId,
        action: 'Investor Profile Recorded',
        description: 'Investor profile for mutual funds recorded by staff on the client’s behalf — '
          + (nomination.value.choice === 'opt_out' ? 'no nominee (opted out)' : `${nomination.value.nominees.length} nominee(s)`)
          + `; auto-debit: ${mandate.value.preference}.`,
      }]).then(() => {}, () => {});
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Could not save the profile. Please try again.' };
    }
  },
};
