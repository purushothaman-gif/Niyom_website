/**
 * The payroll calculation engine.
 *
 * ONE implementation of the arithmetic, kept pure so it can be tested without a
 * database, a browser or a network. The UI runs it to produce a run; the server
 * then RE-DERIVES every total from the submitted lines in
 * hr_payroll_write_records() and rejects the payload if the numbers do not
 * close. Nothing here is trusted -- it is the proposer, not the authority.
 *
 * NO INDIAN TAX LAW IS COMPILED IN. PF, ESI, PT and TDS reach this file as
 * ordinary components whose rates, ceilings and eligibility limits the admin
 * owns. The engine only knows four ways to value a component:
 *
 *   fixed       a rupee amount from the structure line
 *   percent_of  a percentage of basic / gross / CTC / another component
 *   balance     whatever is left of monthly gross after every other earning
 *   slab        a lookup against the component's own slab table
 *
 * ORDER OF OPERATIONS, and why it is this order:
 *
 *   1. Value every recurring EARNING at its full monthly entitlement.
 *   2. Pro-rate those earnings for LOP.
 *   3. Deductions and employer contributions are computed from the PRO-RATED
 *      figures, because PF on a half-worked month is PF on half the basic --
 *      computing them first and pro-rating after gives a different, wrong
 *      answer.
 *   4. Adjustments (bonus, incentive, loan recovery) fold in.
 *   5. Net = gross earnings - deductions. Employer contributions are a company
 *      cost: they belong to CTC and must never touch take-home.
 */

import type {
  AttendanceSummary, ComponentKind, LopDivisorMode,
  PayrollException, PayrollInput, PayrollLine, PayrollResult,
  SalaryComponent, StructureLine,
} from './types.ts';

/** Round to paise. Money is never carried at full float precision. */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * The divisor a month's pay is split by to get a day rate.
 *
 * Deliberately configurable: organisations genuinely differ, and picking one
 * silently is a payroll bug that shows up as everyone being underpaid in a
 * 31-day month or overpaid in February.
 */
export function lopDivisor(mode: LopDivisorMode, att: AttendanceSummary): number {
  switch (mode) {
    case 'fixed_30':      return 30;
    case 'working_days':  return att.working_days > 0 ? att.working_days : att.calendar_days || 30;
    case 'payable_days':  return att.working_days > 0 ? att.working_days : att.calendar_days || 30;
    case 'calendar_days':
    default:              return att.calendar_days > 0 ? att.calendar_days : 30;
  }
}

/**
 * The fraction of a full month's entitlement that is actually payable.
 *
 * Driven by UNPAYABLE days -- calendar days minus payable days -- rather than
 * by `lop_days`, and that distinction is the whole point.
 *
 * `lop_days` counts absence by someone who was employed and expected to work.
 * It deliberately EXCLUDES the days before a joiner started and after a leaver
 * finished, because those are not absence and counting them as such would dock
 * a joiner for not existing yet (see summariseAttendance). But those days are
 * still not payable, and reading only `lop_days` here meant a mid-month joiner
 * came out at a ratio of 1.0 -- a full month's pay for a fortnight's work.
 *
 * Both modules were correct in isolation; they disagreed at the seam. The
 * shortfall against the calendar covers both causes at once and needs no
 * special case for either.
 *
 * `payable_days` mode is different in kind: it pays strictly for days earned
 * out of the organisation's working days, so it keeps its own formula.
 */
export function payableRatio(mode: LopDivisorMode, att: AttendanceSummary): number {
  const divisor = lopDivisor(mode, att);
  if (divisor <= 0) return 1;

  if (mode === 'payable_days') {
    const ratio = att.payable_days / divisor;
    return Math.min(1, Math.max(0, ratio));
  }

  // Everything the month did not pay for, whatever the reason.
  const unpayable = Math.max(0, att.calendar_days - att.payable_days);
  const ratio = (divisor - unpayable) / divisor;
  return Math.min(1, Math.max(0, ratio));
}

/** Slab lookup for calc_type = 'slab'. Slabs are inclusive of from, exclusive of to. */
export function slabAmount(component: SalaryComponent, base: number): number {
  const slabs = component.slabs ?? [];
  for (const s of slabs) {
    const aboveFloor = base >= s.from_amount;
    const belowCeil = s.to_amount === null || base < s.to_amount;
    if (aboveFloor && belowCeil) return s.amount;
  }
  return 0;
}

/** Apply cap_base to a percentage base, then cap_amount / floor_amount to the result. */
function applyBounds(component: SalaryComponent, base: number, percent: number): number {
  const cappedBase = component.cap_base !== null ? Math.min(base, component.cap_base) : base;
  let value = (cappedBase * percent) / 100;
  if (component.cap_amount !== null) value = Math.min(value, component.cap_amount);
  if (component.floor_amount !== null) value = Math.max(value, component.floor_amount);
  return round2(value);
}

interface Ctx {
  basic: number;
  /** Sum of earnings that count toward gross. */
  gross: number;
  ctcMonthly: number;
  /** Resolved value of each component, by component id. */
  byId: Map<string, number>;
}

function valueOf(component: SalaryComponent, line: StructureLine | null, ctx: Ctx): number {
  const percent = line?.percent_value ?? component.default_percent ?? 0;

  switch (component.calc_type) {
    case 'fixed':
      return round2(line?.amount_monthly ?? 0);

    case 'slab':
      return round2(slabAmount(component, ctx.gross));

    case 'percent_of': {
      let base = 0;
      switch (component.percent_of) {
        case 'basic':     base = ctx.basic; break;
        case 'gross':     base = ctx.gross; break;
        case 'ctc':       base = ctx.ctcMonthly; break;
        case 'component': base = ctx.byId.get(component.percent_of_component_id ?? '') ?? 0; break;
        default:          base = 0;
      }
      return applyBounds(component, base, percent);
    }

    case 'balance':
      // Filled in by the caller once every other earning is known.
      return 0;

    default:
      return 0;
  }
}

/** A component switches off entirely above its eligibility ceiling (ESI-style). */
function isEligible(component: SalaryComponent, gross: number): boolean {
  if (component.eligibility_max_gross === null) return true;
  return gross <= component.eligibility_max_gross;
}

export function calculatePayroll(input: PayrollInput): PayrollResult {
  const { employee, structure, components, attendance, adjustments, rules } = input;
  const exceptions: PayrollException[] = [];
  const byId = new Map(components.map(c => [c.id, c]));

  /*
   * Whole rupees or paise -- a per-organisation choice.
   *
   * Applied as each component is SETTLED, not once at the end, and the
   * difference is not cosmetic. On a gross of 27,657 the basic is 13,828.50.
   * Round at settlement and HRA is 50% of 13,829 = 6,915; round only at output
   * and it is 50% of 13,828.50 = 6,914. Three rupees a month move between HRA
   * and the balancing allowance -- the gross is identical either way, so the
   * error hides in the totals and only shows up per component, which is exactly
   * where a reconstructed payslip is compared against the original.
   */
  const money = rules.round_components_to_rupee
    ? (n: number) => Math.round(n)
    : round2;

  const divisor = lopDivisor(rules.lop_divisor_mode, attendance);

  // ---- No structure: nothing to compute, and the run must not silently pay 0.
  if (!structure || structure.lines.length === 0) {
    exceptions.push({
      code: 'no_salary_structure',
      severity: 'blocker',
      message: `${employee.full_name} has no salary structure effective for this period.`,
    });
    return {
      employee_id: employee.employee_id,
      structure_id: structure?.id ?? null,
      lines: [], gross_earnings: 0, total_deductions: 0, employer_contrib: 0,
      lop_amount: 0, net_pay: 0, ctc_annual: structure?.ctc_annual ?? 0,
      lop_days: attendance.lop_days, payable_days: attendance.payable_days,
      lop_waived_days: attendance.lop_waived_days ?? 0,
      lop_divisor: divisor, exceptions, payable: false,
    };
  }

  const ctcMonthly = round2(structure.ctc_annual / 12);
  const ctx: Ctx = { basic: 0, gross: 0, ctcMonthly, byId: new Map() };

  const linesFor = (kind: ComponentKind) =>
    structure.lines
      .map(l => ({ line: l, component: byId.get(l.component_id) }))
      .filter((x): x is { line: StructureLine; component: SalaryComponent } =>
        !!x.component && x.component.kind === kind && x.component.is_recurring)
      .sort((a, b) => a.component.sort_order - b.component.sort_order);

  // =========================================================================
  // 1. Full monthly entitlement for every recurring earning.
  // =========================================================================
  const earningRows = linesFor('earning');

  // Pass A -- fixed. Basic is almost always fixed and everything else keys off it.
  for (const { line, component } of earningRows) {
    if (component.calc_type !== 'fixed') continue;
    const v = money(valueOf(component, line, ctx));
    ctx.byId.set(component.id, v);
    if (component.code === 'BASIC') ctx.basic = v;
  }
  // A structure without a component literally coded BASIC still needs a basic:
  // fall back to the first fixed earning, which is what it is in practice.
  if (ctx.basic === 0) {
    const firstFixed = earningRows.find(r => r.component.calc_type === 'fixed');
    if (firstFixed) ctx.basic = ctx.byId.get(firstFixed.component.id) ?? 0;
  }

  // Pass B -- percentages and slabs off basic / CTC / another component.
  for (const { line, component } of earningRows) {
    if (component.calc_type === 'fixed' || component.calc_type === 'balance') continue;
    if (component.percent_of === 'gross') continue;  // needs the balance first
    ctx.byId.set(component.id, money(valueOf(component, line, ctx)));
  }

  // Pass C -- the balancing component absorbs the remainder of monthly gross.
  const balanceRows = earningRows.filter(r => r.component.calc_type === 'balance');
  if (balanceRows.length > 1) {
    exceptions.push({
      code: 'gross_mismatch', severity: 'blocker',
      message: 'More than one balancing component in this structure. Only one may absorb the remainder.',
    });
  }
  if (balanceRows.length === 1) {
    const allocated = earningRows
      .filter(r => r.component.calc_type !== 'balance' && r.component.include_in_gross)
      .reduce((sum, r) => sum + (ctx.byId.get(r.component.id) ?? 0), 0);
    ctx.byId.set(balanceRows[0].component.id, money(Math.max(0, structure.gross_monthly - allocated)));
  }

  // Gross of the FULL month, which is the base for gross-percentage components.
  ctx.gross = round2(earningRows
    .filter(r => r.component.include_in_gross)
    .reduce((sum, r) => sum + (ctx.byId.get(r.component.id) ?? 0), 0));

  // Pass D -- earnings expressed as a percentage of gross. Their own value is
  // deliberately NOT folded back into the percentage base; that would be
  // circular, and no real component is defined that way.
  for (const { line, component } of earningRows) {
    if (component.calc_type === 'percent_of' && component.percent_of === 'gross') {
      ctx.byId.set(component.id, money(valueOf(component, line, ctx)));
    }
  }
  ctx.gross = round2(earningRows
    .filter(r => r.component.include_in_gross)
    .reduce((sum, r) => sum + (ctx.byId.get(r.component.id) ?? 0), 0));

  if (structure.gross_monthly > 0 && Math.abs(ctx.gross - structure.gross_monthly) > 1) {
    exceptions.push({
      code: 'gross_mismatch', severity: 'warning',
      message: `Components total ${ctx.gross.toFixed(2)} but the structure records a monthly gross of ` +
               `${structure.gross_monthly.toFixed(2)}. Payroll uses the components.`,
    });
  }

  // =========================================================================
  // 2. Pro-rate for loss of pay.
  // =========================================================================
  const ratio = payableRatio(rules.lop_divisor_mode, attendance);
  const lines: PayrollLine[] = [];
  let lopAmount = 0;

  const proratedBase = new Map<string, number>();
  for (const { component } of earningRows) {
    const base = money(ctx.byId.get(component.id) ?? 0);
    const amount = component.prorate_on_lop ? money(base * ratio) : base;
    proratedBase.set(component.id, amount);
    if (component.prorate_on_lop) lopAmount += base - amount;

    lines.push({
      component_id: component.id,
      component_code: component.code,
      component_name: component.name,
      kind: 'earning',
      base_amount: base,
      amount,
      prorated: component.prorate_on_lop && amount !== base,
      taxable: component.taxable,
      show_on_payslip: component.show_on_payslip,
      adjustment_id: null,
      sort_order: component.sort_order,
    });
  }

  const proratedBasic = proratedBase.get(
    earningRows.find(r => r.component.code === 'BASIC')?.component.id ?? '') ??
    money(ctx.basic * ratio);

  const proratedGross = round2(earningRows
    .filter(r => r.component.include_in_gross)
    .reduce((sum, r) => sum + (proratedBase.get(r.component.id) ?? 0), 0));

  // =========================================================================
  // 3. Deductions and employer contributions, off the PRO-RATED figures.
  // =========================================================================
  const dctx: Ctx = {
    basic: proratedBasic,
    gross: proratedGross,
    ctcMonthly,
    byId: new Map(proratedBase),
  };

  const computeSide = (kind: Exclude<ComponentKind, 'earning'>) => {
    for (const { line, component } of linesFor(kind)) {
      // Eligibility is judged on the FULL-month gross: a ceiling like ESI's is
      // a property of the salary, not of how many days happened to be worked.
      if (!isEligible(component, ctx.gross)) continue;

      const base = money(valueOf(component, line, dctx));
      if (base === 0 && component.calc_type === 'fixed' && (line?.amount_monthly ?? 0) === 0) continue;

      // Fixed deductions (PT, TDS) are a monthly figure, not a day rate, so
      // they are not scaled down by LOP unless the component says so.
      const amount = component.prorate_on_lop && component.calc_type === 'fixed'
        ? money(base * ratio)
        : base;

      dctx.byId.set(component.id, amount);
      lines.push({
        component_id: component.id,
        component_code: component.code,
        component_name: component.name,
        kind,
        base_amount: base,
        amount,
        prorated: amount !== base,
        taxable: component.taxable,
        show_on_payslip: component.show_on_payslip,
        adjustment_id: null,
        sort_order: component.sort_order,
      });
    }
  };

  computeSide('deduction');
  computeSide('employer_contribution');

  // =========================================================================
  // 4. One-off adjustments.
  // =========================================================================
  for (const adj of adjustments) {
    const component = adj.component_id ? byId.get(adj.component_id) : undefined;
    const base = money(adj.amount);
    const amount = adj.prorate_on_lop ? money(base * ratio) : base;

    lines.push({
      component_id: adj.component_id,
      component_code: component?.code ?? 'ADJ',
      component_name: adj.label || component?.name || 'Adjustment',
      kind: adj.kind,
      base_amount: base,
      amount,
      prorated: amount !== base,
      taxable: adj.taxable,
      show_on_payslip: true,
      adjustment_id: adj.id,
      sort_order: (component?.sort_order ?? 500) + 500,
    });
  }

  // =========================================================================
  // 5. Totals.
  // =========================================================================
  const sum = (kind: ComponentKind) =>
    round2(lines.filter(l => l.kind === kind).reduce((s, l) => s + l.amount, 0));

  const grossEarnings = sum('earning');
  const totalDeductions = sum('deduction');
  const employerContrib = sum('employer_contribution');

  let netPay = round2(grossEarnings - totalDeductions);
  if (rules.round_net_to_rupee) netPay = Math.round(netPay);

  // ---- Things a reviewer must look at before approving.
  if (!employee.bank_account || !employee.bank_ifsc) {
    exceptions.push({
      code: 'missing_bank_details', severity: 'blocker',
      message: `${employee.full_name} has no bank account on file, so they cannot be included in the transfer file.`,
    });
  }
  if (attendance.pending_punch_days > 0) {
    exceptions.push({
      code: 'unapproved_attendance', severity: 'blocker',
      message: `${attendance.pending_punch_days} day(s) have off-network punches still awaiting approval. ` +
               `They are not counted, so this pay may be understated.`,
    });
  }
  if ((attendance.lop_waived_days ?? 0) > 0) {
    // Deliberately an exception rather than a silent adjustment. Money moved
    // because a person decided it should, and the run should say so on its
    // face -- otherwise the only trace is in the audit log.
    exceptions.push({
      code: 'lop_waived', severity: 'info',
      message: `${attendance.lop_waived_days} day(s) of loss of pay waived by an administrator.`,
    });
  }
  if (attendance.lop_days > 0) {
    exceptions.push({
      code: attendance.payable_days <= 0 ? 'full_month_lop' : 'has_lop',
      severity: attendance.payable_days <= 0 ? 'blocker' : 'info',
      message: `${attendance.lop_days} day(s) loss of pay, reducing earnings by ` +
               `${round2(lopAmount).toFixed(2)}.`,
    });
  }
  if (netPay < 0) {
    exceptions.push({
      code: 'negative_net', severity: 'blocker',
      message: 'Deductions exceed earnings, so net pay is negative. Review the deductions before approving.',
    });
  }
  if (grossEarnings === 0) {
    exceptions.push({
      code: 'no_earnings', severity: 'blocker',
      message: 'No earnings were computed for this employee.',
    });
  }
  if (employee.joining_date && employee.joining_date > input.period.start_date &&
      employee.joining_date <= input.period.end_date) {
    exceptions.push({
      code: 'joined_mid_month', severity: 'info',
      message: `Joined on ${employee.joining_date}; days before that are not payable.`,
    });
  }
  if (employee.exit_date && employee.exit_date >= input.period.start_date &&
      employee.exit_date < input.period.end_date) {
    exceptions.push({
      code: 'exited_mid_month', severity: 'info',
      message: `Exited on ${employee.exit_date}; days after that are not payable.`,
    });
  }

  return {
    employee_id: employee.employee_id,
    structure_id: structure.id,
    lines: lines.sort((a, b) =>
      a.kind === b.kind ? a.sort_order - b.sort_order : kindRank(a.kind) - kindRank(b.kind)),
    gross_earnings: grossEarnings,
    total_deductions: totalDeductions,
    employer_contrib: employerContrib,
    lop_amount: round2(lopAmount),
    net_pay: netPay,
    ctc_annual: structure.ctc_annual,
    lop_days: attendance.lop_days,
    payable_days: attendance.payable_days,
    lop_waived_days: attendance.lop_waived_days ?? 0,
    lop_divisor: divisor,
    exceptions,
    payable: !exceptions.some(e => e.severity === 'blocker'),
  };
}

function kindRank(k: ComponentKind): number {
  return k === 'earning' ? 0 : k === 'deduction' ? 1 : 2;
}

/** Totals across a whole run, for the payroll dashboard. */
export function summariseRun(results: PayrollResult[]) {
  const included = results.filter(r => r.payable);
  return {
    employee_count: included.length,
    excluded_count: results.length - included.length,
    total_gross: round2(included.reduce((s, r) => s + r.gross_earnings, 0)),
    total_deductions: round2(included.reduce((s, r) => s + r.total_deductions, 0)),
    total_employer: round2(included.reduce((s, r) => s + r.employer_contrib, 0)),
    total_net: round2(included.reduce((s, r) => s + r.net_pay, 0)),
    total_lop_days: round2(included.reduce((s, r) => s + r.lop_days, 0)),
  };
}
