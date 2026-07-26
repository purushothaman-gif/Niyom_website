import { useState, type ReactNode } from 'react';
import {
  Banknote,
  KeyRound,
  Landmark,
  Lock,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { fmtDate } from '../../../crm/utils';
import { LogoLoader } from '../../../components/LogoLoader';
import type { NWClient } from '../../../crm/types';
import { ThemeToggle } from '../../../theme/ThemeToggle';
import { Card } from '../../components/Card';
import { Segmented } from '../../components/Segmented';
import { EmptyState } from '../../components/EmptyState';
import { StatusPill } from '../../components/StatusPill';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { maskAccount } from '../../services/ProfileService';
import { canActivateMoreProducts } from '../onboarding/onboardingSteps';

type Tab = 'personal' | 'bank' | 'demat' | 'kyc' | 'settings';

const KYC_TONE = {
  verified: 'success',
  partial: 'warning',
  pending: 'warning',
  rejected: 'danger',
} as const;

interface Props {
  client: NWClient | null;
  clientId: string;
  onChangePassword: () => void;
  onActivateProducts: () => void;
}

/** Label/value line used across the read-only sections. */
function InfoRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-token-md bg-bg-surface px-3.5 py-3">
      <dt className="shrink-0 text-xs text-text-secondary">{label}</dt>
      <dd className={`truncate text-right text-sm font-semibold text-text-primary ${mono ? 'font-mono' : ''}`}>
        {value || '—'}
      </dd>
    </div>
  );
}

function SectionCard({ title, icon: Icon, children, footer }: { title: string; icon: typeof UserRound; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-bold text-text-primary">{title}</h3>
      </div>
      {children}
      {footer}
    </Card>
  );
}

const ADVISOR_NOTE = (
  <p className="mt-4 text-[11px] text-text-faint">
    To update these details, contact your NIYOM relationship manager — regulated changes require
    verification.
  </p>
);

export function ProfilePage({ client, clientId, onChangePassword, onActivateProducts }: Props) {
  const [tab, setTab] = useState<Tab>('personal');
  const status = client?.verification_status ?? 'pending';
  const canActivate = canActivateMoreProducts(client);

  return (
    <div className="space-y-5">
      {/* Identity header */}
      <Card accent>
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-token-xl bg-accent/12 font-display text-xl font-bold text-accent">
            {client?.full_name?.charAt(0).toUpperCase() ?? 'N'}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-lg font-bold text-text-primary">
              {client?.full_name ?? 'Investor'}
            </h2>
            <p className="font-mono text-xs text-text-secondary">{client?.client_code ?? '—'}</p>
          </div>
          <StatusPill tone={KYC_TONE[status]}>
            KYC {status.charAt(0).toUpperCase() + status.slice(1)}
          </StatusPill>
        </div>
      </Card>

      <Segmented<Tab>
        options={[
          { value: 'personal', label: 'Personal' },
          { value: 'bank', label: 'Bank' },
          { value: 'demat', label: 'Demat' },
          { value: 'kyc', label: 'KYC & FATCA' },
          { value: 'settings', label: 'Settings' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'personal' && (
        <SectionCard title="Personal Details" icon={UserRound} footer={ADVISOR_NOTE}>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <InfoRow label="Full Name" value={client?.full_name} />
            <InfoRow label="PAN" value={client?.pan} mono />
            <InfoRow label="Date of Birth" value={client?.dob ? fmtDate(client.dob) : '—'} />
            <InfoRow label="Mobile" value={client?.phone} />
            <InfoRow label="Email" value={client?.email} />
            <InfoRow label="City / State" value={[client?.city, client?.state].filter(Boolean).join(', ')} />
            <div className="sm:col-span-2">
              <InfoRow label="Address" value={client?.address} />
            </div>
          </dl>
        </SectionCard>
      )}

      {tab === 'bank' && <BankSection clientId={clientId} client={client} />}

      {tab === 'demat' && (
        <SectionCard title="Demat Account" icon={Landmark} footer={client?.demat_account ? ADVISOR_NOTE : undefined}>
          {client?.demat_account ? (
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <InfoRow label="Demat A/C" value={maskAccount(client.demat_account)} mono />
              <InfoRow label="DP Name" value={client.dp_name} />
              <InfoRow label="Depository" value={client.depository} />
            </dl>
          ) : (
            <EmptyState icon={Landmark} title="No demat account on file." hint="Required only for Bonds & Unlisted Shares." compact />
          )}
          {canActivate && (
            <button
              onClick={onActivateProducts}
              className="press mt-4 flex w-full items-center justify-center gap-2 rounded-token-md py-3 text-sm font-bold text-text-on-accent"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              Activate Bonds &amp; Unlisted Shares
            </button>
          )}
        </SectionCard>
      )}

      {tab === 'kyc' && (
        <div className="space-y-5">
          <SectionCard title="KYC Status" icon={ShieldCheck}>
            <div className="flex items-center justify-between rounded-token-md bg-bg-surface px-3.5 py-3">
              <span className="text-xs text-text-secondary">Verification Status</span>
              <StatusPill tone={KYC_TONE[status]}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </StatusPill>
            </div>
            <p className="mt-3 text-[11px] text-text-faint">
              {status === 'verified'
                ? 'Your KYC is verified and active for transactions.'
                : 'Your KYC is being processed. Some transactions may be restricted until it is verified.'}
            </p>
          </SectionCard>

          <SectionCard title="FATCA / Tax Residency" icon={ShieldCheck} footer={ADVISOR_NOTE}>
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <InfoRow label="Tax Residency" value="India" />
              <InfoRow label="US Person" value="No" />
              <InfoRow label="PAN" value={client?.pan} mono />
            </dl>
          </SectionCard>

          <SectionCard title="Nominee" icon={UserRound}>
            <EmptyState
              icon={UserRound}
              title="Nominees are registered at the folio level."
              hint="Your relationship manager can help you add or update a nominee."
              compact
            />
          </SectionCard>
        </div>
      )}

      {tab === 'settings' && (
        <SectionCard title="Settings" icon={Lock}>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-token-md bg-bg-surface px-3.5 py-3">
              <div>
                <p className="text-sm font-semibold text-text-primary">Appearance</p>
                <p className="text-[11px] text-text-secondary">Switch between light and dark.</p>
              </div>
              <ThemeToggle variant="switch" />
            </div>
            <button
              type="button"
              onClick={onChangePassword}
              className="flex w-full items-center justify-between rounded-token-md bg-bg-surface px-3.5 py-3 text-left transition-colors hover:bg-hover"
            >
              <div>
                <p className="text-sm font-semibold text-text-primary">Password</p>
                <p className="text-[11px] text-text-secondary">Change your login password.</p>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-accent">
                <KeyRound className="h-4 w-4" /> Change
              </span>
            </button>
            <div className="flex items-center justify-between rounded-token-md bg-bg-surface px-3.5 py-3 opacity-70">
              <div>
                <p className="text-sm font-semibold text-text-primary">Notifications</p>
                <p className="text-[11px] text-text-secondary">Email & SMS alert preferences.</p>
              </div>
              <StatusPill tone="muted">Soon</StatusPill>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function BankSection({ clientId, client }: { clientId: string; client: NWClient | null }) {
  const { accounts, loading, error } = useBankAccounts(clientId);

  // Fall back to the primary bank mirror on nw_clients if the table is empty.
  const fallback =
    client?.bank_account && accounts.length === 0
      ? [{
          id: 'primary',
          account_number: client.bank_account,
          ifsc: client.bank_ifsc,
          bank_name: client.bank_name,
          holder_name: client.full_name,
          label: 'Primary',
          is_primary: true,
        }]
      : [];

  const list = accounts.length > 0 ? accounts : fallback;

  return (
    <SectionCard title="Bank Accounts" icon={Banknote} footer={ADVISOR_NOTE}>
      {loading ? (
        <div className="flex justify-center py-8">
          <LogoLoader size={40} />
        </div>
      ) : error ? (
        <EmptyState icon={Banknote} title={error} compact />
      ) : list.length === 0 ? (
        <EmptyState icon={Banknote} title="No bank account on file." compact />
      ) : (
        <div className="space-y-2">
          {list.map((a) => (
            <div key={a.id} className="rounded-token-md bg-bg-surface px-3.5 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-text-primary">{a.bank_name || 'Bank'}</p>
                {a.is_primary && <StatusPill tone="accent">Primary</StatusPill>}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <p className="text-text-secondary">A/C No.</p>
                <p className="text-right font-mono font-semibold text-text-primary">{maskAccount(a.account_number)}</p>
                <p className="text-text-secondary">IFSC</p>
                <p className="text-right font-mono font-semibold text-text-primary">{a.ifsc || '—'}</p>
                <p className="text-text-secondary">Holder</p>
                <p className="text-right font-semibold text-text-primary">{a.holder_name || client?.full_name || '—'}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
