import { UserRound, Landmark, ShieldCheck, KeyRound, Info } from 'lucide-react';
import { Card } from '../../../portal/components/Card';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { StatusPill } from '../../../portal/components/StatusPill';
import type { PartnerIdentity } from '../../types';

interface Props {
  profile: PartnerIdentity | null;
  onChangePassword: () => void;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">{label}</p>
      <p className="mt-1 break-words text-sm text-text-primary">{value || '—'}</p>
    </div>
  );
}

/**
 * Read-only partner profile.
 *
 * Deliberately has NO edit path. bank_account / bank_ifsc are what payouts are
 * wired to, and self-service editing of payment instructions by the party
 * receiving the payment is a fraud vector — which is why partners have no UPDATE
 * policy on nw_dsa at all, backed by the nw_guard_dsa_self_update trigger.
 * Changes go through the RM.
 *
 * PAN and bank account arrive already masked from nw_partner_profile(); the raw
 * values are never sent to the browser.
 */
export function ProfilePage({ profile, onChangePassword }: Props) {
  if (!profile) return null;

  return (
    <div className="space-y-6">
      <Card>
        <SectionHeader title="Partner Details" icon={UserRound} />
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Full name" value={profile.full_name} />
          <Field label="Partner code" value={profile.dsa_code} />
          <Field label="PAN" value={profile.pan_masked} />
          <Field label="Email" value={profile.email} />
          <Field label="Mobile" value={profile.mobile} />
          <Field label="Partner since" value={profile.partner_since} />
          <div className="sm:col-span-2 lg:col-span-3">
            <Field label="Address" value={profile.address} />
          </div>
        </div>
        <div className="mt-5 border-t border-border-subtle pt-4">
          <StatusPill tone={profile.status === 'active' ? 'success' : 'muted'}>
            {profile.status === 'active' ? 'Active partner' : profile.status}
          </StatusPill>
        </div>
      </Card>

      <Card>
        <SectionHeader title="Payout Bank Account" icon={Landmark} />
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          <Field label="Bank" value={profile.bank_name} />
          <Field label="Account number" value={profile.bank_account_masked} />
          <Field label="IFSC" value={profile.bank_ifsc} />
        </div>
        <div className="mt-5 flex items-start gap-2.5 rounded-token-md border border-border bg-bg-surface p-3.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
          <p className="text-xs text-text-muted">
            Your payouts are credited to this account. To change any of these details,
            please contact your relationship manager — bank details cannot be edited
            from the portal.
          </p>
        </div>
      </Card>

      <Card>
        <SectionHeader title="Security" icon={ShieldCheck} />
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-text-primary">Password</p>
            <p className="mt-0.5 text-xs text-text-muted">
              You sign in with your PAN and this password.
            </p>
          </div>
          <button
            type="button"
            onClick={onChangePassword}
            className="flex shrink-0 items-center gap-2 rounded-token-md border border-border bg-bg-surface px-3.5 py-2 text-xs font-semibold text-text-primary transition-colors hover:text-accent"
          >
            <KeyRound className="h-4 w-4" /> Change password
          </button>
        </div>
      </Card>
    </div>
  );
}
