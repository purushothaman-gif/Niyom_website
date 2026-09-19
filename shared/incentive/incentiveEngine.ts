/**
 * Employee incentive — the one implementation of the formula.
 * -----------------------------------------------------------------------------
 * Decoded from the management workbook `niyom_wealth_incentive_auto_calculator`
 * (Calculator + Config + Incentive slab sheets). Every screen that shows an
 * incentive figure — the employee's own tracker, the admin board, the frozen
 * snapshot written at approval — calls `computeIncentive` here. Do not write a
 * second copy (see the DSA payout note for what happens when one drifts).
 *
 * ## The rule, in words
 *
 *   X        = monthly revenue ÷ monthly gross salary
 *   band     = the highest band whose lower_x ≤ X      (Excel MATCH(...,1))
 *   eligible = X ≥ min_x  AND  enough products meet their MINIMUM threshold
 *              (products_required_below_switch when X < switch_x, else
 *               products_required_at_or_above_switch) — unless the
 *              multi-product mandate is switched OFF (rules.product_mandate,
 *              overridable per month), when revenue alone decides
 *   base     = salary  × band.base_mult                 (4.5 = 450% of salary)
 *   add-on   = revenue × band.addon_pct, only when X > addon_min_x (strictly)
 *   OA bonus = revenue × band.oa_pct,    only when ≥ oa_products_required
 *              products meet their OVER-ACHIEVEMENT threshold
 *   final    = eligible ? min(base + add-on + OA, revenue × cap_pct_revenue) : 0
 *
 * Every number in that rule lives in `IncentiveConfig`, which admin edits as a
 * new effective-dated version (inc_plan_versions). Nothing here is hard-coded
 * except the defaults used to seed version 1.
 *
 * ## Units
 *
 * `base_mult` is a multiple of salary (0.1 = 10% of salary, 4.5 = 450%).
 * `addon_pct`, `oa_pct` and `cap_pct_revenue` are fractions of revenue
 * (0.25 = 25%). The workbook stores them the same way.
 */

export interface IncentiveBand {
  /** Inclusive lower bound of X for this band. */
  lower_x: number;
  label: string;
  note: string;
  /** Base incentive as a multiple of monthly salary. */
  base_mult: number;
  /** Direct revenue add-on as a fraction of revenue. */
  addon_pct: number;
  /** Over-achievement bonus as a fraction of revenue. */
  oa_pct: number;
}

export interface IncentiveProduct {
  key: string;
  label: string;
  /** What the figure measures, shown next to it. */
  unit: string;
  /** Business needed for the product to count towards eligibility. */
  min_threshold: number;
  /** Business needed for the product to count towards the OA bonus. */
  oa_threshold: number;
}

export interface IncentiveRules {
  /**
   * The multi-product mandate. When false, the minimum-product requirement is
   * waived and eligibility rests on revenue (min_x) alone. Admin can also
   * switch it per month (inc_month_settings), which wins over this default.
   * The OA bonus still needs its OA products either way — it is a bonus for
   * breadth, not a gate.
   */
  product_mandate: boolean;
  /** No incentive at all below this X. */
  min_x: number;
  /** Below this X the stricter product count applies. */
  product_switch_x: number;
  products_required_below_switch: number;
  products_required_at_or_above_switch: number;
  /** The revenue add-on is paid only when X is strictly above this. */
  addon_min_x: number;
  /** Products that must meet their OA threshold for the OA bonus. */
  oa_products_required: number;
  /** Final incentive may not exceed this fraction of revenue. */
  cap_pct_revenue: number;
}

export interface IncentiveConfig {
  bands: IncentiveBand[];
  products: IncentiveProduct[];
  rules: IncentiveRules;
  /** Free-text policy notes shown to employees (retention / clawback terms). */
  policy_notes: string[];
}

/** Business volume per product key, in rupees. Missing keys count as 0. */
export type ProductVolumes = Record<string, number>;

export const DEFAULT_CONFIG_V1: IncentiveConfig = {
  bands: [
    { lower_x: 0,   label: '0x–2x',    note: 'No incentive',                 base_mult: 0,   addon_pct: 0,     oa_pct: 0 },
    { lower_x: 2,   label: '2x–3x',    note: 'Entry band',                   base_mult: 0.1, addon_pct: 0,     oa_pct: 0 },
    { lower_x: 3,   label: '3x–4x',    note: 'Ramp band',                    base_mult: 0.4, addon_pct: 0.045, oa_pct: 0 },
    { lower_x: 4,   label: '4x–5x',    note: 'Growth band',                  base_mult: 0.6, addon_pct: 0.05,  oa_pct: 0 },
    { lower_x: 5,   label: '5x–5.5x',  note: 'Target band',                  base_mult: 0.8, addon_pct: 0.075, oa_pct: 0.05 },
    { lower_x: 5.5, label: '5.5x–7x',  note: 'Direct revenue add-on starts', base_mult: 1.6, addon_pct: 0.08,  oa_pct: 0.075 },
    { lower_x: 7,   label: '7x–9x',    note: 'High performer',               base_mult: 2.0, addon_pct: 0.085, oa_pct: 0.075 },
    { lower_x: 9,   label: '9x–12x',   note: 'Elite',                        base_mult: 2.4, addon_pct: 0.09,  oa_pct: 0.075 },
    { lower_x: 12,  label: '12x–16x',  note: 'Top tier',                     base_mult: 3.5, addon_pct: 0.15,  oa_pct: 0.08 },
    { lower_x: 16,  label: '16x–20x',  note: 'Superstar',                    base_mult: 4.0, addon_pct: 0.2,   oa_pct: 0.09 },
    { lower_x: 20,  label: 'Above 20x', note: 'Exceptional performer',       base_mult: 4.5, addon_pct: 0.25,  oa_pct: 0.1 },
  ],
  products: [
    { key: 'mf',        label: 'Mutual Fund',        unit: '₹ mobilized',       min_threshold: 100000, oa_threshold: 1000000 },
    { key: 'sip',       label: 'SIP',                unit: '₹ monthly SIP',     min_threshold: 3000,   oa_threshold: 25000 },
    { key: 'bond_fd',   label: 'Bond / FD',          unit: '₹ mobilized',       min_threshold: 500000, oa_threshold: 5000000 },
    { key: 'unlisted',  label: 'Unlisted / Pre-IPO', unit: '₹ invested',        min_threshold: 100000, oa_threshold: 2500000 },
    { key: 'insurance', label: 'Insurance',          unit: '₹ annual premium',  min_threshold: 25000,  oa_threshold: 150000 },
  ],
  rules: {
    product_mandate: true,
    min_x: 2,
    product_switch_x: 10,
    products_required_below_switch: 3,
    products_required_at_or_above_switch: 1,
    addon_min_x: 5.5,
    oa_products_required: 3,
    cap_pct_revenue: 0.5,
  },
  policy_notes: [
    'Incentive is provisional until the firm receives commission/revenue from the product house or issuer.',
    'If a client closes, cancels, redeems, or reverses the product before the vesting window, the related incentive is clawed back.',
    'Mutual Fund: hold 6 months for SIP / 3 months for lumpsum. SIP must survive at least 3 successful deductions.',
    'Bond / FD: incentive releases only after commission confirmation; if closed early and commission is reversed, incentive is reversed.',
    'Unlisted / Pre-IPO: payout only after allotment / acceptance; reversal applies if transaction is cancelled before completion.',
    'Insurance: subject to free-look and policy persistence; clawback applies for lapse / cancellation within insurer clawback period.',
    'Overachievement bonus is paid only if at least 3 overachievement thresholds are met in the same month.',
  ],
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------------
// Config validation — stored as jsonb, so it is untrusted until parsed.
// ---------------------------------------------------------------------------

export type ConfigParse =
  | { ok: true; config: IncentiveConfig }
  | { ok: false; errors: string[] };

export function parseIncentiveConfig(raw: unknown): ConfigParse {
  const errors: string[] = [];
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o !== 'object' || Array.isArray(o)) return { ok: false, errors: ['Config is not an object'] };

  const bandsRaw = Array.isArray(o.bands) ? o.bands : [];
  const bands: IncentiveBand[] = bandsRaw.map((b: Record<string, unknown>) => ({
    lower_x: num(b?.lower_x),
    label: String(b?.label ?? ''),
    note: String(b?.note ?? ''),
    base_mult: num(b?.base_mult),
    addon_pct: num(b?.addon_pct),
    oa_pct: num(b?.oa_pct),
  }));
  if (bands.length === 0) errors.push('At least one band is required');
  else if (bands[0].lower_x !== 0) errors.push('The first band must start at 0x');
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (i > 0 && b.lower_x <= bands[i - 1].lower_x) errors.push(`Band ${i + 1}: "From X" must be higher than the band above it`);
    if (b.base_mult < 0 || b.addon_pct < 0 || b.oa_pct < 0) errors.push(`Band ${i + 1}: percentages cannot be negative`);
    if (b.addon_pct > 1 || b.oa_pct > 1) errors.push(`Band ${i + 1}: revenue percentages cannot exceed 100%`);
  }

  const productsRaw = Array.isArray(o.products) ? o.products : [];
  const products: IncentiveProduct[] = productsRaw.map((p: Record<string, unknown>) => ({
    key: String(p?.key ?? '').trim(),
    label: String(p?.label ?? '').trim(),
    unit: String(p?.unit ?? ''),
    min_threshold: num(p?.min_threshold),
    oa_threshold: num(p?.oa_threshold),
  }));
  const keys = new Set<string>();
  products.forEach((p, i) => {
    if (!p.key) errors.push(`Product ${i + 1}: key is required`);
    if (keys.has(p.key)) errors.push(`Product ${i + 1}: duplicate key "${p.key}"`);
    keys.add(p.key);
    if (!p.label) errors.push(`Product ${i + 1}: name is required`);
    if (p.min_threshold < 0 || p.oa_threshold < 0) errors.push(`${p.label || `Product ${i + 1}`}: thresholds cannot be negative`);
  });

  const rr = (o.rules ?? {}) as Record<string, unknown>;
  const rules: IncentiveRules = {
    // Versions saved before the switch existed have no key: that means ON.
    product_mandate: rr.product_mandate !== false,
    min_x: num(rr.min_x),
    product_switch_x: num(rr.product_switch_x),
    products_required_below_switch: Math.trunc(num(rr.products_required_below_switch)),
    products_required_at_or_above_switch: Math.trunc(num(rr.products_required_at_or_above_switch)),
    addon_min_x: num(rr.addon_min_x),
    oa_products_required: Math.trunc(num(rr.oa_products_required)),
    cap_pct_revenue: num(rr.cap_pct_revenue),
  };
  if (rules.cap_pct_revenue <= 0 || rules.cap_pct_revenue > 1) errors.push('Revenue cap must be between 0% and 100%');
  for (const k of ['products_required_below_switch', 'products_required_at_or_above_switch', 'oa_products_required'] as const) {
    if (rules[k] < 0 || rules[k] > products.length) errors.push(`Rule "${k}" must be between 0 and the number of products`);
  }
  if (rules.min_x < 0 || rules.product_switch_x < 0 || rules.addon_min_x < 0) errors.push('X thresholds cannot be negative');

  const policy_notes = Array.isArray(o.policy_notes) ? o.policy_notes.map(String).filter(s => s.trim()) : [];

  if (errors.length) return { ok: false, errors };
  return { ok: true, config: { bands, products, rules, policy_notes } };
}

// ---------------------------------------------------------------------------
// The calculation
// ---------------------------------------------------------------------------

export interface ProductCheck {
  key: string;
  label: string;
  unit: string;
  actual: number;
  threshold: number;
  met: boolean;
  /** How much more is needed; 0 when met. */
  shortfall: number;
}

export interface IncentiveResult {
  /** false when there is no salary to divide by — nothing else is meaningful. */
  hasSalary: boolean;
  salary: number;
  revenue: number;
  x: number;
  bandIndex: number;
  band: IncentiveBand;
  eligible: boolean;
  /** Why it is not eligible, in words; empty when eligible. */
  ineligibleReasons: string[];
  productsRequired: number;
  productsMet: number;
  minChecks: ProductCheck[];
  oaRequired: number;
  oaMet: number;
  oaQualified: boolean;
  oaChecks: ProductCheck[];
  addonActive: boolean;
  base: number;
  addon: number;
  oaBonus: number;
  gross: number;
  cap: number;
  capped: boolean;
  /** What is payable. */
  final: number;
}

export interface IncentiveInput {
  config: IncentiveConfig;
  salary: number;
  revenue: number;
  volumes: ProductVolumes;
}

export function bandIndexFor(bands: IncentiveBand[], x: number): number {
  let idx = 0;
  for (let i = 0; i < bands.length; i++) if (bands[i].lower_x <= x) idx = i;
  return idx;
}

function checks(config: IncentiveConfig, volumes: ProductVolumes, which: 'min_threshold' | 'oa_threshold'): ProductCheck[] {
  return config.products.map(p => {
    const actual = num(volumes[p.key]);
    const threshold = p[which];
    const met = actual >= threshold;
    return { key: p.key, label: p.label, unit: p.unit, actual, threshold, met, shortfall: met ? 0 : r2(threshold - actual) };
  });
}

export function computeIncentive({ config, salary, revenue, volumes }: IncentiveInput): IncentiveResult {
  const { rules, bands } = config;
  const sal = num(salary);
  const rev = num(revenue);
  const hasSalary = sal > 0;
  // Excel: IFERROR(revenue/salary, 0).
  const x = hasSalary ? rev / sal : 0;
  const bandIndex = bandIndexFor(bands, x);
  const band = bands[bandIndex];

  const minChecks = checks(config, volumes, 'min_threshold');
  const oaChecks = checks(config, volumes, 'oa_threshold');
  const productsMet = minChecks.filter(c => c.met).length;
  const oaMet = oaChecks.filter(c => c.met).length;
  const productsRequired = !rules.product_mandate ? 0
    : x < rules.product_switch_x
      ? rules.products_required_below_switch
      : rules.products_required_at_or_above_switch;

  const ineligibleReasons: string[] = [];
  if (!hasSalary) ineligibleReasons.push('No active salary structure for this month');
  else if (x < rules.min_x) ineligibleReasons.push(`Revenue is below ${rules.min_x}x of salary`);
  if (productsMet < productsRequired) {
    ineligibleReasons.push(`${productsMet} of ${productsRequired} required products meet the minimum threshold`);
  }
  const eligible = ineligibleReasons.length === 0;

  const addonActive = x > rules.addon_min_x;
  const oaQualified = oaMet >= rules.oa_products_required;

  const base = hasSalary ? r2(sal * band.base_mult) : 0;
  const addon = hasSalary && addonActive ? r2(rev * band.addon_pct) : 0;
  const oaBonus = hasSalary && oaQualified ? r2(rev * band.oa_pct) : 0;
  const gross = r2(base + addon + oaBonus);
  const cap = r2(Math.max(0, rev) * rules.cap_pct_revenue);
  const capped = eligible && gross > cap;
  const final = eligible ? Math.min(gross, cap) : 0;

  return {
    hasSalary, salary: sal, revenue: rev, x, bandIndex, band,
    eligible, ineligibleReasons, productsRequired, productsMet, minChecks,
    oaRequired: rules.oa_products_required, oaMet, oaQualified, oaChecks,
    addonActive, base, addon, oaBonus, gross, cap, capped, final: r2(final),
  };
}

// ---------------------------------------------------------------------------
// "What do I need next?" — the tracker's goals
// ---------------------------------------------------------------------------

export interface RevenueGoal {
  label: string;
  /** Revenue at which the goal is reached. */
  targetRevenue: number;
  /** Revenue still to do; 0 when reached. */
  gap: number;
  /** Incentive at the target revenue with today's product figures. */
  projectedIncentive: number;
}

export interface ProductGoal {
  /** Products still needed to reach the count. */
  needed: number;
  /** The cheapest products to push over the line, smallest shortfall first. */
  suggestions: ProductCheck[];
}

export interface IncentiveGoals {
  nextBand: (RevenueGoal & { band: IncentiveBand }) | null;
  minRevenue: RevenueGoal | null;
  addonUnlock: RevenueGoal | null;
  eligibility: ProductGoal | null;
  overAchievement: (ProductGoal & { bonusPctAtBand: number }) | null;
}

function productGoal(chk: ProductCheck[], required: number, met: number): ProductGoal | null {
  if (met >= required) return null;
  const needed = required - met;
  const suggestions = chk.filter(c => !c.met).sort((a, b) => a.shortfall - b.shortfall).slice(0, needed);
  return { needed, suggestions };
}

export function nextGoals(input: IncentiveInput, current?: IncentiveResult): IncentiveGoals {
  const cur = current ?? computeIncentive(input);
  const { config } = input;
  const empty: IncentiveGoals = { nextBand: null, minRevenue: null, addonUnlock: null, eligibility: null, overAchievement: null };
  if (!cur.hasSalary) return empty;

  const atRevenue = (targetRevenue: number): number =>
    computeIncentive({ ...input, revenue: targetRevenue }).final;
  const revenueGoal = (label: string, targetRevenue: number): RevenueGoal => {
    const t = r2(targetRevenue);
    return { label, targetRevenue: t, gap: r2(Math.max(0, t - cur.revenue)), projectedIncentive: atRevenue(t) };
  };

  const next = config.bands[cur.bandIndex + 1];
  const nextBand = next
    ? { ...revenueGoal(`Reach ${next.label}`, next.lower_x * cur.salary), band: next }
    : null;

  const minRevenue = cur.x < config.rules.min_x
    ? revenueGoal(`Reach ${config.rules.min_x}x to start earning`, config.rules.min_x * cur.salary)
    : null;

  // "Strictly above" — one rupee over the line is the smallest revenue that unlocks it.
  const addonUnlock = !cur.addonActive
    ? revenueGoal(`Cross ${config.rules.addon_min_x}x to unlock the revenue add-on`, config.rules.addon_min_x * cur.salary + 1)
    : null;

  const eligibility = productGoal(cur.minChecks, cur.productsRequired, cur.productsMet);
  const oa = productGoal(cur.oaChecks, cur.oaRequired, cur.oaMet);
  const overAchievement = oa ? { ...oa, bonusPctAtBand: cur.band.oa_pct } : null;

  return { nextBand, minRevenue, addonUnlock, eligibility, overAchievement };
}

// ---------------------------------------------------------------------------
// Small helpers shared by the screens
// ---------------------------------------------------------------------------

/**
 * The config a month is actually calculated with: the structure version, with
 * the multi-product mandate overridden when admin has switched it for that
 * month (null = no override, use the structure's own setting).
 */
export function effectiveConfig(config: IncentiveConfig, productMandate: boolean | null | undefined): IncentiveConfig {
  if (productMandate === null || productMandate === undefined || productMandate === config.rules.product_mandate) return config;
  return { ...config, rules: { ...config.rules, product_mandate: productMandate } };
}

/** Manual figures win over auto figures, per product. Blank manual = use auto. */
export function mergeVolumes(auto: ProductVolumes, manual: Partial<ProductVolumes> | null | undefined): ProductVolumes {
  const out: ProductVolumes = { ...auto };
  for (const [k, v] of Object.entries(manual ?? {})) {
    if (v === null || v === undefined || (typeof v === 'string' && v === '')) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** 'YYYY-MM-01' for a year and 0-based month. */
export function periodKey(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, '0')}-01`;
}

/** The payroll month an incentive for `period` (YYYY-MM-01) is paid in. */
export function payrollMonthFor(period: string): { year: number; month0: number } {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? { year: y + 1, month0: 0 } : { year: y, month0: m };
}
