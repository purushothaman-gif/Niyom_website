/**
 * CRM: record or correct a client's investor profile on their behalf.
 *
 * The same form the client sees in the portal's KYC wizard, so an employee
 * onboarding a client captures exactly what a self-onboarded client would —
 * the declaration, the nomination and the auto-debit preference — and it is
 * saved as entered by staff.
 */
import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { NWClient } from './types';
import { InvestorProfileStep } from '../portal/features/onboarding/InvestorProfileStep';
import { InvestorProfileStaffService } from './services/investorProfileService';

interface Props {
  clientId: string;
  clientName: string;
  employeeId: string;
  /** Called after a successful save. */
  onSaved: () => void;
  onClose: () => void;
  /** Label for the dismiss action when the profile is offered right after onboarding. */
  closeLabel?: string;
}

export function InvestorProfileEditorModal({ clientId, clientName, employeeId, onSaved, onClose, closeLabel }: Props) {
  const [client, setClient] = useState<NWClient | null | undefined>(undefined);

  useEffect(() => {
    supabase.from('nw_clients').select('*').eq('id', clientId).maybeSingle()
      .then(({ data }) => setClient((data as unknown as NWClient | null) ?? null));
  }, [clientId]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Investor profile — {clientName}</h3>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Needed to open a mutual fund account for this client, on any platform.</p>
          </div>
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--text-faint)' }} aria-label="Close">
            {closeLabel} <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-5">
          {client === undefined ? (
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--text-faint)' }} />
          ) : client === null ? (
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Could not load this client.</p>
          ) : (
            <InvestorProfileStep
              staff
              client={client}
              clientId={clientId}
              loadNominees={() => InvestorProfileStaffService.loadNominees(clientId)}
              save={(profile, nomination, mandate, extras) => InvestorProfileStaffService.save(clientId, employeeId, profile, nomination, mandate, extras)}
              onSaved={onSaved}
            />
          )}
        </div>
      </div>
    </div>
  );
}
