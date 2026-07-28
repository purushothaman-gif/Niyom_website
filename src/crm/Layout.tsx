import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { NWEmployee, NWAlert, CRMPage } from './types';
import {
  LayoutDashboard, UserPlus, Users, PieChart, ArrowLeftRight,
  FileText, UserCog, Settings, LogOut, Bell, ChevronRight, ChevronDown, X, Home,
  FolderOpen, Shield, BarChart3, Wallet, Handshake, ClipboardList,
  Send, Target, Landmark, LifeBuoy, Megaphone, Sparkles,
} from 'lucide-react';
import { ThemeToggle } from '../theme/ThemeToggle';
import { clearStorageKeepingTrustedDevices } from './mfa';
import { EmployeeAvatar } from './EmployeeAvatar';

interface Props {
  children: React.ReactNode;
  page: CRMPage;
  onNavigate: (page: CRMPage) => void;
  employee: NWEmployee;
}

interface NavItem {
  key: CRMPage;
  label: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
  hideForAdmin?: boolean;
}

// A collapsible parent revealing sub-module items (e.g. Marketing Tool).
interface NavGroup {
  group: string;
  label: string;
  icon: typeof LayoutDashboard;
  children: NavItem[];
}

type NavEntry = NavItem | NavGroup;

const isGroup = (e: NavEntry): e is NavGroup => 'children' in e;

const NAV: NavEntry[] = [
  { key: 'dashboard' as CRMPage,        label: 'Dashboard',         icon: LayoutDashboard },
  { key: 'leads' as CRMPage,            label: 'Leads',             icon: Target },
  { key: 'onboarding' as CRMPage,       label: 'Client Onboarding', icon: UserPlus },
  { key: 'deal_confirmation' as CRMPage, label: 'Deal Confirmation', icon: ClipboardList },
  { key: 'transfer_queue' as CRMPage,   label: 'Transfer Queue',    icon: Send, adminOnly: true },
  { key: 'clients' as CRMPage,          label: 'Manage Clients',    icon: Users },
  { key: 'portfolio' as CRMPage,        label: 'Portfolio',         icon: PieChart },
  { key: 'transactions' as CRMPage,     label: 'Transactions',      icon: ArrowLeftRight },
  { key: 'support_tickets' as CRMPage,  label: 'Support Tickets',   icon: LifeBuoy },
  { key: 'reports' as CRMPage,          label: 'Reports',           icon: FileText },
  {
    group: 'marketing_tool', label: 'Marketing Tool', icon: Megaphone,
    children: [
      { key: 'bonds' as CRMPage,             label: 'Bond Creation',    icon: Landmark },
      { key: 'marketing_content' as CRMPage, label: 'Content Creation', icon: Sparkles },
    ],
  },
  { key: 'mis' as CRMPage,             label: 'MIS Report',        icon: BarChart3 },
  { key: 'dsa_management' as CRMPage,   label: 'DSA Management',    icon: Handshake },
  { key: 'dsa_payout' as CRMPage,      label: 'DSA Payout',        icon: Wallet },
  { key: 'documents' as CRMPage,        label: 'Documents',         icon: FolderOpen, hideForAdmin: true },
  { key: 'admin_documents' as CRMPage,  label: 'Document Vault',    icon: Shield, adminOnly: true },
  { key: 'employees' as CRMPage,        label: 'Employees',         icon: UserCog, adminOnly: true },
  { key: 'settings' as CRMPage,         label: 'Settings',          icon: Settings },
];

// Flat view of every navigable page — used for access filtering and the
// topbar title lookup (group parents are not pages themselves).
const NAV_FLAT: NavItem[] = NAV.flatMap(e => (isGroup(e) ? e.children : [e]));

export default function Layout({ children, page, onNavigate, employee }: Props) {
  const [alerts, setAlerts] = useState<NWAlert[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Which collapsible nav group the user has toggled open. Lives here (not in
  // SidebarContent — that inner component remounts every render). A group with
  // the active page inside it is always held open regardless of this state.
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const unread = alerts.filter(a => !a.read).length;

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      supabase.from('nw_alerts').select('*')
        .eq('employee_id', employee.id).eq('read', false)
        .order('created_at', { ascending: false }).limit(20)
        .then(({ data }) => { if (!cancelled) setAlerts(data || []); });
    };
    load();
    // Light polling so new admin alerts (lead dropped / ready to assign) surface
    // without a full page refresh.
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [employee.id]);

  const markAllRead = async () => {
    await supabase.from('nw_alerts').update({ read: true }).eq('employee_id', employee.id).eq('read', false);
    setAlerts([]);
  };

  // Click an alert → mark it read and jump to the linked CRM page.
  const openAlert = async (a: NWAlert) => {
    setAlerts(prev => prev.filter(x => x.id !== a.id));
    supabase.from('nw_alerts').update({ read: true }).eq('id', a.id).then(() => {});
    setShowAlerts(false);
    if (a.action_url && a.action_url.includes('/leads')) onNavigate('leads' as CRMPage);
    else if (a.action_url && a.action_url.includes('/support-tickets')) onNavigate('support_tickets' as CRMPage);
    else if (a.action_url && a.action_url.includes('/clients')) onNavigate('clients' as CRMPage);
  };

  const canSee = (n: NavItem) => (!n.adminOnly || isAdmin) && !(n.hideForAdmin && isAdmin);
  // Filter leaf items by role; groups filter their children and disappear
  // entirely if nothing inside them is visible.
  const navEntries: NavEntry[] = NAV.flatMap<NavEntry>(e => {
    if (isGroup(e)) {
      const children = e.children.filter(canSee);
      return children.length ? [{ ...e, children }] : [];
    }
    return canSee(e) ? [e] : [];
  });

  const goHome = () => {
    window.location.href = '/';
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Brand logo */}
      <div className="px-5 py-5 flex items-center gap-3" style={{ borderBottom: '1px solid rgba(var(--accent-soft-rgb),0.15)' }}>
        <img src="/niyomlogo.png" alt="Niyom Wealth" className="h-9 w-auto object-contain flex-shrink-0" />
        <div className="overflow-hidden">
          <p className="font-bold text-sm leading-none truncate" style={{ color: 'var(--accent-soft)' }}>Niyom Wealth</p>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>CRM Platform</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navEntries.map(entry => {
          if (isGroup(entry)) {
            const { group, label, icon: Icon, children } = entry;
            const childActive = children.some(c => c.key === page);
            const open = openGroup === group || childActive;
            return (
              <div key={group}>
                <button onClick={() => setOpenGroup(g => (g === group ? null : group))}
                  className={`crm-nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${childActive ? 'is-active' : ''}`}>
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  <span className="truncate">{label}</span>
                  <ChevronDown className={`w-3.5 h-3.5 ml-auto flex-shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
                </button>
                {open && (
                  <div className="mt-0.5 space-y-0.5 pl-3 ml-3.5" style={{ borderLeft: '1px solid rgba(var(--accent-soft-rgb),0.15)' }}>
                    {children.map(({ key, label: childLabel, icon: ChildIcon }) => {
                      const active = page === key;
                      return (
                        <button key={key} onClick={() => {
                          window.history.pushState({}, '', `/crm/${key}`);
                          onNavigate(key);
                          setMobileOpen(false);
                        }}
                          className={`crm-nav-item w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all ${active ? 'is-active' : ''}`}>
                          <ChildIcon className="w-4 h-4 flex-shrink-0" />
                          <span className="truncate">{childLabel}</span>
                          {active && <ChevronRight className="w-3.5 h-3.5 ml-auto flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }
          const { key, label, icon: Icon } = entry;
          const active = page === key;
          return (
            <button key={key} onClick={() => {
  window.history.pushState({}, '', `/crm/${key}`);
  onNavigate(key);
  setMobileOpen(false);
}}
              className={`crm-nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${active ? 'is-active' : ''}`}>
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{label}</span>
              {active && <ChevronRight className="w-3.5 h-3.5 ml-auto flex-shrink-0" />}
            </button>
          );
        })}

        {/* Divider */}
        <div className="my-2" style={{ borderTop: '1px solid rgba(var(--accent-soft-rgb),0.08)' }} />

        {/* Back to Home */}
        <button onClick={goHome}
          className="crm-nav-link w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all">
          <Home className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">Back to Website</span>
        </button>
      </nav>

      {/* Employee card */}
      <div className="px-3 pb-4" style={{ borderTop: '1px solid rgba(var(--accent-soft-rgb),0.1)' }}>
        <div className="mt-4 p-3 rounded-xl flex items-center gap-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <EmployeeAvatar name={employee.full_name} url={employee.avatar_url} size={36} rounded="xl"
            badgeStyle={{ background: 'rgba(var(--accent-soft-rgb),0.15)', color: 'var(--accent-soft)' }} />
          <div className="flex-1 overflow-hidden min-w-0">
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{employee.full_name}</p>
            <p className="text-xs truncate" style={{ color: 'var(--text-faint)' }}>{employee.employee_code}</p>
          </div>
          <button onClick={async () => { await supabase.auth.signOut(); clearStorageKeepingTrustedDevices(); window.location.replace('/crm'); }} className="crm-icon-danger p-1.5 rounded-lg transition-colors flex-shrink-0">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-60 flex-shrink-0" style={{ background: 'var(--sidebar-bg)', borderRight: '1px solid var(--border-subtle)' }}>
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0" style={{ background: 'var(--bg-overlay)' }} onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 flex flex-col" style={{ background: 'var(--sidebar-bg)', borderRight: '1px solid var(--border-subtle)' }}>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ background: 'var(--header-bg)', borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-3">
            <button className="lg:hidden p-2 rounded-lg" style={{ color: 'var(--text-secondary)' }} onClick={() => setMobileOpen(true)}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div>
              <p className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{NAV_FLAT.find(n => n.key === page)?.label || 'Dashboard'}</p>
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Theme toggle */}
            <ThemeToggle variant="icon" />

            {/* Alerts bell */}
            <div className="relative">
              <button onClick={() => setShowAlerts(s => !s)}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors relative"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                <Bell className="w-4 h-4" />
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-xs flex items-center justify-center font-bold"
                    style={{ background: 'var(--accent-soft)', color: 'var(--text-on-accent)' }}>
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
              {showAlerts && (
                <div className="absolute right-0 top-12 w-80 rounded-2xl shadow-2xl z-50 overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Notifications</p>
                    <div className="flex items-center gap-2">
                      {unread > 0 && <button onClick={markAllRead} className="text-xs" style={{ color: 'var(--accent-soft)' }}>Mark all read</button>}
                      <button onClick={() => setShowAlerts(false)} style={{ color: 'var(--text-faint)' }}><X className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {alerts.length === 0 ? (
                      <p className="text-sm text-center py-8" style={{ color: 'var(--text-faint)' }}>No new notifications</p>
                    ) : alerts.map(a => (
                      <button key={a.id} onClick={() => openAlert(a)}
                        className="w-full text-left px-4 py-3 transition-colors hover:bg-[var(--hover-bg)]"
                        style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{a.title}</p>
                        {a.message && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{a.message}</p>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Role badge */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <EmployeeAvatar name={employee.full_name} url={employee.avatar_url} size={24} rounded="lg"
                badgeStyle={{ background: 'rgba(var(--accent-soft-rgb),0.15)', color: 'var(--accent-soft)' }} />
              <div className="hidden md:block">
                <p className="text-xs font-semibold leading-none" style={{ color: 'var(--text-primary)' }}>{employee.full_name.split(' ')[0]}</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{employee.designation ?? 'Relationship Manager'}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Page content — keyed by page so each navigation re-plays a subtle
            fade + rise (see .crm-page-enter). */}
        <main className="flex-1 overflow-y-auto p-6">
          <div key={page} className="crm-page-enter">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
