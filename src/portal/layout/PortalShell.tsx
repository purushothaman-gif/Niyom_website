/**
 * App frame for the client portal.
 *
 * Two different shapes for two different contexts. On desktop the sections sit
 * across the top with a contextual rail, matching the admin console so the two
 * products feel related. On a phone the navigation moves to a bottom tab bar —
 * investors check a portfolio one-handed, and a hamburger buries exactly the
 * screens they open most.
 */
import { useState, type ReactNode } from 'react';
import { KeyRound, LogOut, MoreHorizontal, RefreshCw, X } from 'lucide-react';
import type { NWClient } from '../../crm/types';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { NAV_GROUPS, PRIMARY_VIEWS, type PortalView } from './navigation';

interface PortalShellProps {
  view: PortalView;
  title: string;
  client: NWClient | null;
  refreshing: boolean;
  onNavigate: (view: PortalView) => void;
  onRefresh: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
  children: ReactNode;
}

export function PortalShell({
  view,
  client,
  refreshing,
  onNavigate,
  onRefresh,
  onChangePassword,
  onLogout,
  children,
}: PortalShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const go = (v: PortalView) => {
    onNavigate(v);
    setMoreOpen(false);
  };

  const primaryViews = PRIMARY_VIEWS.map((p) => p.view);

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      {/* ---- Header ---- */}
      <header className="sticky top-0 z-30 border-b border-border-subtle bg-header/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => go('dashboard')}
            className="flex shrink-0 items-center gap-2.5 text-left"
          >
            <img src="/niyomlogo.png" alt="Niyom Wealth" className="h-7 w-auto object-contain" />
          </button>

          {/* Desktop navigation. */}
          <nav className="ml-3 hidden min-w-0 flex-1 items-center gap-0.5 lg:flex">
            {NAV_GROUPS.flatMap((g) => g.items)
              .filter((i) => i.view && !i.comingSoon)
              .map((i) => {
                const active = i.view === view;
                return (
                  <button
                    key={i.key}
                    type="button"
                    onClick={() => go(i.view!)}
                    className={`relative rounded-token-md px-2.5 py-2 text-[13px] font-semibold transition-colors ${
                      active ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {i.label}
                    {active && (
                      <span className="absolute inset-x-2.5 -bottom-[9px] h-0.5 rounded-full bg-accent" />
                    )}
                  </button>
                );
              })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-token-md p-2 text-text-secondary hover:text-accent"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <ThemeToggle variant="icon" />
            {client && (
              <button
                type="button"
                onClick={() => go('profile')}
                className="ml-1 flex items-center gap-2 rounded-token-md px-1.5 py-1 hover:bg-bg-surface"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-bold text-accent">
                  {client.full_name.charAt(0).toUpperCase()}
                </span>
                <span className="hidden leading-tight sm:block">
                  <span className="block text-[12px] font-semibold text-text-primary">
                    {client.full_name.split(' ')[0]}
                  </span>
                  <span className="block font-mono text-[10px] text-text-faint">
                    {client.client_code}
                  </span>
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={onLogout}
              className="hidden rounded-token-md p-2 text-text-secondary hover:text-danger sm:block"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* ---- Content. Bottom padding clears the mobile tab bar. ---- */}
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 pb-28 sm:px-6 lg:pb-8">
        {children}
      </main>

      {/* ---- Mobile tab bar ---- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border-subtle bg-header/95 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch">
          {PRIMARY_VIEWS.map((p) => {
            const active = p.view === view;
            const Icon = p.icon;
            return (
              <button
                key={p.view}
                type="button"
                onClick={() => go(p.view)}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors ${
                  active ? 'text-accent' : 'text-text-faint'
                }`}
              >
                <Icon className="h-5 w-5" />
                {p.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-semibold transition-colors ${
              !primaryViews.includes(view) ? 'text-accent' : 'text-text-faint'
            }`}
          >
            <MoreHorizontal className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>

      {/* ---- "More" sheet ---- */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-bg-overlay"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-token-xl border-t border-border bg-bg-elevated p-5 pb-8">
            <div className="mb-4 flex items-center justify-between">
              <p className="font-display text-base font-bold text-text-primary">Everything else</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="rounded-token-md p-1.5 text-text-secondary hover:text-accent"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {NAV_GROUPS.map((group, gi) => (
              <div key={group.heading ?? gi} className="mb-4 last:mb-0">
                {group.heading && (
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-faint">
                    {group.heading}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {group.items.map((i) => {
                    const Icon = i.icon;
                    // Products we don't offer yet are shown, but plainly
                    // disabled — hiding them makes the roadmap invisible.
                    if (i.comingSoon || !i.view) {
                      return (
                        <span
                          key={i.key}
                          className="flex items-center gap-2 rounded-token-md border border-border-subtle px-3 py-2.5 text-[13px] text-text-faint"
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 truncate">{i.label}</span>
                          <span className="ml-auto shrink-0 text-[9px] uppercase">soon</span>
                        </span>
                      );
                    }
                    return (
                      <button
                        key={i.key}
                        type="button"
                        onClick={() => go(i.view!)}
                        className={`flex items-center gap-2 rounded-token-md border px-3 py-2.5 text-left text-[13px] font-medium ${
                          i.view === view
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border bg-bg-surface text-text-primary'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 truncate">{i.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="mt-5 grid grid-cols-2 gap-2 border-t border-border-subtle pt-4">
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  onChangePassword();
                }}
                className="flex items-center gap-2 rounded-token-md border border-border bg-bg-surface px-3 py-2.5 text-[13px] font-medium text-text-primary"
              >
                <KeyRound className="h-4 w-4" /> Password
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-2 rounded-token-md border border-danger-soft/30 px-3 py-2.5 text-[13px] font-medium text-danger-soft"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
