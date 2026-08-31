/**
 * Partner Portal — demo mode, marketplace half.
 *
 * Bonds, unlisted shares and the orders raised against them. Split out of
 * demoData.ts because that file is the partner's own book (clients, payouts,
 * leads) while this one is the product shelf, and only this half is priced —
 * every read here has to be re-derived through the real pricing helpers when
 * the demo markup changes.
 *
 * Same two rules as demoData.ts: every issuer, company, ISIN and figure below
 * is INVENTED, and nothing here touches the database. The names are chosen so
 * that they cannot be mistaken for a real security — a prospect clicking around
 * the sample portal must never come away believing they saw a live offer.
 *
 * The markup a prospect types into "Your markup" is held here for the session
 * (ephemeral, dies with the tab) so that saving it visibly reprices the list,
 * which is the whole point of that control.
 */
import type { PartnerBond, PartnerShare, PartnerBondOrder, PartnerShareOrder } from '../services/PartnerService';
import { partnerPricePer100 } from '../bonds/partnerBondMath';
import { partnerSharePrice } from '../shares/partnerShareMath';
import { ephemeralGet, ephemeralSet } from '../../platform/ephemeralStore';

const BOND_MARKUP_KEY = 'nw_partner_demo_bond_markup';
const SHARE_MARKUP_KEY = 'nw_partner_demo_share_markup';

/** What a freshly opened sample portal starts at, before anyone touches it. */
const DEFAULT_BOND_MARKUP = 1.5;
const DEFAULT_SHARE_MARKUP = 2;

export function demoBondMarkup(): number {
  const raw = Number(ephemeralGet(BOND_MARKUP_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BOND_MARKUP;
}
export function setDemoBondMarkup(percent: number): void {
  ephemeralSet(BOND_MARKUP_KEY, String(percent));
}
export function demoShareMarkup(): number {
  const raw = Number(ephemeralGet(SHARE_MARKUP_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SHARE_MARKUP;
}
export function setDemoShareMarkup(percent: number): void {
  ephemeralSet(SHARE_MARKUP_KEY, String(percent));
}

// ---------------------------------------------------------------------------
// Bonds
// ---------------------------------------------------------------------------

/** Cost side only. partner_price / self_markup_percent are filled in on read. */
const BOND_SHELF: Array<Omit<PartnerBond, 'partner_price' | 'self_markup_percent'>> = [
  {
    id: 'demo-b1',
    isin: 'INE0DEMO1011',
    bond_name: '9.75% MERIDIAN INFRA FINANCE LTD 2029',
    issuer_name: 'Meridian Infra Finance Ltd',
    coupon_rate: 9.75, coupon_type: 'Fixed', coupon_frequency: 'Monthly',
    maturity_date: '2029-11-20', next_coupon_date: '2026-09-20', issue_date: '2024-11-20',
    rating: 'AA-', rating_agency: 'Sample Ratings',
    security_type: 'Secured', seniority: 'Senior', tax_status: 'Taxable',
    trustee: 'Sample Trusteeship Services Ltd', day_count_convention: 'Actual/Actual',
    principal_repayment_structure: 'Bullet at maturity',
    min_investment: 100000, face_value: 100000,
    partner_base: 101.4820,
    analytics: { ytm: 9.42, years_to_maturity: 3.22, accrued_per_100: 0.2924 },
  },
  {
    id: 'demo-b2',
    isin: 'INE0DEMO2022',
    bond_name: '10.25% COROMANDEL HOUSING FINANCE LTD 2028',
    issuer_name: 'Coromandel Housing Finance Ltd',
    coupon_rate: 10.25, coupon_type: 'Fixed', coupon_frequency: 'Annual',
    maturity_date: '2028-06-30', next_coupon_date: '2027-06-30', issue_date: '2023-06-30',
    rating: 'A+', rating_agency: 'Sample Ratings',
    security_type: 'Secured', seniority: 'Senior', tax_status: 'Taxable',
    trustee: 'Sample Trusteeship Services Ltd', day_count_convention: 'Actual/Actual',
    principal_repayment_structure: 'Bullet at maturity',
    min_investment: 100000, face_value: 100000,
    partner_base: 102.9310,
    analytics: { ytm: 9.88, years_to_maturity: 1.83, accrued_per_100: 1.7404 },
  },
  {
    id: 'demo-b3',
    isin: 'INE0DEMO3033',
    bond_name: '9.10% SUNDARA RENEWABLES LTD 2031',
    issuer_name: 'Sundara Renewables Ltd',
    coupon_rate: 9.10, coupon_type: 'Fixed', coupon_frequency: 'Annual',
    maturity_date: '2031-03-15', next_coupon_date: '2027-03-15', issue_date: '2024-03-15',
    rating: 'AA', rating_agency: 'Sample Ratings',
    security_type: 'Secured', seniority: 'Senior', tax_status: 'Taxable',
    trustee: 'Sample Trusteeship Services Ltd', day_count_convention: 'Actual/Actual',
    principal_repayment_structure: 'Bullet at maturity',
    min_investment: 100000, face_value: 100000,
    partner_base: 100.6145,
    analytics: { ytm: 8.94, years_to_maturity: 4.54, accrued_per_100: 4.1836 },
  },
  {
    id: 'demo-b4',
    isin: 'INE0DEMO4044',
    bond_name: '11.40% KAVERI MICRO CREDIT LTD 2027',
    issuer_name: 'Kaveri Micro Credit Ltd',
    coupon_rate: 11.40, coupon_type: 'Fixed', coupon_frequency: 'Monthly',
    maturity_date: '2027-12-05', next_coupon_date: '2026-09-05', issue_date: '2024-12-05',
    rating: 'A', rating_agency: 'Sample Ratings',
    security_type: 'Secured', seniority: 'Senior', tax_status: 'Taxable',
    trustee: 'Sample Trusteeship Services Ltd', day_count_convention: 'Actual/Actual',
    principal_repayment_structure: 'Bullet at maturity',
    min_investment: 100000, face_value: 100000,
    partner_base: 103.7255,
    analytics: { ytm: 10.71, years_to_maturity: 1.26, accrued_per_100: 0.8123 },
  },
  {
    id: 'demo-b5',
    isin: 'INE0DEMO5055',
    bond_name: '10.60% NILGIRI LOGISTICS LTD 2030',
    issuer_name: 'Nilgiri Logistics Ltd',
    coupon_rate: 10.60, coupon_type: 'Fixed', coupon_frequency: 'Quarterly',
    maturity_date: '2030-08-25', next_coupon_date: '2026-11-25', issue_date: '2024-08-25',
    rating: 'A-', rating_agency: 'Sample Ratings',
    security_type: 'Secured', seniority: 'Senior', tax_status: 'Taxable',
    trustee: 'Sample Trusteeship Services Ltd', day_count_convention: 'Actual/Actual',
    principal_repayment_structure: 'Bullet at maturity',
    min_investment: 100000, face_value: 100000,
    partner_base: 102.1078,
    analytics: { ytm: 10.18, years_to_maturity: 3.99, accrued_per_100: 0.1743 },
  },
  {
    id: 'demo-b6',
    isin: 'INE0DEMO6066',
    bond_name: '8.85% ANANTHA POWER TRANSMISSION LTD 2032',
    issuer_name: 'Anantha Power Transmission Ltd',
    coupon_rate: 8.85, coupon_type: 'Fixed', coupon_frequency: 'Semi-annual',
    maturity_date: '2032-05-10', next_coupon_date: '2026-11-10', issue_date: '2025-05-10',
    rating: 'AAA', rating_agency: 'Sample Ratings',
    security_type: 'Secured', seniority: 'Senior', tax_status: 'Taxable',
    trustee: 'Sample Trusteeship Services Ltd', day_count_convention: 'Actual/Actual',
    principal_repayment_structure: 'Bullet at maturity',
    min_investment: 100000, face_value: 100000,
    partner_base: 100.2467,
    analytics: { ytm: 8.79, years_to_maturity: 5.69, accrued_per_100: 2.7096 },
  },
];

/** The shelf priced at the markup currently set in this demo session. */
export function demoBonds(): PartnerBond[] {
  const markup = demoBondMarkup();
  return BOND_SHELF.map((b) => ({
    ...b,
    self_markup_percent: markup,
    partner_price: partnerPricePer100(b, markup),
  }));
}

export function demoBond(id: string): PartnerBond | null {
  return demoBonds().find((b) => b.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Unlisted shares
// ---------------------------------------------------------------------------

const SHARE_SHELF: Array<Omit<PartnerShare, 'partner_price' | 'self_markup_percent'>> = [
  {
    id: 'demo-s1',
    isin: 'INE0DEMOS011',
    company_name: 'Velan Aerospace Private Limited',
    short_name: 'Velan Aerospace',
    sector: 'Aerospace & Defence',
    about: 'A sample company used to demonstrate the unlisted shares desk. Velan Aerospace makes precision components for airframe and propulsion assemblies, and is shown here only to illustrate how a company profile appears to you and to your client.',
    logo_url: null, website: null,
    face_value: 10, lot_size: 25, min_qty: 100,
    partner_base: 512.00,
  },
  {
    id: 'demo-s2',
    isin: 'INE0DEMOS022',
    company_name: 'Thamarai Foods Limited',
    short_name: 'Thamarai Foods',
    sector: 'FMCG',
    about: 'A sample company used to demonstrate the unlisted shares desk. Thamarai Foods is presented as a packaged-staples business with a regional distribution network. Every figure shown against it is invented.',
    logo_url: null, website: null,
    face_value: 10, lot_size: 50, min_qty: 200,
    partner_base: 187.50,
  },
  {
    id: 'demo-s3',
    isin: 'INE0DEMOS033',
    company_name: 'Ashvin Semiconductors Limited',
    short_name: 'Ashvin Semiconductors',
    sector: 'Semiconductors',
    about: 'A sample company used to demonstrate the unlisted shares desk. Ashvin Semiconductors is presented as an analog and mixed-signal design house. It does not exist and nothing here is an offer.',
    logo_url: null, website: null,
    face_value: 2, lot_size: 100, min_qty: 500,
    partner_base: 964.25,
  },
  {
    id: 'demo-s4',
    isin: 'INE0DEMOS044',
    company_name: 'Poornam Logistics Limited',
    short_name: 'Poornam Logistics',
    sector: 'Logistics & Supply Chain',
    about: 'A sample company used to demonstrate the unlisted shares desk. Poornam Logistics is presented as a third-party warehousing and line-haul operator. Every figure shown against it is invented.',
    logo_url: null, website: null,
    face_value: 10, lot_size: 25, min_qty: 100,
    partner_base: 341.80,
  },
];

export function demoShares(): PartnerShare[] {
  const markup = demoShareMarkup();
  return SHARE_SHELF.map((s) => ({
    ...s,
    self_markup_percent: markup,
    partner_price: partnerSharePrice(s, markup),
  }));
}

export function demoShare(id: string): PartnerShare | null {
  return demoShares().find((s) => s.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
//
// Seeded across the whole status ladder so My Orders shows the RM confirming a
// deal rather than a single lonely row. Orders placed during a demo session are
// unshifted onto the front of these arrays and live only in memory.

const seedBondOrders: PartnerBondOrder[] = [
  {
    id: 'demo-bo1', ref: 'PBO-DEMO-0003',
    bond_name: '9.10% SUNDARA RENEWABLES LTD 2031', isin: 'INE0DEMO3033',
    units: 5, price_per_100: 102.12, amount: 510600, status: 'accepted',
    partner_markup_percent: 1.5, created_at: '2026-08-11T06:20:00.000Z',
    client: { full_name: 'ANAND KRISHNAMURTHY', client_code: 'NW-DEMO-0001' },
  },
  {
    id: 'demo-bo2', ref: 'PBO-DEMO-0002',
    bond_name: '10.25% COROMANDEL HOUSING FINANCE LTD 2028', isin: 'INE0DEMO2022',
    units: 3, price_per_100: 104.47, amount: 313410, status: 'deal_sent',
    partner_markup_percent: 1.5, created_at: '2026-08-21T09:05:00.000Z',
    client: { full_name: 'MEERA SUNDARAM', client_code: 'NW-DEMO-0002' },
  },
  {
    id: 'demo-bo3', ref: 'PBO-DEMO-0001',
    bond_name: '11.40% KAVERI MICRO CREDIT LTD 2027', isin: 'INE0DEMO4044',
    units: 2, price_per_100: 105.28, amount: 210560, status: 'submitted',
    partner_markup_percent: 1.5, created_at: '2026-08-28T04:45:00.000Z',
    client: { full_name: 'RAJESH IYER (HUF)', client_code: 'NW-DEMO-0003' },
  },
];

const seedShareOrders: PartnerShareOrder[] = [
  {
    id: 'demo-so1', ref: 'PSO-DEMO-0002',
    company_name: 'Velan Aerospace Private Limited', isin: 'INE0DEMOS011',
    qty: 200, price_per_share: 522.24, amount: 104448, status: 'accepted',
    partner_markup_percent: 2, created_at: '2026-08-14T07:30:00.000Z',
    client: { full_name: 'ANAND KRISHNAMURTHY', client_code: 'NW-DEMO-0001' },
  },
  {
    id: 'demo-so2', ref: 'PSO-DEMO-0001',
    company_name: 'Thamarai Foods Limited', isin: 'INE0DEMOS022',
    qty: 400, price_per_share: 191.25, amount: 76500, status: 'submitted',
    partner_markup_percent: 2, created_at: '2026-08-26T11:10:00.000Z',
    client: { full_name: 'MEERA SUNDARAM', client_code: 'NW-DEMO-0002' },
  },
];

let bondOrders: PartnerBondOrder[] = [...seedBondOrders];
let shareOrders: PartnerShareOrder[] = [...seedShareOrders];
let demoOrderSeq = 3;

export function demoBondOrders(): PartnerBondOrder[] {
  return [...bondOrders];
}
export function demoShareOrders(): PartnerShareOrder[] {
  return [...shareOrders];
}

/** Record a bond order placed inside the demo, so My Orders updates for real. */
export function addDemoBondOrder(
  bond: PartnerBond,
  clientName: string,
  clientCode: string,
  units: number,
  margin: number,
  createdAt: string,
): PartnerBondOrder {
  demoOrderSeq += 1;
  const ref = `PBO-DEMO-${String(demoOrderSeq).padStart(4, '0')}`;
  const price = partnerPricePer100(bond, margin);
  const order: PartnerBondOrder = {
    id: `demo-bo-${demoOrderSeq}`,
    ref,
    bond_name: bond.bond_name ?? '',
    isin: bond.isin,
    units,
    price_per_100: price,
    amount: Math.round(((Number(bond.face_value) || 0) * units * price) / 100),
    status: 'submitted',
    partner_markup_percent: margin,
    created_at: createdAt,
    client: { full_name: clientName, client_code: clientCode },
  };
  bondOrders = [order, ...bondOrders];
  return order;
}

/** Record an unlisted-share order placed inside the demo. */
export function addDemoShareOrder(
  share: PartnerShare,
  clientName: string,
  clientCode: string,
  qty: number,
  margin: number,
  createdAt: string,
): PartnerShareOrder {
  demoOrderSeq += 1;
  const ref = `PSO-DEMO-${String(demoOrderSeq).padStart(4, '0')}`;
  const price = partnerSharePrice(share, margin);
  const order: PartnerShareOrder = {
    id: `demo-so-${demoOrderSeq}`,
    ref,
    company_name: share.company_name,
    isin: share.isin,
    qty,
    price_per_share: price,
    amount: Math.round(price * qty),
    status: 'submitted',
    partner_markup_percent: margin,
    created_at: createdAt,
    client: { full_name: clientName, client_code: clientCode },
  };
  shareOrders = [order, ...shareOrders];
  return order;
}

/** Put the shelf back to its seeded state. Called when the demo session ends. */
export function resetDemoMarket(): void {
  bondOrders = [...seedBondOrders];
  shareOrders = [...seedShareOrders];
  demoOrderSeq = 3;
}
