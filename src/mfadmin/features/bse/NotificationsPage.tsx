/**
 * Notifications — things at BSE that need a human.
 *
 * Derived from live BSE state rather than a message queue: BSE has not
 * registered our webhook yet, so nothing pushes to us. Rather than show an
 * empty inbox, this computes what is actually outstanding — clients stuck
 * mid-onboarding, SIPs waiting on investor approval, orders that have not
 * moved — which is what someone opening this screen wants to know.
 */
import { AlertTriangle, Bell, CheckCircle2, Clock, Hash, ListChecks } from 'lucide-react';
import { Card } from '../../../portal/components/Card';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { StatusPill } from '../../../portal/components/StatusPill';
import { LogoLoader } from '../../../components/LogoLoader';
import {
  BseOpsService,
  isBseConfigured,
  type BseOrderRow,
  type BseSxpRow,
  type BseUccRow,
} from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { ErrorNote, NotConfigured } from './formBits';

interface Alert {
  id: string;
  severity: 'action' | 'waiting' | 'info';
  title: string;
  detail: string;
  view: string;
}

interface Bundle {
  uccs: BseUccRow[];
  orders: BseOrderRow[];
  sxp: BseSxpRow[];
}

const AGE_DAYS = (iso: string) =>
  iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0;

function buildAlerts({ uccs, orders, sxp }: Bundle): Alert[] {
  const out: Alert[] = [];

  // Clients that cannot transact — the most common blocker on this desk.
  const pendingAuth = uccs.filter((u) => u.status.toUpperCase() === 'PENDING_AUTH');
  if (pendingAuth.length) {
    out.push({
      id: 'ucc_auth',
      severity: 'action',
      title: `${pendingAuth.length} client${pendingAuth.length === 1 ? '' : 's'} awaiting investor 2FA`,
      detail: `Nothing progresses at BSE until the investor approves. ${pendingAuth
        .slice(0, 4)
        .map((u) => u.clientCode)
        .join(', ')}${pendingAuth.length > 4 ? '…' : ''}`,
      view: 'KYC',
    });
  }

  const verifying = uccs.filter((u) => u.status.toUpperCase() === 'PENDING_VERIFICATION');
  if (verifying.length) {
    out.push({
      id: 'ucc_verify',
      severity: 'waiting',
      title: `${verifying.length} client${verifying.length === 1 ? '' : 's'} in third-party verification`,
      detail: `Waiting on BSE's PAN/KYC checks — no action on our side. ${verifying
        .map((u) => u.clientCode)
        .join(', ')}`,
      view: 'KYC',
    });
  }

  // SIPs registered but not yet authorised by the investor.
  const sxpAwaiting = sxp.filter((s) => s.status.toLowerCase().includes('awaited'));
  if (sxpAwaiting.length) {
    out.push({
      id: 'sxp_auth',
      severity: 'action',
      title: `${sxpAwaiting.length} SIP${sxpAwaiting.length === 1 ? '' : 's'} awaiting investor approval`,
      detail: 'Registered at BSE but will not trigger until the investor authorises.',
      view: 'SIP',
    });
  }

  // Orders that have sat unchanged — worth chasing rather than assuming.
  const stale = orders.filter(
    (o) => o.status.toLowerCase() === 'received' && AGE_DAYS(o.placedAt) >= 2,
  );
  if (stale.length) {
    out.push({
      id: 'orders_stale',
      severity: 'waiting',
      title: `${stale.length} order${stale.length === 1 ? '' : 's'} still "received" after 2+ days`,
      detail: 'Not yet allotted by the RTA. Check the order book if this persists.',
      view: 'Order Book',
    });
  }

  const rejected = orders.filter((o) => o.status.toLowerCase().includes('reject'));
  if (rejected.length) {
    out.push({
      id: 'orders_rejected',
      severity: 'action',
      title: `${rejected.length} rejected order${rejected.length === 1 ? '' : 's'}`,
      detail: rejected[0]?.rejectionReason || 'See the order book for the rejection reason.',
      view: 'Order Book',
    });
  }

  if (uccs.length && !uccs.some((u) => u.status.toUpperCase() === 'ACTIVE')) {
    out.push({
      id: 'no_active',
      severity: 'action',
      title: 'No client can transact yet',
      detail: 'Every UCC is still mid-onboarding, so no order can be placed.',
      view: 'KYC',
    });
  }

  return out;
}

const SEVERITY = {
  action: { tone: 'warning' as const, icon: AlertTriangle, label: 'Needs action' },
  waiting: { tone: 'muted' as const, icon: Clock, label: 'Waiting on BSE' },
  info: { tone: 'muted' as const, icon: Bell, label: 'Info' },
};

export function NotificationsPage() {
  const { data, loading, error } = useBseData<Bundle>(async () => {
    const [uccs, orders, sxp] = await Promise.all([
      BseOpsService.uccs(),
      BseOpsService.orders(),
      BseOpsService.sxp(),
    ]);
    return { uccs, orders, sxp };
  });

  if (!isBseConfigured()) return <NotConfigured title="Notifications" />;
  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <LogoLoader size={48} />
      </div>
    );
  }
  if (error) return <ErrorNote title="Couldn’t load from BSE." message={error} />;
  if (!data) return null;

  const alerts = buildAlerts(data);
  const needsAction = alerts.filter((a) => a.severity === 'action').length;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <SectionHeader title="What needs attention" icon={Bell} />
          <StatusPill tone={needsAction > 0 ? 'warning' : 'success'}>
            {needsAction > 0 ? `${needsAction} needing action` : 'All clear'}
          </StatusPill>
        </div>

        {alerts.length === 0 ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-success" />
            <p className="text-sm font-medium text-text-primary">Nothing outstanding at BSE.</p>
            <p className="mt-1 text-xs text-text-secondary">
              No blocked clients, unauthorised SIPs or stalled orders.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {alerts.map((a) => {
              const s = SEVERITY[a.severity];
              const Icon = s.icon;
              return (
                <li key={a.id} className="flex items-start gap-3 py-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-token-md bg-bg-base">
                    <Icon
                      className={`h-3.5 w-3.5 ${
                        a.severity === 'action' ? 'text-warning' : 'text-text-secondary'
                      }`}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-text-primary">{a.title}</span>
                    <span className="mt-0.5 block text-[11px] text-text-secondary">{a.detail}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-text-faint">{a.view}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-3 gap-4">
        <Card padding="md">
          <p className="text-[11px] text-text-secondary">Clients</p>
          <p className="mt-1 text-lg font-bold text-text-primary">
            {data.uccs.filter((u) => u.status.toUpperCase() === 'ACTIVE').length}
            <span className="text-xs font-normal text-text-faint"> / {data.uccs.length} ready</span>
          </p>
        </Card>
        <Card padding="md">
          <p className="text-[11px] text-text-secondary">
            <ListChecks className="mr-1 inline h-3 w-3 align-[-2px]" />
            Orders open
          </p>
          <p className="mt-1 text-lg font-bold text-text-primary">
            {data.orders.filter((o) => o.status.toLowerCase() === 'received').length}
          </p>
        </Card>
        <Card padding="md">
          <p className="text-[11px] text-text-secondary">
            <Hash className="mr-1 inline h-3 w-3 align-[-2px]" />
            SIPs active
          </p>
          <p className="mt-1 text-lg font-bold text-text-primary">
            {data.sxp.filter((s) => s.status.toLowerCase() === 'active').length}
          </p>
        </Card>
      </div>

      <p className="text-center text-[11px] text-text-faint">
        Derived from live BSE state. BSE has not registered our webhook yet, so nothing is pushed —
        this recomputes on each visit.
      </p>
    </div>
  );
}
