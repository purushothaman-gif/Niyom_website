/* The payroll engine lives under supabase/functions/_shared/hr so the Edge
 * Function bundler is guaranteed to ship it and the repo's existing vitest glob
 * covers it. This is a re-export, not a copy: two implementations of payroll
 * arithmetic would drift, and the drift would surface as a wrong payslip. */
export * from '../../../supabase/functions/_shared/hr/payrollEngine.ts';
