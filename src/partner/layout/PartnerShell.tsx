import { useState, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { isDemoSession } from '../demo/demoData';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
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
  children: ReactNode;
}

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

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
