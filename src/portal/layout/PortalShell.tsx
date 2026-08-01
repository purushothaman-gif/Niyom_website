/**
 * App frame for the client portal.
 *
 * Two different shapes for two different contexts. On desktop the header holds
 * four grouped menus rather than the eleven-link row it used to be — the row
 * gave a fund page and a password screen exactly the same weight, and left no
 * space to say what any of them were. On a phone the navigation moves to a
 * bottom tab bar: investors check a portfolio one-handed, and a hamburger
 * buries exactly the screens they open most.
 *
 * The frame also owns the page header (title + a line saying what the screen is
 * for). Before, `title` was passed in and never rendered, so every screen began
 * with content and no name.
 */
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown, KeyRound, LogOut, MoreHorizontal, RefreshCw, X } from 'lucide-react';
import type { NWClient } from '../../crm/types';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { ClientAvatar } from '../components/ClientAvatar';
import {
  ACCOUNT_ITEMS,
  HEADER_LINKS,
  HEADER_MENUS,
  NAV_GROUPS,
  PRIMARY_VIEWS,
  VIEW_SUBTITLES,
  type NavGroup,
  type NavItem,
  type PortalView,
} from './navigation';

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
  title,
  client,
  refreshing,
  onNavigate,
  onRefresh,
  onChangePassword,
  onLogout,
  children,
}: PortalShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  /** Which header menu is open, by heading; null when none is. */
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  /*
   * BOTH menu roots have to be known here. The dismiss-on-outside-click handler
   * runs on mousedown, and a mousedown it considers "outside" unmounts the menu
   * before the browser can deliver the click — so anything not covered by these
   * refs looks clickable and does nothing. The account menu was exactly that:
   * its items live outside the nav, so every one of them was dead on arrival.
   */
  const navRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  // A click anywhere else, or Escape, closes the open menu.
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inside =
        navRef.current?.contains(target) || accountRef.current?.contains(target);
      if (!inside) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenMenu(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  const go = (v: PortalView) => {
    onNavigate(v);
    setMoreOpen(false);
    setOpenMenu(null);
  };

  const primaryViews = PRIMARY_VIEWS.map((p) => p.view);
  const subtitle = VIEW_SUBTITLES[view];
  const accountActive = ACCOUNT_ITEMS.some((i) => i.view === view);

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      {/* ---- Header ---- */}
      <header className="sticky top-0 z-30 border-b border-border-subtle bg-header/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center gap-4 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => go('dashboard')}
            className="flex shrink-0 items-center gap-2.5 text-left"
            aria-label="Niyom Wealth — dashboard"
          >
            <img
              src="/niyomlogo.png"
              alt="Niyom Wealth"
              className="h-10 w-auto object-contain sm:h-11"
            />
          </button>

          {/* Desktop navigation: one link + three menus. */}
          <div ref={navRef} className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
            {HEADER_LINKS.filter((i) => i.view).map((i) => (
              <TopButton key={i.key} active={i.view === view} onClick={() => go(i.view!)}>
                {i.label}
              </TopButton>
            ))}

            {HEADER_MENUS.map((group) => {
              const heading = group.heading!;
              const active = group.items.some((i) => i.view === view);
              const open = openMenu === heading;
              return (
                <div key={heading} className="relative">
                  <TopButton
                    active={active}
                    onClick={() => setOpenMenu(open ? null : heading)}
                    aria-expanded={open}
                    aria-haspopup="menu"
                  >
                    {heading}
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                  </TopButton>

                  {open && (
                    <div
                      role="menu"
                      className="absolute left-0 top-[calc(100%+10px)] z-40 w-[330px] overflow-hidden rounded-token-xl border border-border bg-bg-elevated p-1.5 shadow-token-lg"
                    >
                      {group.items.map((item) => (
                        <MenuRow
                          key={item.key}
                          item={item}
                          active={item.view === view}
                          onClick={() => item.view && go(item.view)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-token-md p-2 text-text-secondary transition-colors hover:text-accent"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <ThemeToggle variant="icon" />

            {client && (
              <div className="relative ml-1" ref={accountRef}>
                <button
                  type="button"
                  onClick={() => setOpenMenu(openMenu === 'account' ? null : 'account')}
                  aria-expanded={openMenu === 'account'}
                  aria-haspopup="menu"
                  className={`flex items-center gap-2 rounded-token-md px-1.5 py-1 transition-colors hover:bg-bg-surface ${
                    accountActive ? 'text-accent' : ''
                  }`}
                >
                  <ClientAvatar name={client.full_name} url={client.avatar_url} size={32} />
                  <span className="hidden leading-tight sm:block">
                    <span className="block text-[12px] font-semibold text-text-primary">
                      {client.full_name.split(' ')[0]}
                    </span>
                    <span className="block font-mono text-[10px] text-text-faint">
                      {client.client_code}
                    </span>
                  </span>
                  <ChevronDown className="hidden h-3.5 w-3.5 text-text-faint sm:block" />
                </button>

                {openMenu === 'account' && (
                  <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+10px)] z-40 w-[300px] overflow-hidden rounded-token-xl border border-border bg-bg-elevated p-1.5 shadow-token-lg"
                  >
                      <div className="flex items-center gap-3 px-2.5 py-2.5">
                        <ClientAvatar name={client.full_name} url={client.avatar_url} size={38} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-text-primary">
                            {client.full_name}
                          </p>
                          <p className="font-mono text-[10px] text-text-faint">
                            {client.client_code}
                          </p>
                        </div>
                      </div>
                      <div className="my-1 border-t border-border-subtle" />
                      {ACCOUNT_ITEMS.map((item) => (
                        <MenuRow
                          key={item.key}
                          item={item}
                          active={item.view === view}
                          onClick={() => item.view && go(item.view)}
                        />
                      ))}
                      <div className="my-1 border-t border-border-subtle" />
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenu(null);
                          onChangePassword();
                        }}
                        className="flex w-full items-center gap-3 rounded-token-md px-2.5 py-2 text-left transition-colors hover:bg-bg-surface"
                      >
                        <KeyRound className="h-4 w-4 shrink-0 text-text-secondary" />
                        <span className="text-[13px] font-semibold text-text-primary">
                          Change password
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={onLogout}
                        className="flex w-full items-center gap-3 rounded-token-md px-2.5 py-2 text-left transition-colors hover:bg-bg-surface"
                      >
                        <LogOut className="h-4 w-4 shrink-0 text-danger-soft" />
                        <span className="text-[13px] font-semibold text-danger-soft">Sign out</span>
                      </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ---- Content. Bottom padding clears the mobile tab bar. ---- */}
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 pb-28 sm:px-6 lg:pb-10">
        {subtitle && (
          <div className="mb-5">
            <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary">
              {title}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-text-secondary">{subtitle}</p>
          </div>
        )}
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
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-token-xl border-t border-border bg-bg-elevated p-5 pb-8">
            <div className="mb-4 flex items-center justify-between">
              {client ? (
                <div className="flex min-w-0 items-center gap-3">
                  <ClientAvatar name={client.full_name} url={client.avatar_url} size={40} />
                  <div className="min-w-0">
                    <p className="truncate font-display text-base font-bold text-text-primary">
                      {client.full_name}
                    </p>
                    <p className="font-mono text-[10px] text-text-faint">{client.client_code}</p>
                  </div>
                </div>
              ) : (
                <p className="font-display text-base font-bold text-text-primary">Everything else</p>
              )}
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="rounded-token-md p-1.5 text-text-secondary hover:text-accent"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {NAV_GROUPS.map((group: NavGroup, gi) => (
              <div key={group.heading ?? gi} className="mb-4 last:mb-0">
                {group.heading && (
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-faint">
                    {group.heading}
                  </p>
                )}
                <div className="space-y-1">
                  {group.items.map((i) => {
                    const Icon = i.icon;
                    // Products we don't offer yet are shown, but plainly
                    // disabled — hiding them makes the roadmap invisible.
                    if (i.comingSoon || !i.view) {
                      return (
                        <span
                          key={i.key}
                          className="flex items-center gap-3 rounded-token-md border border-border-subtle px-3 py-2.5 text-[13px] text-text-faint"
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 truncate">{i.label}</span>
                          <span className="ml-auto shrink-0 text-[9px] uppercase">soon</span>
                        </span>
                      );
                    }
                    const active = i.view === view;
                    return (
                      <button
                        key={i.key}
                        type="button"
                        onClick={() => go(i.view!)}
                        className={`flex w-full items-center gap-3 rounded-token-md border px-3 py-2.5 text-left ${
                          active
                            ? 'border-accent/30 bg-accent/10'
                            : 'border-border bg-bg-surface'
                        }`}
                      >
                        <Icon
                          className={`h-4 w-4 shrink-0 ${active ? 'text-accent' : 'text-text-secondary'}`}
                        />
                        <span className="min-w-0">
                          <span
                            className={`block truncate text-[13px] font-semibold ${
                              active ? 'text-accent' : 'text-text-primary'
                            }`}
                          >
                            {i.label}
                          </span>
                          {i.description && (
                            <span className="block truncate text-[11px] text-text-faint">
                              {i.description}
                            </span>
                          )}
                        </span>
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

/** A top-level header control: the Dashboard link and each menu trigger. */
function TopButton({
  children,
  active,
  onClick,
  ...rest
}: {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-1 rounded-token-md px-3 py-2 text-[13px] font-semibold transition-colors ${
        active ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
      }`}
      {...rest}
    >
      {children}
      {active && <span className="absolute inset-x-3 -bottom-[11px] h-0.5 rounded-full bg-accent" />}
    </button>
  );
}

/** One destination inside a header menu: icon, label, and what it is for. */
function MenuRow({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;

  if (item.comingSoon || !item.view) {
    return (
      <span className="flex items-start gap-3 rounded-token-md px-2.5 py-2 opacity-60">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-text-faint" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold text-text-secondary">{item.label}</span>
          {item.description && (
            <span className="block text-[11px] text-text-faint">{item.description}</span>
          )}
        </span>
        <span className="mt-0.5 shrink-0 rounded-token-sm bg-bg-surface px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-text-faint">
          Soon
        </span>
      </span>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-token-md px-2.5 py-2 text-left transition-colors ${
        active ? 'bg-selected' : 'hover:bg-bg-surface'
      }`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'text-accent' : 'text-text-secondary'}`} />
      <span className="min-w-0">
        <span
          className={`block text-[13px] font-semibold ${active ? 'text-accent' : 'text-text-primary'}`}
        >
          {item.label}
        </span>
        {item.description && (
          <span className="block text-[11px] leading-snug text-text-faint">{item.description}</span>
        )}
      </span>
    </button>
  );
}
