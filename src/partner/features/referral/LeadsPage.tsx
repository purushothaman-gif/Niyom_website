import { ClipboardList } from 'lucide-react';
import { Card } from '../../../portal/components/Card';
import { StatusPill } from '../../../portal/components/StatusPill';
import { EmptyState } from '../../../portal/components/EmptyState';
import type { PartnerLead } from '../../types';

interface Props {
  leads: PartnerLead[];
}

/**
 * Leads this partner submitted or referred.
 *
 * The status shown is a four-state simplification produced by nw_partner_leads().
 * The CRM's own vocabulary has 18 values including 'Not Interested' and
 * 'Wrong Number', which are internal workflow states and not something to show
 * verbatim to the partner who made the introduction.
 */
const TONE: Record<PartnerLead['status'], 'info' | 'warning' | 'success' | 'muted'> = {
  Submitted: 'info',
  'In Progress': 'warning',
  Converted: 'success',
  Closed: 'muted',
};

export function LeadsPage({ leads }: Props) {
  if (leads.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={ClipboardList}
          title="No leads yet"
          hint="Leads you submit, or prospects who sign up through your referral link, will appear here."
        />
      </Card>
    );
  }

  const converted = leads.filter((l) => l.status === 'Converted').length;
  const inProgress = leads.filter((l) => l.status === 'In Progress' || l.status === 'Submitted').length;

  return (
    <div className="space-y-4">
      <Card padding="md">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
          <span className="text-text-muted">
            <span className="font-semibold text-text-primary">{leads.length}</span> total
          </span>
          <span className="text-text-muted">
            <span className="font-semibold text-text-primary">{inProgress}</span> being worked
          </span>
          <span className="text-text-muted">
            <span className="font-semibold text-success">{converted}</span> converted
          </span>
        </div>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-[11px] uppercase tracking-wider text-text-faint">
                <th className="px-5 py-3 text-left font-semibold">Name</th>
                <th className="px-5 py-3 text-left font-semibold">Mobile</th>
                <th className="px-5 py-3 text-left font-semibold">City</th>
                <th className="px-5 py-3 text-left font-semibold">Submitted</th>
                <th className="px-5 py-3 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {leads.map((l) => (
                <tr key={l.lead_id} className="transition-colors hover:bg-hover">
                  <td className="px-5 py-3 font-medium text-text-primary">{l.lead_name}</td>
                  <td className="px-5 py-3 font-mono text-xs text-text-secondary">{l.mobile}</td>
                  <td className="px-5 py-3 text-text-secondary">{l.city || '—'}</td>
                  <td className="px-5 py-3 text-text-secondary">
                    {new Date(l.created_at).toLocaleDateString('en-IN', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusPill tone={TONE[l.status]}>{l.status}</StatusPill>
                      {l.converted_client_code && (
                        <span className="font-mono text-[11px] text-text-faint">
                          {l.converted_client_code}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
