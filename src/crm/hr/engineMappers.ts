/**
 * Mapping database rows onto the shapes the payroll engine expects.
 *
 * Its own module because both the salary editor and the payroll workspace need
 * it: having PayrollAdmin import a mapper from SalaryAdmin made a screen
 * component the home of shared logic, and meant editing one screen could break
 * the other. One definition, so a column rename cannot be half-applied.
 */

import type { ComponentSlabRow, SalaryComponentRow, SalaryStructureRow, StructureLineRow } from './hrTypes';
import type { SalaryComponent, SalaryStructure } from '../../lib/hr/types';

/** DB row -> engine component. One place, so the mapping cannot drift. */
export function toEngineComponent(c: SalaryComponentRow, slabs: ComponentSlabRow[] = []): SalaryComponent {
  return {
    id: c.id, code: c.code, name: c.name,
    kind: c.kind as SalaryComponent['kind'],
    calc_type: c.calc_type as SalaryComponent['calc_type'],
    percent_of: (c.percent_of ?? null) as SalaryComponent['percent_of'],
    percent_of_component_id: c.percent_of_component_id,
    default_percent: c.default_percent,
    cap_base: c.cap_base, cap_amount: c.cap_amount, floor_amount: c.floor_amount,
    eligibility_max_gross: c.eligibility_max_gross,
    prorate_on_lop: c.prorate_on_lop, taxable: c.taxable,
    include_in_gross: c.include_in_gross, include_in_ctc: c.include_in_ctc,
    show_on_payslip: c.show_on_payslip, is_recurring: c.is_recurring,
    sort_order: c.sort_order,
    slabs: slabs.filter(s => s.component_id === c.id)
      .map(s => ({ from_amount: Number(s.from_amount), to_amount: s.to_amount === null ? null : Number(s.to_amount), amount: Number(s.amount) })),
  };
}

export function toEngineStructure(s: SalaryStructureRow, lines: StructureLineRow[]): SalaryStructure {
  return {
    id: s.id, employee_id: s.employee_id,
    effective_from: s.effective_from, effective_to: s.effective_to,
    ctc_annual: Number(s.ctc_annual), gross_monthly: Number(s.gross_monthly),
    lines: lines.filter(l => l.structure_id === s.id).map(l => ({
      component_id: l.component_id,
      calc_type: l.calc_type as SalaryStructure['lines'][number]['calc_type'],
      amount_monthly: Number(l.amount_monthly),
      percent_value: l.percent_value === null ? null : Number(l.percent_value),
      sort_order: l.sort_order,
    })),
  };
}
