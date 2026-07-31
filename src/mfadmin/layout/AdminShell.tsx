/**
 * App frame for the MF Admin console.
 *
 * Two levels of navigation: sections across the top, and the active section's
 * screens in a left rail. With ~23 screens a single flat sidebar becomes a
 * scroll-and-hunt exercise; this keeps everything two clicks away and gives
 * each section room to grow.
 *
 * The rail folds into a sheet under the header on small screens rather than
 * disappearing, because staff do use this on a phone between client meetings.
 */
import { useState, type ReactNode } from 'react';
import { LogOut, Menu, RefreshCw, X } from 'lucide-react';
import type { NWEmployee } from '../../crm/types';
import { EmployeeAvatar } from '../../crm/EmployeeAvatar';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { EnvBadge, useBseEnv } from '../features/bse/EnvBadge';
import { ADMIN_SECTIONS, sectionForView, type AdminView } from './adminNav';

interface Props {
  view: AdminView;
  title: string;
  employee: NWEmployee | null;
  refreshing: boolean;
  onNavigate: (view: AdminView) => void;
  onRefresh: () => void;
  onLogout: () => void;
  children: ReactNode;
}

export function AdminShell({
  view,
  employee,
  refreshing,
  onNavigate,
  onRefresh,
  onLogout,
  children,
}: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const env = useBseEnv();
  const section = sectionForView(view);
  const showRail = section.items.length > 1;

  const go = (v: AdminView) => {
    onNavigate(v);
    setMobileOpen(false);
  };

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      {/* ---- Header: brand, sections, account ---- */}
      <header className="sticky top-0 z-30 border-b border-border-subtle bg-header/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1560px] items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            className="-ml-1 rounded-token-md p-2 text-text-secondary hover:text-accent lg:hidden"
            aria-label="Menu"
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => go('dashboard')}
            className="flex shrink-0 items-center gap-2.5 text-left"
          >
            <img src="/niyomlogo.png" alt="Niyom Wealth" className="h-7 w-auto object-contain" />
            <span className="hidden leading-tight border-l border-border pl-2.5 sm:block">
              <span className="block font-display text-[13px] font-bold tracking-tight">
                MF Admin
              </span>
              <span className="block text-[10px] text-text-faint">BSE StAR MF</span>
            </span>
          </button>

          {/* Section tabs — the primary axis of navigation. */}
          <nav className="ml-2 hidden min-w-0 flex-1 items-center gap-0.5 lg:flex">
            {ADMIN_SECTIONS.map((s) => {
              const active = s.id === section.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => go(s.items[0].view)}
                  className={`relative rounded-token-md px-3 py-2 text-[13px] font-semibold transition-colors ${
                    active ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {s.label}
                  {active && (
                    <span className="absolute inset-x-3 -bottom-[9px] h-0.5 rounded-full bg-accent" />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <span className="hidden md:block">
              <EnvBadge env={env} />
            </span>
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-token-md p-2 text-text-secondary hover:text-accent"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <ThemeToggle variant="icon" />
            {employee && (
              <div className="ml-1 hidden items-center gap-2 sm:flex">
                <EmployeeAvatar
                  name={employee.full_name}
                  url={employee.avatar_url}
                  size={28}
                  rounded="full"
                />
                <span className="hidden leading-tight xl:block">
                  <span className="block text-[12px] font-semibold text-text-primary">
                    {employee.full_name}
                  </span>
                  <span className="block text-[10px] text-text-faint">
                    {employee.designation || employee.employee_code}
                  </span>
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={onLogout}
              className="rounded-token-md p-2 text-text-secondary hover:text-danger"
              aria-label="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Mobile: sections + their screens in one sheet. */}
        {mobileOpen && (
          <div className="max-h-[70vh] overflow-y-auto border-t border-border-subtle bg-header px-4 py-3 lg:hidden">
            {ADMIN_SECTIONS.map((s) => (
              <div key={s.id} className="mb-3 last:mb-0">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-text-faint">
                  {s.label}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {s.items.map((it) => (
                    <button
                      key={it.view}
                      type="button"
                      onClick={() => go(it.view)}
                      className={`rounded-token-md border px-2.5 py-1.5 text-[11px] font-semibold ${
                        it.view === view
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-bg-surface text-text-secondary'
                      }`}
                    >
                      {it.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </header>

      {/* ---- Body: contextual rail + content ---- */}
      <div className="mx-auto w-full max-w-[1560px] px-4 py-6 sm:px-6 lg:py-8">
        <div className={showRail ? 'lg:grid lg:grid-cols-[212px_minmax(0,1fr)] lg:gap-7' : ''}>
          {showRail && (
            <aside className="hidden lg:block">
              <div className="sticky top-[76px]">
                <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-text-faint">
                  {section.label}
                </p>
                <nav className="space-y-0.5">
                  {section.items.map((it) => {
                    const active = it.view === view;
                    const Icon = it.icon;
                    return (
                      <button
                        key={it.view}
                        type="button"
                        onClick={() => go(it.view)}
                        className={`flex w-full items-center gap-2.5 rounded-token-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors ${
                          active
                            ? 'bg-accent/10 text-accent'
                            : 'text-text-secondary hover:bg-bg-surface hover:text-text-primary'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 truncate">{it.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </div>
            </aside>
          )}
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
