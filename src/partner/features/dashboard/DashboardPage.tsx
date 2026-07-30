import { Users, Wallet, FileSignature, TrendingUp, Phone, Mail, ArrowRight, BadgeCheck } from 'lucide-react';
import { Card } from '../../../portal/components/Card';
import { KpiStat } from '../../../portal/components/KpiStat';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { StatusPill } from '../../../portal/components/StatusPill';
import { EmptyState } from '../../../portal/components/EmptyState';
import { fmt } from '../../../crm/utils';
import type { PartnerSnapshot } from '../../hooks/usePartnerSnapshot';
import type { PartnerView } from '../../layout/navigation';

interface Props {
  snapshot: PartnerSnapshot;
  onNavigate: (view: PartnerView) => void;
}

/**
 * Partner dashboard.
 *
 * Every monetary tile is labelled by what it actually is — "Raised this FY",
 * "Paid", "Awaiting payment" — never "payout MTD/YTD". Debit notes are keyed
 * (dsa_id, month, year), so no accrual figure exists until the month's note is
 * raised; a tile implying otherwise would be wrong the day a partner looks at it
 * mid-month.
 */
export function DashboardPage({ snapshot, onNavigate }: Props) {
  const { profile, clients, payout, notes } = snapshot;

  const totalInvested = clients.reduce((s, c) => s + Number(c.invested_amount || 0), 0);
  const totalValue = clients.reduce((s, c) => s + Number(c.current_value || 0), 0);
  const activeClients = clients.filter((c) => c.onboarding_status === 'active').length;

  // Computed notifications — derived from the snapshot, no notifications table.
  const unsigned = notes.filter((n) => n.signature_status !== 'signed');
  const unpaid = notes.filter((n) => n.status !== 'paid');

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div>
        <h2 className="font-display text-2xl font-bold text-text-primary">
          Welcome, {profile?.full_name?.split(' ')[0] ?? 'Partner'}
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Partner code <span className="font-mono text-text-secondary">{profile?.dsa_code}</span>
          {profile?.partner_since && <> · with Niyom Wealth since {profile.partner_since}</>}
        </p>
      </div>

      {/* Action required — only rendered when there is something to act on. */}
      {unsigned.length > 0 && (
        <Card accent padding="md">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <FileSignature className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              <div>
                <p className="text-sm font-semibold text-text-primary">
                  {unsigned.length} statement{unsigned.length !== 1 ? 's' : ''} awaiting your signature
                </p>
                <p className="mt-0.5 text-xs text-text-muted">
                  Your relationship manager emails a secure signing link for each statement.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('payouts')}
              className="flex shrink-0 items-center gap-1.5 rounded-token-md border border-border bg-bg-surface px-3 py-2 text-xs font-semibold text-text-primary transition-colors hover:text-accent"
            >
              View statements <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </Card>
      )}

      {/* Earnings — frozen figures only. */}
      <Card>
        <SectionHeader title={`Earnings — FY ${payout?.fy_label ?? ''}`} icon={Wallet} />
        <div className="mt-5 grid grid-cols-2 gap-6 lg:grid-cols-4">
          <KpiStat
            label="Raised this FY"
            value={fmt(Number(payout?.fy_net ?? 0))}
            sub={`Gross ${fmt(Number(payout?.fy_gross ?? 0))} · TDS ${fmt(Number(payout?.fy_tds ?? 0))}`}
          />
          <KpiStat
            label="Paid to date"
            value={fmt(Number(payout?.paid_net ?? 0))}
            color="var(--success)"
            sub="Net of TDS"
            trend="up"
          />
          <KpiStat
            label="Awaiting payment"
            value={fmt(Number(payout?.awaiting_payment_net ?? 0))}
            color={unpaid.length ? 'var(--warning)' : undefined}
            sub={`${unpaid.length} statement${unpaid.length !== 1 ? 's' : ''}`}
          />
          <KpiStat
            label="Lifetime earnings"
            value={fmt(Number(payout?.lifetime_net ?? 0))}
            sub="Net of TDS, all years"
          />
        </div>
        {payout?.latest_note_number && (
          <p className="mt-5 border-t border-border-subtle pt-4 text-xs text-text-muted">
            Latest statement{' '}
            <span className="font-mono text-text-secondary">{payout.latest_note_number}</span> for{' '}
            {payout.latest_note_period} — {fmt(Number(payout.latest_note_net ?? 0))} net payable.
          </p>
        )}
      </Card>

      {/* Business */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionHeader title="Your Business" icon={TrendingUp} />
          <div className="mt-5 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <KpiStat label="Clients sourced" value={String(clients.length)} sub={`${activeClients} active`} />
            <KpiStat label="Total invested" value={fmt(totalInvested)} />
            <KpiStat
              label="Current value"
              value={fmt(totalValue)}
              color={totalValue >= totalInvested ? 'var(--success)' : 'var(--danger)'}
              sub={
                totalInvested > 0
                  ? `${totalValue >= totalInvested ? '+' : ''}${(((totalValue - totalInvested) / totalInvested) * 100).toFixed(1)}%`
                  : undefined
              }
              trend={totalValue >= totalInvested ? 'up' : 'down'}
            />
            <KpiStat label="Statements" value={String(notes.length)} sub="Raised to date" />
          </div>

          <div className="mt-6 border-t border-border-subtle pt-4">
            {clients.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No clients sourced yet"
                hint="Clients you introduce will appear here once they are onboarded."
                compact
              />
            ) : (
              <>
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Recent clients
                </p>
                <ul className="space-y-2">
                  {clients.slice(0, 4).map((c) => (
                    <li key={c.client_id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text-primary">{c.full_name}</p>
                        <p className="font-mono text-[11px] text-text-secondary">{c.client_code}</p>
                      </div>
                      <span className="shrink-0 font-medium text-text-primary">
                        {fmt(Number(c.current_value || 0))}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => onNavigate('clients')}
                  className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-accent transition-colors hover:text-accent-soft"
                >
                  View all clients <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </Card>

        {/* RM card — the single thing partners most often need. */}
        <Card>
          <SectionHeader title="Your Relationship Manager" icon={BadgeCheck} />
          {profile?.rm_name ? (
            <div className="mt-5 space-y-4">
              <div className="flex items-center gap-3">
                {profile.rm_avatar_url ? (
                  <img
                    src={profile.rm_avatar_url}
                    alt=""
                    className="h-11 w-11 rounded-token-md object-cover"
                  />
                ) : (
                  <div className="flex h-11 w-11 items-center justify-center rounded-token-md bg-accent/15 text-sm font-bold text-accent">
                    {profile.rm_name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-primary">{profile.rm_name}</p>
                  <p className="text-xs text-text-muted">Niyom Wealth</p>
                </div>
              </div>
              {profile.rm_mobile && (
                <a
                  href={`tel:${profile.rm_mobile}`}
                  className="flex items-center gap-2.5 rounded-token-md border border-border bg-bg-surface px-3 py-2.5 text-sm text-text-primary transition-colors hover:text-accent"
                >
                  <Phone className="h-4 w-4 shrink-0 text-text-muted" />
                  <span className="truncate">{profile.rm_mobile}</span>
                </a>
              )}
              {profile.rm_email && (
                <a
                  href={`mailto:${profile.rm_email}`}
                  className="flex items-center gap-2.5 rounded-token-md border border-border bg-bg-surface px-3 py-2.5 text-sm text-text-primary transition-colors hover:text-accent"
                >
                  <Mail className="h-4 w-4 shrink-0 text-text-muted" />
                  <span className="truncate">{profile.rm_email}</span>
                </a>
              )}
              <p className="text-xs text-text-faint">
                Contact your RM for password resets, bank detail changes, or anything
                about your statements.
              </p>
            </div>
          ) : (
            <div className="mt-5">
              <EmptyState icon={BadgeCheck} title="No relationship manager assigned" compact />
            </div>
          )}
          <div className="mt-4 border-t border-border-subtle pt-4">
            <StatusPill tone={profile?.status === 'active' ? 'success' : 'muted'}>
              Partner status: {profile?.status ?? '—'}
            </StatusPill>
          </div>
        </Card>
      </div>
    </div>
  );
}
