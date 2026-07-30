import { KeyRound, LogOut, Menu, RefreshCw } from 'lucide-react';
import { ThemeToggle } from '../../theme/ThemeToggle';
import type { PartnerIdentity } from '../types';

interface TopbarProps {
  title: string;
  partner: PartnerIdentity | null;
  refreshing: boolean;
  onOpenMobile: () => void;
  onRefresh: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
}

/** Sticky top bar. Mirrors the client portal's, but the identity chip shows the
 *  partner's DSA code rather than a client code. */
export function Topbar({
  title,
  partner,
  refreshing,
  onOpenMobile,
  onRefresh,
  onChangePassword,
  onLogout,
}: TopbarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border-subtle bg-header px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobile}
          className="flex h-9 w-9 items-center justify-center rounded-token-md text-text-muted transition-colors hover:bg-hover hover:text-text-primary lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-base font-bold text-text-primary sm:text-lg">{title}</h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onRefresh}
          className="flex h-9 w-9 items-center justify-center rounded-token-md border border-border bg-bg-surface text-text-muted transition-colors hover:text-accent"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>

        <ThemeToggle variant="icon" />

        {partner && (
          <div className="hidden items-center gap-2 rounded-token-lg border border-border bg-bg-surface px-3 py-1.5 sm:flex">
            <div className="flex h-7 w-7 items-center justify-center rounded-token-sm bg-accent/15 text-xs font-bold text-accent">
              {partner.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="leading-tight">
              <p className="text-xs font-semibold text-text-primary">{partner.full_name}</p>
              <p className="mt-0.5 font-mono text-[11px] text-text-secondary">{partner.dsa_code}</p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onChangePassword}
          className="flex h-9 w-9 items-center justify-center rounded-token-md border border-border bg-bg-surface text-text-muted transition-colors hover:text-accent sm:w-auto sm:gap-2 sm:px-3"
          title="Change password"
        >
          <KeyRound className="h-4 w-4" />
          <span className="hidden text-xs font-semibold sm:inline">Password</span>
        </button>

        <button
          type="button"
          onClick={onLogout}
          className="flex h-9 w-9 items-center justify-center rounded-token-md border border-border bg-bg-surface text-text-muted transition-colors hover:text-danger sm:w-auto sm:gap-2 sm:px-3"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden text-xs font-semibold sm:inline">Sign Out</span>
        </button>
      </div>
    </header>
  );
}
