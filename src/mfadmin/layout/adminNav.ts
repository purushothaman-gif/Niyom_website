/**
 * MF Admin navigation — single source of truth for the console.
 *
 * Structured as top-level SECTIONS with child views, because the surface has
 * grown past what one flat sidebar can carry legibly. The shell renders the
 * sections across the top and the active section's children in a left rail,
 * which keeps any screen two clicks away.
 */
import {
  LayoutDashboard,
  Users,
  Hash,
  ShieldCheck,
  ListChecks,
  ShoppingCart,
  CalendarClock,
  Undo2,
  ArrowLeftRight,
  Repeat,
  ArrowDownUp,
  FileText,
  Coins,
  Percent,
  ScrollText,
  Bell,
  Settings,
  Compass,
  Calculator,
  BookOpen,
  Sparkles,
  PieChart,
  Wallet,
  TrendingUp,
  Landmark,
  Target,
  Home,
  Plane,
  GraduationCap,
  HeartHandshake,
  LineChart,
  BadgeIndianRupee,
  FileSpreadsheet,
  type LucideIcon,
} from 'lucide-react';

export type AdminView =
  // Overview
  | 'dashboard'
  // Clients
  | 'clients'
  | 'ucc'
  | 'kyc'
  // Transact
  | 'orders'
  | 'purchase'
  | 'sip'
  | 'redeem'
  | 'switch'
  | 'stp'
  | 'swp'
  | 'nfo'
  // Funds
  | 'explore'
  | 'recommendations'
  | 'nav'
  | 'performance'
  // Reports
  | 'reports'
  | 'holdings'
  | 'brokerage'
  | 'commission'
  // Tools
  | 'calculators'
  | 'forms'
  // System
  | 'audit'
  | 'notifications'
  | 'settings';

export interface AdminNavItem {
  view: AdminView;
  label: string;
  icon: LucideIcon;
  /** Shown in the rail under the label where the screen needs a caveat. */
  note?: string;
}

export interface AdminSection {
  id: string;
  label: string;
  icon: LucideIcon;
  items: AdminNavItem[];
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id: 'overview',
    label: 'Dashboard',
    icon: LayoutDashboard,
    items: [{ view: 'dashboard', label: 'Operations Overview', icon: LayoutDashboard }],
  },
  {
    id: 'clients',
    label: 'Clients',
    icon: Users,
    items: [
      { view: 'clients', label: 'Client Management', icon: Users },
      { view: 'ucc', label: 'UCC Book', icon: Hash },
      { view: 'kyc', label: 'KYC & Verification', icon: ShieldCheck },
    ],
  },
  {
    id: 'transact',
    label: 'Transact',
    icon: ShoppingCart,
    items: [
      { view: 'orders', label: 'Order Book', icon: ListChecks },
      { view: 'purchase', label: 'Lumpsum Purchase', icon: ShoppingCart },
      { view: 'sip', label: 'SIP', icon: CalendarClock },
      { view: 'redeem', label: 'Redeem', icon: Undo2 },
      { view: 'switch', label: 'Switch', icon: ArrowLeftRight },
      { view: 'stp', label: 'STP', icon: Repeat },
      { view: 'swp', label: 'SWP', icon: ArrowDownUp },
      { view: 'nfo', label: 'NFO', icon: Sparkles },
    ],
  },
  {
    id: 'funds',
    label: 'Funds',
    icon: Compass,
    items: [
      { view: 'explore', label: 'Explore Funds', icon: Compass },
      {
        view: 'recommendations',
        label: 'Recommendations',
        icon: Sparkles,
        note: 'Shown to clients in the portal',
      },
      { view: 'nav', label: 'Scheme NAV', icon: LineChart },
      { view: 'performance', label: 'Scheme Performance', icon: TrendingUp },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: FileText,
    items: [
      { view: 'reports', label: 'Exports', icon: FileSpreadsheet },
      { view: 'holdings', label: 'Holdings', icon: PieChart },
      { view: 'brokerage', label: 'Brokerage', icon: Coins },
      { view: 'commission', label: 'Commission', icon: Percent },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    icon: Calculator,
    items: [
      { view: 'calculators', label: 'Calculators', icon: Calculator },
      { view: 'forms', label: 'MF Forms', icon: BookOpen },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Settings,
    items: [
      { view: 'audit', label: 'Audit Log', icon: ScrollText },
      { view: 'notifications', label: 'Notifications', icon: Bell },
      { view: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

export const ADMIN_VIEW_TITLES: Record<AdminView, string> = {
  dashboard: 'Operations Overview',
  clients: 'Client Management',
  ucc: 'UCC Book',
  kyc: 'KYC & Verification',
  orders: 'Order Book',
  purchase: 'Lumpsum Purchase',
  sip: 'SIP Book',
  redeem: 'Redeem',
  switch: 'Switch',
  stp: 'Systematic Transfer Plan',
  swp: 'Systematic Withdrawal Plan',
  nfo: 'New Fund Offers',
  explore: 'Explore Funds',
  recommendations: 'Fund Recommendations',
  nav: 'Scheme NAV',
  performance: 'Scheme Performance',
  reports: 'Exports',
  holdings: 'Holdings',
  brokerage: 'Brokerage',
  commission: 'Commission',
  calculators: 'Calculators',
  forms: 'MF Forms',
  audit: 'Audit Log',
  notifications: 'Notifications',
  settings: 'Settings',
};

/** Which top-level section a view belongs to — drives the active tab. */
export function sectionForView(view: AdminView): AdminSection {
  return ADMIN_SECTIONS.find((s) => s.items.some((i) => i.view === view)) ?? ADMIN_SECTIONS[0];
}

/** Goal calculators. Pure client-side maths, so these need no BSE data at all. */
export interface CalculatorDef {
  id: string;
  label: string;
  icon: LucideIcon;
  /** What the user is solving for, shown as the result caption. */
  goalLabel: string;
  defaultTarget: number | null;
}

export const CALCULATORS: CalculatorDef[] = [
  { id: 'crorepati', label: 'Crorepati', icon: BadgeIndianRupee, goalLabel: 'Target corpus', defaultTarget: 10000000 },
  { id: 'home', label: 'Dream Home', icon: Home, goalLabel: 'Cost of the home', defaultTarget: 5000000 },
  { id: 'vacation', label: 'Dream Vacation', icon: Plane, goalLabel: 'Cost of the trip', defaultTarget: 500000 },
  { id: 'marriage', label: "Child's Marriage", icon: HeartHandshake, goalLabel: 'Cost of the wedding', defaultTarget: 2500000 },
  { id: 'education', label: "Child's Education", icon: GraduationCap, goalLabel: 'Cost of education', defaultTarget: 3000000 },
  { id: 'custom', label: 'Custom Goal', icon: Target, goalLabel: 'Target amount', defaultTarget: 1000000 },
  { id: 'sip', label: 'SIP Calculator', icon: Wallet, goalLabel: 'Monthly investment', defaultTarget: null },
  { id: 'lumpsum', label: 'Lumpsum Growth', icon: Landmark, goalLabel: 'One-time investment', defaultTarget: null },
];
