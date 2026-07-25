/**
 * Portal navigation — the single source of truth for the sidebar.
 * Adding a product or page is a data change here, not a structural one.
 */
import {
  LayoutDashboard,
  PieChart,
  Wallet,
  TrendingUp,
  Landmark,
  PiggyBank,
  ShieldCheck,
  Gem,
  ArrowLeftRight,
  CalendarClock,
  FileText,
  FolderClosed,
  Bell,
  LifeBuoy,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

/** Every routable view in the portal. */
export type PortalView =
  | 'dashboard'
  | 'onboarding'
  | 'portfolio'
  | 'allocation'
  | 'mutual-funds'
  | 'transactions'
  | 'sip'
  | 'reports'
  | 'documents'
  | 'notifications'
  | 'support'
  | 'profile';

export interface NavItem {
  /** Present when the item routes to a view; absent for "Coming Soon" products. */
  view?: PortalView;
  key: string;
  label: string;
  icon: LucideIcon;
  comingSoon?: boolean;
}

export interface NavGroup {
  /** Section caption; omitted for the top group. */
  heading?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { view: 'dashboard', key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { view: 'portfolio', key: 'portfolio', label: 'My Portfolio', icon: Wallet },
      { view: 'allocation', key: 'allocation', label: 'Asset Allocation', icon: PieChart },
    ],
  },
  {
    heading: 'Investments',
    items: [
      { view: 'mutual-funds', key: 'mutual-funds', label: 'Mutual Funds', icon: TrendingUp },
      { key: 'bonds', label: 'Bonds', icon: Landmark, comingSoon: true },
      { key: 'fixed-deposits', label: 'Fixed Deposits', icon: PiggyBank, comingSoon: true },
      { key: 'insurance', label: 'Insurance', icon: ShieldCheck, comingSoon: true },
      { key: 'alternate', label: 'Alternate Investments', icon: Gem, comingSoon: true },
    ],
  },
  {
    heading: 'Activity',
    items: [
      { view: 'transactions', key: 'transactions', label: 'Transactions', icon: ArrowLeftRight },
      { view: 'sip', key: 'sip', label: 'SIP', icon: CalendarClock },
      { view: 'reports', key: 'reports', label: 'Reports', icon: FileText },
      { view: 'documents', key: 'documents', label: 'Documents', icon: FolderClosed },
    ],
  },
  {
    heading: 'Account',
    items: [
      { view: 'notifications', key: 'notifications', label: 'Notifications', icon: Bell },
      { view: 'support', key: 'support', label: 'Support', icon: LifeBuoy },
      { view: 'profile', key: 'profile', label: 'Profile', icon: UserRound },
    ],
  },
];

/** Human-readable titles for the topbar breadcrumb. */
export const VIEW_TITLES: Record<PortalView, string> = {
  dashboard: 'Wealth Dashboard',
  onboarding: 'Complete Your KYC',
  portfolio: 'My Portfolio',
  allocation: 'Asset Allocation',
  'mutual-funds': 'Mutual Funds',
  transactions: 'Transactions',
  sip: 'Systematic Plans',
  reports: 'Reports',
  documents: 'Documents',
  notifications: 'Notifications',
  support: 'Support',
  profile: 'Profile',
};
