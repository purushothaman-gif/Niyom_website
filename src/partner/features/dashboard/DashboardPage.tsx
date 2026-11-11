/**
 * Partner home — built around "what do I sell today, and what does my book
 * look like", Groww-style but focused on the partner's job rather than an
 * investor's.
 *
 *   left   Sell today: popular bonds and unlisted shares, each with the
 *          client-facing yield/price, the partner's spread per ₹1 lakh, and
 *          Order / Link / Image shortcuts; then the client book board.
 *   right  Earnings (frozen debit-note figures only), the RM card, and tools.
 *
 * Every monetary tile is labelled by what it actually is — "Raised this FY",
 * "Paid", "Awaiting payment" — never "payout MTD/YTD": debit notes are keyed
 * (dsa_id, month, year), so no accrual exists until the month's note is raised.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  ClipboardList,
  FileSignature,
  Gem,
  Landmark,
  Loader2,
  Mail,
  Phone,
  Share2,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { inr } from '../../../lib/money';
import { Card } from '../../../portal/components/Card';
import { StatusPill } from '../../../portal/components/StatusPill';
import { OnboardClientModal } from '../clients/OnboardClientModal';
import { InviteImportCard } from '../clients/InviteImportCard';
import type { PartnerSnapshot } from '../../hooks/usePartnerSnapshot';
import type { PartnerView } from '../../layout/navigation';
import { InvestmentsBoard } from '../../../portal/features/investments/InvestmentsBoard';
import { usePartnerBook } from '../book/usePartnerBook';
import { PartnerService, type PartnerBond, type PartnerShare } from '../../services/PartnerService';
import { CardGrid, ProductsTools, Rail, RailSkeleton, type ToolItem } from '../../../portal/features/explore/cards';
import { popularBonds } from '../../../portal/features/explore/ExploreHub';
import { PartnerBondSellCard, PartnerShareSellCard } from '../sell/SellCards';
import type { PartnerBondIntent } from '../bonds/BondsModule';
import type { PartnerShareIntent } from '../shares/SharesModule';

interface Props {
  snapshot: PartnerSnapshot;
  onNavigate: (view: PartnerView) => void;
  /** Refresh the portal snapshot after a new client is onboarded. */
  onOnboarded: () => void;
  /** Products switched off for this partner. */
  hidden?: ReadonlySet<string>;
  onOpenBond?: (intent: PartnerBondIntent) => void;
  onOpenShare?: (intent: PartnerShareIntent) => void;
}

const NONE: ReadonlySet<string> = new Set();

export function DashboardPage({ snapshot, onNavigate, onOnboarded, hidden = NONE, onOpenBond, onOpenShare }: Props) {
  const { profile, clients, payout, notes } = snapshot;
  const [showOnboard, setShowOnboard] = useState(false);
  const book = usePartnerBook(clients);
  const showBonds = !hidden.has('bonds');
  const showShares = !hidden.has('unlisted-shares');

  const [bonds, setBonds] = useState<PartnerBond[] | null>(null);
  const [shares, setShares] = useState<PartnerShare[] | null>(null);
  useEffect(() => {
    let alive = true;
    if (showBonds) PartnerService.getBonds().then((b) => alive && setBonds(b)).catch(() => alive && setBonds([]));
    if (showShares) PartnerService.getShares().then((s) => alive && setShares(s)).catch(() => alive && setShares([]));
    return () => {
      alive = false;
    };
  }, [showBonds, showShares]);
  const topBonds = useMemo(() => (bonds ? popularBonds(bonds, 3) : []), [bonds]);

  const activeClients = clients.filter((c) => c.onboarding_status === 'active').length;
  const unsigned = notes.filter((n) => n.signature_status !== 'signed');
  const unpaid = notes.filter((n) => n.status !== 'paid');

  const bondGo = (id: string, action: PartnerBondIntent['action']) =>
    onOpenBond ? onOpenBond({ id, action }) : onNavigate('bonds');
  const shareGo = (id: string, action: PartnerShareIntent['action']) =>
    onOpenShare ? onOpenShare({ id, action }) : onNavigate('unlisted-shares');

  const tools: ToolItem[] = [
    { key: 'onboard', label: 'Onboard a client', icon: UserPlus, onClick: () => setShowOnboard(true) },
    { key: 'clients', label: 'My clients', icon: Users, badge: clients.length ? `${clients.length}` : undefined, onClick: () => onNavigate('clients') },
    ...(showBonds ? [{ key: 'bonds', label: 'All bonds', icon: Landmark, badge: bonds ? `${bonds.length} open` : undefined, onClick: () => onNavigate('bonds') }] : []),
    ...(showShares ? [{ key: 'shares', label: 'All unlisted shares', icon: Gem, badge: shares ? `${shares.length} open` : undefined, onClick: () => onNavigate('unlisted-shares') }] : []),
    { key: 'referral', label: 'Referral link', icon: Share2, onClick: () => onNavigate('referral') },
    { key: 'lead', label: 'Submit a lead', icon: ClipboardList, onClick: () => onNavigate('submit-lead') },
    { key: 'payouts', label: 'Statements', icon: FileSignature, badge: unsigned.length ? `${unsigned.length} to sign` : undefined, onClick: () => onNavigate('payouts') },
  ];

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-display text-2xl font-bold text-text-primary">
            {/* Full name, not a first-name split: many partners are firms or HUFs. */}
            Welcome, {profile?.full_name ?? 'Partner'}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Partner code <span className="font-mono text-text-secondary">{profile?.dsa_code}</span>
            {profile?.partner_since && <> · with Niyom Wealth since {profile.partner_since}</>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowOnboard(true)}
          className="inline-flex shrink-0 items-center gap-2 rounded-token-md px-4 py-2.5 text-sm font-bold text-on-accent"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
        >
          <UserPlus className="h-4 w-4" /> Onboard a client
        </button>
      </div>

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

      <InviteImportCard />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ------------------------------------------------ left */}
        <div className="min-w-0 space-y-10">
          {showBonds && (
            <Rail title="Sell today · Bonds" icon={Landmark} more="All bonds" onMore={() => onNavigate('bonds')}>
              {bonds === null ? (
                <RailSkeleton />
              ) : topBonds.length ? (
                <CardGrid cols={3}>
                  {topBonds.map((b) => (
                    <PartnerBondSellCard
                      key={b.id}
                      bond={b}
                      onOpen={() => bondGo(b.id, 'detail')}
                      onOrder={() => bondGo(b.id, 'order')}
                      onShare={() => bondGo(b.id, 'share')}
                      onImage={() => bondGo(b.id, 'image')}
                    />
                  ))}
                </CardGrid>
              ) : (
                <p className="rounded-token-xl border border-dashed border-border px-5 py-8 text-center text-sm text-text-secondary">
                  No bonds are open for you right now — your RM adds new offers regularly.
                </p>
              )}
            </Rail>
          )}

          {showShares && (
            <Rail title="Sell today · Unlisted shares" icon={Gem} more="All unlisted shares" onMore={() => onNavigate('unlisted-shares')}>
              {shares === null ? (
                <RailSkeleton />
              ) : shares.length ? (
                <CardGrid cols={3}>
                  {shares.slice(0, 3).map((s) => (
                    <PartnerShareSellCard
                      key={s.id}
                      share={s}
                      onOpen={() => shareGo(s.id, 'detail')}
                      onOrder={() => shareGo(s.id, 'order')}
                      onShare={() => shareGo(s.id, 'share')}
                    />
                  ))}
                </CardGrid>
              ) : (
                <p className="rounded-token-xl border border-dashed border-border px-5 py-8 text-center text-sm text-text-secondary">
                  No unlisted shares are open right now.
                </p>
              )}
            </Rail>
          )}

          {/* Client book — every sourced client's holdings. */}
          {clients.length > 0 &&
            (book.loading ? (
              <Card>
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading your clients&rsquo; portfolio…
                </div>
              </Card>
            ) : (
              <InvestmentsBoard
                rows={book.rows}
                enriching={book.enriching}
                title="Client book"
                maxRows={8}
                compact
                onViewAll={() => onNavigate('clients')}
              />
            ))}
        </div>

        {/* ------------------------------------------------ right */}
        <aside className="space-y-8">
          <section>
            <h2 className="mb-4 font-display text-xl font-bold tracking-tight text-text-primary">Your earnings</h2>
            <div className="rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card">
              <p className="text-xs text-text-secondary">Raised this FY {payout?.fy_label ? `(${payout.fy_label})` : ''}</p>
              <p className="mt-1 font-display text-3xl font-bold tabular-nums text-text-primary">
                {inr(Number(payout?.fy_net ?? 0))}
              </p>
              <p className="mt-0.5 text-[11px] text-text-faint">
                Gross {inr(Number(payout?.fy_gross ?? 0))} · TDS {inr(Number(payout?.fy_tds ?? 0))}
              </p>
              <div className="mt-4 divide-y divide-border-subtle border-t border-dashed border-border">
                <EarnRow label="Paid to date" value={inr(Number(payout?.paid_net ?? 0))} tone="text-success" />
                <EarnRow
                  label={`Awaiting payment${unpaid.length ? ` (${unpaid.length})` : ''}`}
                  value={inr(Number(payout?.awaiting_payment_net ?? 0))}
                  tone={unpaid.length ? 'text-warning' : undefined}
                />
                <EarnRow label="Lifetime (net of TDS)" value={inr(Number(payout?.lifetime_net ?? 0))} />
                <EarnRow label="Clients sourced" value={`${clients.length} · ${activeClients} active`} />
              </div>
              {payout?.latest_note_number && (
                <p className="mt-3 border-t border-border-subtle pt-3 text-[11px] text-text-muted">
                  Latest statement <span className="font-mono text-text-secondary">{payout.latest_note_number}</span> for{' '}
                  {payout.latest_note_period} — {inr(Number(payout.latest_note_net ?? 0))} net.
                </p>
              )}
              <button
                type="button"
                onClick={() => onNavigate('payouts')}
                className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:text-accent-soft"
              >
                <Wallet className="h-3.5 w-3.5" /> Statements & payouts
              </button>
            </div>
          </section>

          <section>
            <h2 className="mb-4 font-display text-xl font-bold tracking-tight text-text-primary">Your RM</h2>
            <div className="rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card">
              {profile?.rm_name ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    {profile.rm_avatar_url ? (
                      <img src={profile.rm_avatar_url} alt="" className="h-11 w-11 rounded-token-md object-cover" />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-token-md bg-accent/15 text-sm font-bold text-accent">
                        {profile.rm_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-text-primary">{profile.rm_name}</p>
                      <p className="text-xs text-text-muted">Relationship manager</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {profile.rm_mobile && (
                      <a
                        href={`tel:${profile.rm_mobile}`}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-token-md border border-border bg-bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:text-accent"
                      >
                        <Phone className="h-3.5 w-3.5" /> Call
                      </a>
                    )}
                    {profile.rm_email && (
                      <a
                        href={`mailto:${profile.rm_email}`}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-token-md border border-border bg-bg-surface px-3 py-2 text-xs font-semibold text-text-primary hover:text-accent"
                      >
                        <Mail className="h-3.5 w-3.5" /> Email
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-text-secondary">
                  <BadgeCheck className="h-4 w-4" /> No relationship manager assigned
                </p>
              )}
              <div className="mt-4 border-t border-border-subtle pt-3">
                <StatusPill tone={profile?.status === 'active' ? 'success' : 'muted'}>
                  Partner status: {profile?.status ?? '—'}
                </StatusPill>
              </div>
            </div>
          </section>

          <ProductsTools title="Tools" items={tools} />
        </aside>
      </div>

      {showOnboard && (
        <OnboardClientModal
          onClose={() => setShowOnboard(false)}
          onOnboarded={() => {
            setShowOnboard(false);
            onOnboarded();
          }}
        />
      )}
    </div>
  );
}

function EarnRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${tone ?? 'text-text-primary'}`}>{value}</span>
    </div>
  );
}
