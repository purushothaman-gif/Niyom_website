/**
 * Client Portal — demo mode, everything the sample client can browse or raise.
 *
 * Split from demoClient.ts for the same reason the partner demo is split: that
 * file is the client's own book, this one is the shelf they can buy from plus
 * the tickets and tax statement generated around it. Same rules apply — every
 * name and figure is invented, and the securities mirror the invented shelf in
 * shared/partner/demo/demoMarket.ts so the two demos tell one story.
 */
import type { CatalogFund, CatalogFundDetail, FundRecommendation } from '../types/funds';
import type { ClientBond, BondOrder } from '../services/BondOrderService';
import type { ClientShare, ShareOrder } from '../services/ShareOrderService';
import type { SupportTicket, NewTicketInput } from '../services/SupportService';
import type { GainsStatement } from '../services/CasGainsService';
/*
 * The client id is duplicated rather than imported. demoClient.ts imports
 * resetDemoClientMarket from this file, so importing a runtime value back the
 * other way closes a cycle and the portal dies on load with "Cannot access
 * 'DEMO_CLIENT_ID' before initialization". Types cross freely; values do not.
 */
const DEMO_CLIENT_ID = 'demo-client';

// ---------------------------------------------------------------------------
// Mutual fund catalog
// ---------------------------------------------------------------------------

const fund = (
  amfiCode: string,
  name: string,
  amc: string,
  category: CatalogFund['category'],
  subCategory: string,
  risk: string,
  nav: number,
  returns: CatalogFund['returns'],
): CatalogFund => ({
  amfiCode,
  name,
  amc,
  category,
  subCategory,
  risk,
  nav,
  navDate: '2026-08-29',
  returns,
  minInvestment: 500,
  launchDate: '2013-05-20',
  updatedAt: '2026-08-29T18:30:00.000Z',
});

export const demoCatalogFunds: CatalogFund[] = [
  fund('DEMO001', 'Sample Flexi Cap Fund — Growth', 'Sample Asset Management', 'Equity', 'Flexi Cap', 'High', 77.01,
    { YTD: 9.4, '6M': 11.2, '1Y': 18.6, '3Y': 21.4, '5Y': 19.2, SI: 16.8 }),
  fund('DEMO002', 'Sample Mid Cap Fund — Growth', 'Sample Asset Management', 'Equity', 'Mid Cap', 'High', 120.12,
    { YTD: 12.1, '6M': 14.8, '1Y': 24.3, '3Y': 26.9, '5Y': 23.1, SI: 18.4 }),
  fund('DEMO003', 'Sample Balanced Advantage Fund — Growth', 'Sample Asset Management', 'Hybrid', 'Balanced Advantage', 'Moderate', 44.9,
    { YTD: 6.2, '6M': 7.4, '1Y': 12.1, '3Y': 13.6, '5Y': 12.4, SI: 11.2 }),
  fund('DEMO004', 'Sample Corporate Bond Fund — Growth', 'Sample Asset Management', 'Debt', 'Corporate Bond', 'Low', 31.44,
    { YTD: 4.1, '6M': 4.6, '1Y': 7.8, '3Y': 7.1, '5Y': 6.9, SI: 7.4 }),
  fund('DEMO005', 'Sample Large Cap Fund — Growth', 'Sample Asset Management', 'Equity', 'Large Cap', 'High', 68.35,
    { YTD: 7.9, '6M': 9.1, '1Y': 15.2, '3Y': 17.8, '5Y': 16.1, SI: 14.6 }),
  fund('DEMO006', 'Sample Short Duration Fund — Growth', 'Sample Asset Management', 'Debt', 'Short Duration', 'Low', 28.9,
    { YTD: 3.8, '6M': 4.2, '1Y': 7.2, '3Y': 6.8, '5Y': 6.4, SI: 7.0 }),
];

export const demoRecommendations: FundRecommendation[] = [
  {
    amfiCode: 'DEMO001',
    fundName: 'Sample Flexi Cap Fund — Growth',
    headline: 'A core equity holding',
    rationale: 'Shown as a sample recommendation only. In the live portal your relationship manager curates this list.',
  },
  {
    amfiCode: 'DEMO003',
    fundName: 'Sample Balanced Advantage Fund — Growth',
    headline: 'Steadier ride, still equity-linked',
    rationale: 'Shown as a sample recommendation only. In the live portal your relationship manager curates this list.',
  },
];

/** A plausible year of NAV, generated so the fund chart has a curve to draw. */
export function demoFundDetail(amfiCode: string): CatalogFundDetail {
  const base = demoCatalogFunds.find((f) => f.amfiCode === amfiCode)?.nav ?? 50;
  const navHistory = [];
  // Deterministic pseudo-noise: a fixed sine blend, never Math.random, so the
  // same fund draws the same chart on every run and every re-shoot.
  for (let i = 365; i >= 0; i -= 5) {
    const t = (365 - i) / 365;
    const drift = 1 - 0.16 * (1 - t);
    const wobble = 1 + 0.022 * Math.sin(i / 11) + 0.014 * Math.sin(i / 4.3);
    const d = new Date(Date.UTC(2025, 7, 29) + (365 - i) * 86_400_000);
    navHistory.push({
      date: `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`,
      nav: Number((base * drift * wobble).toFixed(4)),
    });
  }
  const navs = navHistory.map((p) => p.nav);
  return {
    navHistory,
    high52w: Math.max(...navs),
    low52w: Math.min(...navs),
    launchDate: '2013-05-20',
  };
}

// ---------------------------------------------------------------------------
// Bonds and unlisted shares, at the client price
// ---------------------------------------------------------------------------

export const demoClientBonds: ClientBond[] = [
  {
    id: 'demo-b1', isin: 'INE0DEMO1011',
    bond_name: '9.75% MERIDIAN INFRA FINANCE LTD 2029', issuer_name: 'Meridian Infra Finance Ltd',
    coupon_rate: 9.75, coupon_type: 'Fixed', coupon_frequency: 'Monthly',
    maturity_date: '2029-11-20', next_coupon_date: '2026-09-20', issue_date: '2024-11-20',
    rating: 'AA-', rating_agency: 'Sample Ratings', security_type: 'Secured', tax_status: 'Taxable',
    trustee: 'Sample Trusteeship Services Ltd', day_count_convention: 'Actual/Actual',
    principal_repayment_structure: 'Bullet at maturity',
    min_investment: 100000, face_value: 100000, client_price: 102.98,
    analytics: { ytm: 9.15, years_to_maturity: 3.22, accrued_per_100: 0.2924 },
  },
  {
    id: 'demo-b2', isin: 'INE0DEMO2022',
    bond_name: '10.25% COROMANDEL HOUSING FINANCE LTD 2028', issuer_name: 'Coromandel Housing Finance Ltd',
    coupon_rate: 10.25, coupon_type: 'Fixed', coupon_frequency: 'Annual',
    maturity_date: '2028-06-30', next_coupon_date: '2027-06-30', issue_date: '2023-06-30',
    rating: 'A+', rating_agency: 'Sample Ratings', security_type: 'Secured', tax_status: 'Taxable',
    trustee: 'Sample Trusteeship Services Ltd', day_count_convention: 'Actual/Actual',
    principal_repayment_structure: 'Bullet at maturity',
    min_investment: 100000, face_value: 100000, client_price: 104.47,
    analytics: { ytm: 9.61, years_to_maturity: 1.83, accrued_per_100: 1.7404 },
  },
  {
    id: 'demo-b3', isin: 'INE0DEMO6066',
    bond_name: '8.85% ANANTHA POWER TRANSMISSION LTD 2032', issuer_name: 'Anantha Power Transmission Ltd',
    coupon_rate: 8.85, coupon_type: 'Fixed', coupon_frequency: 'Semi-annual',
    maturity_date: '2032-05-10', next_coupon_date: '2026-11-10', issue_date: '2025-05-10',
    rating: 'AAA', rating_agency: 'Sample Ratings', security_type: 'Secured', tax_status: 'Taxable',
    trustee: 'Sample Trusteeship Services Ltd', day_count_convention: 'Actual/Actual',
    principal_repayment_structure: 'Bullet at maturity',
    min_investment: 100000, face_value: 100000, client_price: 101.75,
    analytics: { ytm: 8.52, years_to_maturity: 5.69, accrued_per_100: 2.7096 },
  },
];

export const demoClientShares: ClientShare[] = [
  {
    id: 'demo-s1', isin: 'INE0DEMOS011',
    company_name: 'Velan Aerospace Private Limited', short_name: 'Velan Aerospace',
    sector: 'Aerospace & Defence',
    about: 'A sample company used to demonstrate the unlisted shares desk. Velan Aerospace makes precision components for airframe and propulsion assemblies, and is shown here only to illustrate how a company profile appears in the portal.',
    logo_url: null, website: null, face_value: 10, lot_size: 25, min_qty: 100, client_price: 588.8,
  },
  {
    id: 'demo-s2', isin: 'INE0DEMOS022',
    company_name: 'Thamarai Foods Limited', short_name: 'Thamarai Foods',
    sector: 'FMCG',
    about: 'A sample company used to demonstrate the unlisted shares desk. Thamarai Foods is presented as a packaged-staples business with a regional distribution network. Every figure shown against it is invented.',
    logo_url: null, website: null, face_value: 10, lot_size: 50, min_qty: 200, client_price: 215.63,
  },
  {
    id: 'demo-s3', isin: 'INE0DEMOS033',
    company_name: 'Ashvin Semiconductors Limited', short_name: 'Ashvin Semiconductors',
    sector: 'Semiconductors',
    about: 'A sample company used to demonstrate the unlisted shares desk. Ashvin Semiconductors is presented as an analog and mixed-signal design house. It does not exist and nothing here is an offer.',
    logo_url: null, website: null, face_value: 2, lot_size: 100, min_qty: 500, client_price: 1108.89,
  },
];

// ---------------------------------------------------------------------------
// Orders and tickets — mutable for the session, reset on sign-out
// ---------------------------------------------------------------------------

const seedBondOrders: BondOrder[] = [
  {
    id: 'demo-bo1', ref: 'BO-DEMO-0001', bond_id: 'demo-b1', isin: 'INE0DEMO1011',
    bond_name: '9.75% MERIDIAN INFRA FINANCE LTD 2029', units: 2, price_per_100: 102.98,
    amount: 205960, face_value: 100000, notes: '', status: 'accepted',
    created_at: '2026-06-24T05:30:00.000Z',
  },
];

const seedTickets: SupportTicket[] = [
  {
    id: 'demo-tk1', ref: 'TKT-DEMO-0001', client_id: DEMO_CLIENT_ID,
    category: 'general', subject: 'Request a consolidated statement for FY 2025-26',
    message: 'Could you send across a consolidated statement for the last financial year?',
    status: 'resolved', priority: 'normal',
    created_at: '2026-07-11T09:12:00.000Z', updated_at: '2026-07-11T14:40:00.000Z',
  },
];

let bondOrders: BondOrder[] = [...seedBondOrders];
let shareOrders: ShareOrder[] = [];
let tickets: SupportTicket[] = [...seedTickets];
let seq = 1;

export const demoBondOrders = (): BondOrder[] => [...bondOrders];
export const demoShareOrders = (): ShareOrder[] => [...shareOrders];
export const demoTickets = (): SupportTicket[] => [...tickets];

export function addDemoClientBondOrder(bond: ClientBond, units: number, createdAt: string): BondOrder {
  seq += 1;
  const price = Number(bond.client_price) || 0;
  const order: BondOrder = {
    id: `demo-bo-${seq}`,
    ref: `BO-DEMO-${String(seq).padStart(4, '0')}`,
    bond_id: bond.id,
    isin: bond.isin,
    bond_name: bond.bond_name ?? '',
    units,
    price_per_100: price,
    amount: Math.round(((Number(bond.face_value) || 0) * units * price) / 100),
    face_value: Number(bond.face_value) || 0,
    notes: '',
    status: 'submitted',
    created_at: createdAt,
  };
  bondOrders = [order, ...bondOrders];
  return order;
}

export function addDemoClientTicket(input: NewTicketInput, createdAt: string): SupportTicket {
  seq += 1;
  const ticket: SupportTicket = {
    id: `demo-tk-${seq}`,
    ref: `TKT-DEMO-${String(seq).padStart(4, '0')}`,
    client_id: DEMO_CLIENT_ID,
    category: input.category,
    subject: input.subject,
    message: input.message,
    status: 'open',
    priority: 'normal',
    created_at: createdAt,
    updated_at: createdAt,
  };
  tickets = [ticket, ...tickets];
  return ticket;
}

export function resetDemoClientMarket(): void {
  bondOrders = [...seedBondOrders];
  shareOrders = [];
  tickets = [...seedTickets];
  seq = 1;
}

// ---------------------------------------------------------------------------
// Capital gains
// ---------------------------------------------------------------------------

// Rates are FRACTIONS here, not percentages — gains.ts multiplies the gain by
// them directly and the UI renders rate * 100. Percentages produce a 2000%
// short-term rate and an indicative tax a hundred times too large.
const equityLong = { kind: 'equity' as const, term: 'long' as const, rate: 0.125 };
const equityShort = { kind: 'equity' as const, term: 'short' as const, rate: 0.2 };

/**
 * Two realised disposals in the current financial year and one in the year
 * before, so the year selector has something to switch between and both tax
 * treatments are visible.
 */
export function demoGainsStatement(): GainsStatement {
  const disposals = [
    {
      schemeId: 'demo-g1', schemeName: 'Sample Large Cap Fund — Growth', isin: 'INF000DEMO05',
      fy: '2026-27', buyDate: '2023-05-19', sellDate: '2026-05-27', units: 1840.22,
      buyNav: 41.3, sellNav: 66.85, actualCost: 75991, cost: 75991, grandfathered: false,
      proceeds: 122998, gain: 47007, holdingDays: 1104, treatment: equityLong,
    },
    {
      schemeId: 'demo-g2', schemeName: 'Sample Mid Cap Fund — Growth', isin: 'INF000DEMO03',
      fy: '2026-27', buyDate: '2026-01-08', sellDate: '2026-07-15', units: 420.5,
      buyNav: 104.2, sellNav: 118.4, actualCost: 43816, cost: 43816, grandfathered: false,
      proceeds: 49787, gain: 5971, holdingDays: 188, treatment: equityShort,
    },
    {
      schemeId: 'demo-g3', schemeName: 'Sample Flexi Cap Fund — Growth', isin: 'INF000DEMO01',
      fy: '2025-26', buyDate: '2021-11-02', sellDate: '2025-09-30', units: 900,
      buyNav: 38.9, sellNav: 63.2, actualCost: 35010, cost: 35010, grandfathered: false,
      proceeds: 56880, gain: 21870, holdingDays: 1428, treatment: equityLong,
    },
  ];

  return {
    schemes: disposals.map((d) => ({
      schemeId: d.schemeId,
      schemeName: d.schemeName,
      isin: d.isin,
      assetClass: 'equity' as const,
      complete: true,
      disposals: [d],
      openLots: [{ buyDate: d.buyDate, units: 100, buyNav: d.buyNav, cost: d.buyNav * 100 }],
      openCost: Math.round(d.buyNav * 100),
      openUnits: 100,
      unrealised: Math.round(d.sellNav * 100 - d.buyNav * 100),
    })),
    disposals,
    financialYears: ['2026-27', '2025-26'],
    excluded: [],
    undecided: [],
    unrealised: 309454,
    statementTo: '2026-08-29',
    complete: true,
  };
}
