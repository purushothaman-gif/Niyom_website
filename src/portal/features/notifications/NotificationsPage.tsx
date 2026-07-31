/**
 * Notifications — derived from the client's real state, not a feed.
 *
 * There is no notification table behind this and no push infrastructure. Rather
 * than invent a feed, the page computes what genuinely needs the client's
 * attention right now: onboarding they haven't finished, a systematic plan
 * still awaiting their approval at BSE, an order that hasn't been funded.
 *
 * The consequence is that this list is always current and can never be stale —
 * and when there is nothing to do, it says so instead of padding.
 */
import { useEffect, useState } from 'react';
import { AlertCircle, BellOff, CalendarClock, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { NWClient } from '../../../crm/types';
import { bseGateway } from '../../services/bse/gateway';
import type { SystematicPlan } from '../../services/bse/contract';
import type { PortalView } from '../../layout/navigation';
import { Blank, PortalButton, ScreenHead, Tile } from '../../ui/kit';
import { onboardingIncomplete } from '../onboarding/onboardingSteps';

interface Alert {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  tone: 'action' | 'info';
  cta?: { label: string; view: PortalView };
}

export function NotificationsPage({
  client,
  onNavigate,
}: {
  client: NWClient | null;
  onNavigate: (view: PortalView) => void;
}) {
  const [plans, setPlans] = useState<SystematicPlan[]>([]);

  useEffect(() => {
    let alive = true;
    bseGateway()
      .getSystematicPlans()
      .then((p) => alive && setPlans(p))
      .catch(() => {
        /* A BSE outage must not break this page — it just has less to say. */
      });
    return () => {
      alive = false;
    };
  }, []);

  const alerts: Alert[] = [];

  if (onboardingIncomplete(client)) {
    alerts.push({
      id: 'onboarding',
      icon: ShieldCheck,
      title: 'Finish setting up your account',
      body: 'Your KYC isn’t complete yet, so you can’t invest. It takes a few minutes.',
      tone: 'action',
      cta: { label: 'Complete KYC', view: 'onboarding' },
    });
  }

  const awaiting = plans.filter((p) => p.status.toLowerCase() !== 'active');
  if (awaiting.length > 0) {
    alerts.push({
      id: 'sip-auth',
      icon: CalendarClock,
      title: `${awaiting.length} systematic plan${awaiting.length === 1 ? '' : 's'} need your approval`,
      body: 'BSE emailed you an approval link. Until you complete it, the first instalment cannot be collected.',
      tone: 'action',
      cta: { label: 'View plans', view: 'sip' },
    });
  }

  const actionCount = alerts.filter((a) => a.tone === 'action').length;

  return (
    <>
      <ScreenHead
        title="Notifications"
        subtitle={
          actionCount > 0
            ? `${actionCount} thing${actionCount === 1 ? '' : 's'} need your attention.`
            : 'Anything needing your attention shows up here.'
        }
      />

      {alerts.length === 0 ? (
        <Tile flush>
          <Blank
            icon={BellOff}
            title="Nothing needs your attention"
            body="When something does — an approval to complete, a payment to make, KYC to finish — it will appear here."
          />
        </Tile>
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => {
            const Icon = a.icon;
            return (
              <Tile key={a.id}>
                <div className="flex items-start gap-3.5">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-token-md ${
                      a.tone === 'action' ? 'bg-warning/10' : 'bg-bg-surface'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 ${a.tone === 'action' ? 'text-warning' : 'text-text-secondary'}`}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text-primary">{a.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-secondary">{a.body}</p>
                    {a.cta && (
                      <div className="mt-3">
                        <PortalButton onClick={() => onNavigate(a.cta!.view)}>
                          {a.cta.label}
                        </PortalButton>
                      </div>
                    )}
                  </div>
                </div>
              </Tile>
            );
          })}
        </div>
      )}

      <p className="mt-5 flex items-start gap-2 px-1 text-[11px] leading-relaxed text-text-faint">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        This list is worked out from your account as it stands right now, so it is never out of
        date. Niyom will also email or call you about anything urgent.
      </p>
    </>
  );
}
