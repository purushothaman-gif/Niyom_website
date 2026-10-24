/**
 * Partner Portal navigation — the single source of truth for the sidebar.
 * Adding a page is a data change here, not a structural one.
 * Mirrors src/portal/layout/navigation.ts.
 */
import {
  LayoutDashboard,
  Users,
  Wallet,
  Landmark,
  Gem,
  Share2,
  UserPlus,
  ClipboardList,
  UserRound,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

/** Every routable view in the partner portal. */
export type PartnerView =
  | 'dashboard'
  | 'clients'
  | 'bonds'
  | 'unlisted-shares'
  | 'mutual-funds'
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
      { view: 'bonds', key: 'bonds', label: 'Bonds', icon: Landmark },
      { view: 'unlisted-shares', key: 'unlisted-shares', label: 'Unlisted Shares', icon: Gem },
      // Partner SSO isn't specced yet; Sidebar hides this until VITE_MF_SSO_STAFF.
      { view: 'mutual-funds', key: 'mutual-funds', label: 'Mutual Funds', icon: TrendingUp },
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

/**
 * Drop switched-off products (see src/lib/productAccess.ts). Item keys ARE the
 * product keys; groups left empty disappear.
 */
export function withoutProducts(groups: NavGroup[], hidden: ReadonlySet<string>): NavGroup[] {
  if (hidden.size === 0) return groups;
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !hidden.has(i.key)) }))
    .filter((g) => g.items.length > 0);
}

/** Human-readable titles for the topbar. */
export const VIEW_TITLES: Record<PartnerView, string> = {
  dashboard: 'Partner Dashboard',
  clients: 'My Clients',
  bonds: 'Bonds',
  'unlisted-shares': 'Unlisted Shares',
  'mutual-funds': 'Mutual Funds',
  payouts: 'Payouts & Statements',
  referral: 'Referral Link',
  'submit-lead': 'Submit a Lead',
  leads: 'My Leads',
  profile: 'Profile',
};

/** Every valid view, derived so the router can never drift from the nav. */
export const PARTNER_VIEWS = Object.keys(VIEW_TITLES) as PartnerView[];
