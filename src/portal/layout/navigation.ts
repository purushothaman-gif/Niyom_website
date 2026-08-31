/**
 * Portal navigation — the single source of truth for the header and the mobile
 * sheet. Adding a product or page is a data change here, not a structural one.
 *
 * The desktop header used to lay all eleven destinations out in one flat row,
 * which read as a wall of equally-weighted words: "Dashboard My Portfolio Asset
 * Allocation Mutual Funds Transactions SIP Reports Documents Notifications
 * Support Profile". Grouping them puts four words in the header and gives every
 * destination room for a line explaining what it is — so the menu teaches the
 * product instead of just listing it.
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
  Receipt,
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
  | 'bonds'
  | 'unlisted-shares'
  | 'transactions'
  | 'sip'
  | 'reports'
  | 'capital-gains'
  | 'documents'
  | 'notifications'
  | 'support'
  | 'profile';

export interface NavItem {
  /** Present when the item routes to a view; absent for "Coming Soon" products. */
  view?: PortalView;
  key: string;
  label: string;
  /** One line under the label in the header menu and the mobile sheet. */
  description?: string;
  icon: LucideIcon;
  comingSoon?: boolean;
}

export interface NavGroup {
  /** Section caption; omitted for the top group, which renders as a plain link. */
  heading?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      {
        view: 'dashboard',
        key: 'dashboard',
        label: 'Dashboard',
        description: 'Your money at a glance',
        icon: LayoutDashboard,
      },
    ],
  },
  {
    heading: 'Portfolio',
    items: [
      {
        view: 'portfolio',
        key: 'portfolio',
        label: 'My Portfolio',
        description: 'Every holding, valued daily',
        icon: Wallet,
      },
      {
        view: 'allocation',
        key: 'allocation',
        label: 'Asset Allocation',
        description: 'How your money is spread',
        icon: PieChart,
      },
      {
        view: 'capital-gains',
        key: 'capital-gains',
        label: 'Capital Gains',
        description: 'What you owe tax on, year by year',
        icon: Receipt,
      },
      {
        view: 'reports',
        key: 'reports',
        label: 'Reports',
        description: 'Downloadable statements',
        icon: FileText,
      },
    ],
  },
  {
    heading: 'Invest',
    items: [
      {
        view: 'mutual-funds',
        key: 'mutual-funds',
        label: 'Mutual Funds',
        description: 'Explore funds and invest',
        icon: TrendingUp,
      },
      { view: 'bonds', key: 'bonds', label: 'Bonds', description: 'Fixed income', icon: Landmark },
      {
        view: 'unlisted-shares',
        key: 'unlisted-shares',
        label: 'Unlisted Shares',
        description: 'Pre-IPO and unlisted companies',
        icon: Gem,
      },
      {
        key: 'fixed-deposits',
        label: 'Fixed Deposits',
        description: 'Assured returns',
        icon: PiggyBank,
        comingSoon: true,
      },
      {
        key: 'insurance',
        label: 'Insurance',
        description: 'Protection for your family',
        icon: ShieldCheck,
        comingSoon: true,
      },
    ],
  },
  {
    heading: 'Activity',
    items: [
      {
        view: 'transactions',
        key: 'transactions',
        label: 'Transactions',
        description: 'Everything you have bought and sold',
        icon: ArrowLeftRight,
      },
      {
        view: 'sip',
        key: 'sip',
        label: 'SIP',
        description: 'Your systematic plans',
        icon: CalendarClock,
      },
      {
        view: 'documents',
        key: 'documents',
        label: 'Documents',
        description: 'Statements, KYC and confirmations',
        icon: FolderClosed,
      },
    ],
  },
  {
    heading: 'Account',
    items: [
      {
        view: 'profile',
        key: 'profile',
        label: 'Profile',
        description: 'Your details and settings',
        icon: UserRound,
      },
      {
        view: 'notifications',
        key: 'notifications',
        label: 'Notifications',
        description: 'Alerts from your RM',
        icon: Bell,
      },
      {
        view: 'support',
        key: 'support',
        label: 'Support',
        description: 'Raise a ticket, get help',
        icon: LifeBuoy,
      },
    ],
  },
];

/** Groups the desktop header renders as menus — Account lives under the avatar,
 *  and the first (heading-less) group is a plain link. */
export const HEADER_MENUS = NAV_GROUPS.filter((g) => g.heading && g.heading !== 'Account');
export const HEADER_LINKS = NAV_GROUPS.filter((g) => !g.heading).flatMap((g) => g.items);
export const ACCOUNT_ITEMS = NAV_GROUPS.find((g) => g.heading === 'Account')?.items ?? [];

/**
 * The destinations that earn a permanent slot in the mobile tab bar.
 *
 * Chosen by what an investor opens repeatedly — check the portfolio, invest,
 * watch the SIP — not by mirroring the header. Everything else lives behind
 * "More", which is where infrequent-but-necessary screens belong.
 */
export const PRIMARY_VIEWS: { view: PortalView; label: string; icon: LucideIcon }[] = [
  { view: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { view: 'portfolio', label: 'Portfolio', icon: Wallet },
  { view: 'mutual-funds', label: 'Invest', icon: TrendingUp },
  { view: 'sip', label: 'SIP', icon: CalendarClock },
];

/** Human-readable titles for the page header. */
export const VIEW_TITLES: Record<PortalView, string> = {
  dashboard: 'Wealth Dashboard',
  onboarding: 'Complete Your KYC',
  portfolio: 'My Portfolio',
  allocation: 'Asset Allocation',
  'mutual-funds': 'Mutual Funds',
  bonds: 'Bonds',
  'unlisted-shares': 'Unlisted Shares',
  transactions: 'Transactions',
  sip: 'Systematic Plans',
  reports: 'Reports',
  'capital-gains': 'Capital Gains',
  documents: 'Documents',
  notifications: 'Notifications',
  support: 'Support',
  profile: 'Profile',
};

/**
 * The line under each page title. It says what the screen is FOR — a title on
 * its own leaves the client to infer that from the contents.
 *
 * Dashboard and onboarding are absent on purpose: both open with their own
 * greeting, and two stacked headers are exactly the clutter this replaces.
 */
export const VIEW_SUBTITLES: Partial<Record<PortalView, string>> = {
  portfolio: 'Every holding you have with us, valued at the latest published NAV.',
  allocation: 'How your money is spread across asset classes, products and fund houses.',
  'mutual-funds': 'Research funds, start a SIP or invest a lump sum.',
  bonds: 'Fixed-income options curated for you, with your indicative price.',
  'unlisted-shares': 'Pre-IPO and unlisted companies, with your indicative price per share.',
  transactions: 'Every purchase, redemption, switch and payout on your account.',
  sip: 'Your systematic plans — instalments, dates and amounts.',
  reports: 'Download your transaction and holdings statements.',
  'capital-gains': 'Realised gains by financial year, worked out from your own statement.',
  documents: 'Your KYC papers, deal confirmations and statements in one place.',
  notifications: 'Updates from your relationship manager and your account.',
  support: 'Raise a ticket and track the ones you have open.',
  profile: 'Your personal, bank and KYC details — and how the portal behaves.',
};
