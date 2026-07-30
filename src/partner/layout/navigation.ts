/**
 * Partner Portal navigation — the single source of truth for the sidebar.
 * Adding a page is a data change here, not a structural one.
 * Mirrors src/portal/layout/navigation.ts.
 */
import {
  LayoutDashboard,
  Users,
  Wallet,
  Share2,
  UserPlus,
  ClipboardList,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

/** Every routable view in the partner portal. */
export type PartnerView =
  | 'dashboard'
  | 'clients'
  | 'payouts'
  | 'referral'
  | 'submit-lead'
  | 'leads'
  | 'profile';

export interface NavItem {
  /** Present when the item routes to a view; absent for "Coming Soon" entries. */
  view?: PartnerView;
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
    items: [{ view: 'dashboard', key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    heading: 'Business',
    items: [
      { view: 'clients', key: 'clients', label: 'My Clients', icon: Users },
      { view: 'leads', key: 'leads', label: 'My Leads', icon: ClipboardList },
    ],
  },
  {
    heading: 'Earnings',
    items: [{ view: 'payouts', key: 'payouts', label: 'Payouts & Statements', icon: Wallet }],
  },
  {
    heading: 'Growth',
    items: [
      { view: 'referral', key: 'referral', label: 'Referral Link', icon: Share2 },
      { view: 'submit-lead', key: 'submit-lead', label: 'Submit a Lead', icon: UserPlus },
    ],
  },
  {
    heading: 'Account',
    items: [{ view: 'profile', key: 'profile', label: 'Profile', icon: UserRound }],
  },
];

/** Human-readable titles for the topbar. */
export const VIEW_TITLES: Record<PartnerView, string> = {
  dashboard: 'Partner Dashboard',
  clients: 'My Clients',
  payouts: 'Payouts & Statements',
  referral: 'Referral Link',
  'submit-lead': 'Submit a Lead',
  leads: 'My Leads',
  profile: 'Profile',
};

/** Every valid view, derived so the router can never drift from the nav. */
export const PARTNER_VIEWS = Object.keys(VIEW_TITLES) as PartnerView[];
