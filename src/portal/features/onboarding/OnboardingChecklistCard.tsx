import { CheckCircle2, Circle, ArrowRight, Clock, Sparkles, ShieldCheck } from 'lucide-react';
import type { NWClient } from '../../../crm/types';
import type { PortalView } from '../../layout/navigation';
import { Card } from '../../components/Card';
import { StatusPill } from '../../components/StatusPill';
import { buildChecklist, checklistProgress, kycUnderReview } from './onboardingSteps';

interface Props {
  client: NWClient | null;
  onNavigate: (view: PortalView) => void;
}

/**
 * "Welcome to NIYOM Wealth" onboarding checklist for the dashboard. Rendered
 * only while onboarding is incomplete (guarded by the parent). Progress and
 * step states are derived from the client record via buildChecklist.
 */
export function OnboardingChecklistCard({ client, onNavigate }: Props) {
  const steps = buildChecklist(client).filter((s) => s.applicable);
  const { done, total, percent } = checklistProgress(buildChecklist(client));
  const underReview = kycUnderReview(client);
  const firstName = client?.full_name?.split(' ')[0] || 'Investor';

  return (
    <Card accent className="animate-fadeInUp">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-accent">
            <Sparkles className="h-3.5 w-3.5" />
            <p className="text-xs font-semibold uppercase tracking-widest">Welcome to Niyom Wealth</p>
          </div>
          <h2 className="mt-1 font-display text-xl font-bold text-text-primary">
            {underReview ? 'Your KYC is under review' : `Let's activate your account, ${firstName}`}
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {underReview
              ? 'Our team is reviewing your documents. Your relationship manager will confirm activation shortly.'
              : 'A few quick steps unlock investing. It takes about 5 minutes — pause and resume anytime.'}
          </p>
        </div>
        <StatusPill tone={underReview ? 'warning' : 'accent'}>
          {done} / {total} done
        </StatusPill>
      </div>

      {/* Progress bar (shared portal pattern) */}
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-bg-raised">
        <div
          className="h-full rounded-full bg-accent transition-all"
          style={{ width: `${percent}%`, transitionDuration: 'var(--dur-slow)' }}
        />
      </div>

      {/* Steps */}
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {steps.map((s) => (
          <li key={s.key} className="flex items-center gap-2.5">
            {s.done ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success-soft" />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-text-faint" />
            )}
            <span className={`text-sm ${s.done ? 'text-text-primary' : 'text-text-muted'}`}>{s.label}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <div className="mt-5">
        {underReview ? (
          <div className="flex items-center gap-2 rounded-token-md border border-warning-soft/20 bg-warning-soft/10 px-3.5 py-2.5 text-sm text-warning-soft">
            <Clock className="h-4 w-4 shrink-0" />
            KYC Under Review — no action needed from you right now.
          </div>
        ) : (
          <button
            onClick={() => onNavigate('onboarding')}
            className="press flex w-full items-center justify-center gap-2 rounded-token-md py-3 text-sm font-bold text-text-on-accent sm:w-auto sm:px-6"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
          >
            <ShieldCheck className="h-4 w-4" />
            Continue Onboarding
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </Card>
  );
}
