import { useState, type ReactNode } from 'react';
import { Gem, Landmark, LayoutDashboard, MoreHorizontal, Sparkles, Users } from 'lucide-react';
import { MobileTabBar } from '../../components/mobile/MobileTabBar';
import { isDemoSession } from '../demo/demoData';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { getDb } from '../../../shared/platform/db';
import { MarketTicker } from '../../components/marketWatch/MarketTicker';
import type { PartnerView } from './navigation';
import type { PartnerIdentity } from '../types';

interface PartnerShellProps {
  view: PartnerView;
  title: string;
  partner: PartnerIdentity | null;
  refreshing: boolean;
  onNavigate: (view: PartnerView) => void;
  onRefresh: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
  hiddenProducts: ReadonlySet<string>;
  children: ReactNode;
}

const PRIMARY_TABS: { view: PartnerView; label: string; icon: typeof Users }[] = [
  { view: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { view: 'clients', label: 'Clients', icon: Users },
  { view: 'bonds', label: 'Bonds', icon: Landmark },
  { view: 'unlisted-shares', label: 'Shares', icon: Gem },
];

/** App frame: persistent sidebar + sticky topbar + scrolling content region.
 *  Structural mirror of PortalShell, typed to PartnerIdentity. */
export function PartnerShell({
  view,
  title,
  partner,
  refreshing,
  onNavigate,
  onRefresh,
  onChangePassword,
  onLogout,
  hiddenProducts,
  children,
}: PartnerShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      <div className="flex">
        <Sidebar
          view={view}
          onNavigate={onNavigate}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          mobileOpen={mobileOpen}
          onCloseMobile={() => setMobileOpen(false)}
          hiddenProducts={hiddenProducts}
          partner={partner}
          onChangePassword={onChangePassword}
          onLogout={onLogout}
        />

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <Topbar
            title={title}
            partner={partner}
            refreshing={refreshing}
            onOpenMobile={() => setMobileOpen(true)}
            onRefresh={onRefresh}
            onChangePassword={onChangePassword}
            onLogout={onLogout}
          />

          {/* Headline market strip (NIFTY, SENSEX, gold, silver) → Market Watch. */}
          <MarketTicker db={getDb('partner')} onOpen={() => onNavigate('market-watch')} />

          {/* Sample-data banner. Deliberately persistent and above the content
              rather than a dismissible toast: these credentials are handed to
              prospects, and nobody should mistake the figures below for a real
              partner's clients or earnings. */}
          {isDemoSession() && (
            <div
              className="flex items-center justify-center gap-2 px-4 py-2 text-center text-xs font-semibold"
              style={{
                background: 'rgba(245,158,11,0.12)',
                color: 'var(--warning)',
                borderBottom: '1px solid rgba(245,158,11,0.25)',
              }}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span>
                Sample portal — every client, statement and figure shown here is made up,
                for demonstration only.
              </span>
            </div>
          )}

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-28 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>

      {/* Phone/tablet navigation: the four screens a partner opens most, and
          "More" for the full drawer (which also holds Password and Sign out). */}
      <MobileTabBar
        label="Partner portal"
        tabs={[
          ...PRIMARY_TABS.filter((t) => !hiddenProducts.has(t.view)).map((t) => ({
            key: t.view,
            label: t.label,
            icon: t.icon,
            active: !mobileOpen && view === t.view,
            onSelect: () => onNavigate(t.view),
          })),
          {
            key: 'more',
            label: 'More',
            icon: MoreHorizontal,
            active: mobileOpen || !PRIMARY_TABS.some((t) => t.view === view),
            onSelect: () => setMobileOpen(true),
          },
        ]}
      />
    </div>
  );
}
