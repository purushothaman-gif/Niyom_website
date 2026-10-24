import { Briefcase, Download, FileText, PlusCircle, RefreshCw, TrendingUp, type LucideIcon } from 'lucide-react';
import type { PortalView } from '../../../layout/navigation';
import { mfSsoEnabled } from '../../../../../shared/platform/env';

interface Action {
  label: string;
  icon: LucideIcon;
  view: PortalView;
}

const ACTIONS: Action[] = [
  { label: 'Invest', icon: PlusCircle, view: 'mutual-funds' },
  { label: 'Start SIP', icon: TrendingUp, view: 'sip' },
  { label: 'Redeem', icon: RefreshCw, view: 'mutual-funds' },
  { label: 'Statement', icon: Download, view: 'reports' },
];

/*
 * On the MF platform, invest / SIP / redeem all happen inside the platform, so
 * one Mutual Funds tile opens it and the other slots go to pages every client has.
 */
const MF_PLATFORM_ACTIONS: Action[] = [
  { label: 'Mutual Funds', icon: TrendingUp, view: 'mutual-funds' },
  { label: 'Portfolio', icon: Briefcase, view: 'portfolio' },
  { label: 'Transactions', icon: FileText, view: 'transactions' },
  { label: 'Statement', icon: Download, view: 'reports' },
];

export function QuickActions({ onNavigate }: { onNavigate: (view: PortalView) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(mfSsoEnabled() ? MF_PLATFORM_ACTIONS : ACTIONS).map((a, i) => (
        <button
          key={a.label}
          type="button"
          onClick={() => onNavigate(a.view)}
          className={`lift flex flex-col items-center justify-center gap-2 rounded-token-xl border border-border bg-bg-elevated py-5 shadow-token-card transition-colors hover:border-accent/40 animate-fadeInUp ${
            ['', 'animate-delay-100', 'animate-delay-200', 'animate-delay-300'][i] ?? ''
          }`}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-token-lg bg-accent/10">
            <a.icon className="h-5 w-5 text-accent" />
          </span>
          <span className="text-xs font-semibold text-text-primary">{a.label}</span>
        </button>
      ))}
    </div>
  );
}
