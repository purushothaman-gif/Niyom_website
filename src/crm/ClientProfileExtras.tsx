/**
 * CRM: a client's nominees and the history of profile changes they made
 * themselves in the portal (contact details, nominees, bank accounts). Read
 * under the CRM's own RLS — the RM sees their clients, admins see all.
 */
import { useEffect, useState } from 'react';
import { History, Loader2, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Nominee {
  id: string;
  full_name: string;
  relationship: string;
  dob: string | null;
  share_percent: number;
  guardian_name: string | null;
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
  primary_bank: 'Primary bank changed',
};

const when = (d: string) =>
  new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ClientProfileExtrasModal({ clientId, clientName, onClose }: { clientId: string; clientName: string; onClose: () => void }) {
  const [nominees, setNominees] = useState<Nominee[] | null>(null);
  const [changes, setChanges] = useState<Change[] | null>(null);

  useEffect(() => {
    supabase
      .from('nw_client_nominees')
      .select('id, full_name, relationship, dob, share_percent, guardian_name, added_via')
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
  }, [clientId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-xl border"
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: 'var(--border)' }}>
          <h3 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
            Nominees & profile changes — {clientName}
          </h3>
          <button type="button" onClick={onClose} style={{ color: 'var(--text-faint)' }} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-5">
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
                      <td>{n.guardian_name ?? '—'}</td>
                      <td className="text-right font-semibold">{n.share_percent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              <History className="h-4 w-4" style={{ color: 'var(--accent)' }} /> Changes made by the client (portal, email-OTP verified)
            </h4>
            {changes === null ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : changes.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No self-service changes yet.</p>
            ) : (
              <ul className="space-y-2">
                {changes.map((c) => (
                  <li key={c.id} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{LABEL[c.field] ?? c.field}</span>
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{when(c.created_at)}</span>
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
