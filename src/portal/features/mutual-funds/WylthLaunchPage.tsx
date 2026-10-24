import { AlertTriangle, ExternalLink, Hourglass, Loader2, ShieldCheck, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PortalButton, Tile } from '../../ui/kit';
import type { PortalView } from '../../layout/navigation';
import type { WylthLaunchState } from './useWylthLaunch';

interface Props {
  state: WylthLaunchState;
  onLaunch: () => void;
  onNavigate: (view: PortalView) => void;
}

const COPY: Record<WylthLaunchState, { icon: LucideIcon; title: string; hint: string; tone?: 'warn' }> = {
  idle: {
    icon: TrendingUp,
    title: 'Your mutual fund account',
    hint: 'Your mutual fund holdings, investments and SIPs are managed on our MF platform. It opens in a new tab — no separate sign-in needed.',
  },
  opening: {
    icon: Loader2,
    title: 'Opening your mutual fund account…',
    hint: 'Signing you in securely. This takes a moment.',
  },
  opened: {
    icon: ShieldCheck,
    title: 'Your mutual fund account opened in a new tab',
    hint: "Don't see it? Check your browser's tabs, or open it again below.",
  },
  blocked: {
    icon: AlertTriangle,
    title: 'Your browser blocked the new tab',
    hint: 'Allow pop-ups for this site, then open it again.',
    tone: 'warn',
  },
  not_mapped: {
    icon: Hourglass,
    title: 'Your mutual fund account is being set up',
    hint: "Your relationship manager has been notified and will let you know as soon as it's ready.",
  },
  kyc_incomplete: {
    icon: AlertTriangle,
    title: 'Complete your KYC first',
    hint: 'Your PAN needs to be verified before we can open your mutual fund account.',
    tone: 'warn',
  },
  not_available: {
    icon: AlertTriangle,
    title: 'Not available for this login',
    hint: 'Mutual funds open from a client login.',
    tone: 'warn',
  },
  demo: {
    icon: TrendingUp,
    title: 'Not available in the sample portal',
    hint: 'In a live account this opens your mutual fund holdings, signed in.',
  },
  error: {
    icon: AlertTriangle,
    title: "We couldn't open your mutual fund account",
    hint: 'Please try again in a moment. If it keeps happening, raise a ticket from Support.',
    tone: 'warn',
  },
};

/** What the Mutual Funds view shows now that funds run on Wylth. */
export function WylthLaunchPage({ state, onLaunch, onNavigate }: Props) {
  const c = COPY[state];
  const Icon = c.icon;
  const busy = state === 'opening';
  const canRelaunch = state !== 'not_mapped' && state !== 'kyc_incomplete' && state !== 'not_available' && state !== 'demo';

  return (
    <div className="mx-auto max-w-lg py-10">
      <Tile className="text-center">
        <Icon
          className={`mx-auto mb-4 h-9 w-9 ${c.tone === 'warn' ? 'text-danger' : 'text-accent'} ${busy ? 'animate-spin' : ''}`}
        />
        <h2 className="text-base font-semibold text-text-primary">{c.title}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-text-secondary">{c.hint}</p>
        <div className="mt-6 flex justify-center gap-3">
          {canRelaunch && (
            <PortalButton variant="primary" icon={ExternalLink} onClick={onLaunch} disabled={busy}>
              {state === 'idle' ? 'Open Mutual Funds' : 'Open again'}
            </PortalButton>
          )}
          {state === 'kyc_incomplete' && (
            <PortalButton variant="primary" onClick={() => onNavigate('onboarding')}>
              Complete KYC
            </PortalButton>
          )}
          {state === 'error' && (
            <PortalButton variant="secondary" onClick={() => onNavigate('support')}>
              Support
            </PortalButton>
          )}
        </div>
      </Tile>
    </div>
  );
}
