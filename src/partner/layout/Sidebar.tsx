import { KeyRound, LogOut, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import type { PartnerIdentity } from '../types';
import { NAV_GROUPS, withoutProducts, type NavItem, type PartnerView } from './navigation';
import { mfStaffSsoEnabled } from '../../../shared/platform/env';
import { ComingSoonBadge } from '../../portal/components/StatusPill';

interface SidebarProps {
  view: PartnerView;
  onNavigate: (view: PartnerView) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Mobile drawer open state (ignored on desktop). */
  mobileOpen: boolean;
  onCloseMobile: () => void;
  /** Product keys switched off for this partner. */
  hiddenProducts: ReadonlySet<string>;
  /** Shown in the drawer's account block below lg, where the topbar drops them. */
  partner?: PartnerIdentity | null;
  onChangePassword?: () => void;
  onLogout?: () => void;
}

function NavButton({
  item,
  active,
  collapsed,
  onSelect,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  const disabled = item.comingSoon;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      title={collapsed ? item.label : undefined}
      aria-current={active ? 'page' : undefined}
      className={`group flex w-full items-center gap-3 rounded-token-md px-3 py-2 text-sm font-medium transition-colors duration-200 ${
        collapsed ? 'justify-center' : ''
      } ${
        active
          ? 'bg-selected text-accent'
          : disabled
            ? 'cursor-not-allowed text-text-faint'
            : 'text-text-secondary hover:bg-hover hover:text-text-primary'
      }`}
    >
      <Icon
        className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-accent' : ''}`}
        strokeWidth={active ? 2.25 : 1.9}
      />
      {!collapsed && <span className="flex-1 truncate text-left">{item.label}</span>}
      {!collapsed && item.comingSoon && <ComingSoonBadge />}
    </button>
  );
}

/** Partner-portal sidebar. Structural copy of the client portal's, differing
 *  only in the nav table it reads and the "Partner" brand caption. */
export function Sidebar({
  view,
  onNavigate,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  hiddenProducts,
  partner,
  onChangePassword,
  onLogout,
}: SidebarProps) {
  const handleSelect = (item: NavItem) => {
    if (item.comingSoon || !item.view) return;
    onNavigate(item.view);
    onCloseMobile();
  };

  const railWidth = collapsed ? 'lg:w-[76px]' : 'lg:w-[248px]';

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-overlay backdrop-blur-sm lg:hidden"
          onClick={onCloseMobile}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-border bg-bg-elevated transition-transform duration-300 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${railWidth}`}
        style={{ transitionTimingFunction: 'var(--ease-out)' }}
      >
        <div
          className={`flex h-16 items-center gap-2.5 border-b border-border-subtle px-4 ${
            collapsed ? 'lg:justify-center lg:px-0' : ''
          }`}
        >
          <img src="/niyomlogo.png" alt="Niyom Wealth" className="h-8 w-auto object-contain" />
          {!collapsed && (
            <div className="leading-tight">
              <p className="text-sm font-bold text-accent-soft">Niyom Wealth</p>
              <p className="text-[11px] text-text-secondary">Partner Portal</p>
            </div>
          )}
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation"
            className="ml-auto rounded-token-md p-2 text-text-muted hover:text-text-primary lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
          {withoutProducts(NAV_GROUPS, hiddenProducts).map((group, gi) => (
            <div key={group.heading ?? `group-${gi}`} className="space-y-1">
              {group.heading && !collapsed && (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-faint">
                  {group.heading}
                </p>
              )}
              {group.heading && collapsed && (
                <div className="mx-auto mb-1 h-px w-6 bg-border-subtle" />
              )}
              {group.items.filter((item) => item.view !== 'mutual-funds' || mfStaffSsoEnabled()).map((item) => (
                <NavButton
                  key={item.key}
                  item={item}
                  active={!!item.view && item.view === view}
                  collapsed={collapsed}
                  onSelect={() => handleSelect(item)}
                />
              ))}
            </div>
          ))}
        </nav>

        {(onChangePassword || onLogout) && (
          <div className="pb-safe border-t border-border-subtle p-3 lg:hidden">
            {partner && (
              <div className="mb-2 flex items-center gap-2.5 px-2 py-1.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-token-sm bg-accent/15 text-xs font-bold text-accent">
                  {partner.full_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-xs font-semibold text-text-primary">{partner.full_name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-text-secondary">{partner.dsa_code}</p>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {onChangePassword && (
                <button
                  type="button"
                  onClick={() => {
                    onCloseMobile();
                    onChangePassword();
                  }}
                  className="flex items-center justify-center gap-2 rounded-token-md border border-border bg-bg-surface px-3 py-2.5 text-xs font-semibold text-text-secondary hover:text-accent"
                >
                  <KeyRound className="h-4 w-4" /> Password
                </button>
              )}
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="flex items-center justify-center gap-2 rounded-token-md border border-border bg-bg-surface px-3 py-2.5 text-xs font-semibold text-text-secondary hover:text-danger"
                >
                  <LogOut className="h-4 w-4" /> Sign out
                </button>
              )}
            </div>
          </div>
        )}

        <div className="hidden border-t border-border-subtle p-3 lg:block">
          <button
            type="button"
            onClick={onToggleCollapse}
            className={`flex w-full items-center gap-2 rounded-token-md px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:bg-hover hover:text-text-primary ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4" /> Collapse
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
