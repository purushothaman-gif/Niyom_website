/**
 * Building the bank bulk-transfer file from a configured template.
 *
 * Every bank wants a different sheet, so the columns are DATA (rows in
 * hr_bank_payment_template_columns), not code. This module turns those rows
 * plus a payroll run into a grid, and refuses to produce one that a bank would
 * reject at upload -- a file that fails validation at 6pm on payday is worse
 * than one that was never generated.
 *
 * The `source` list is deliberately closed and contains no salary breakdown:
 * a transfer file needs a beneficiary and an amount, and nothing about what
 * that amount was made of. There is no way to configure a column that leaks
 * basic, deductions or CTC.
 */

export type ColumnSource =
  | 'employee_name' | 'employee_code' | 'account_holder' | 'bank_name'
  | 'bank_account' | 'bank_ifsc' | 'net_pay' | 'payment_date'
  | 'remarks' | 'debit_account' | 'debit_ifsc' | 'sequence' | 'constant';

export type ColumnTransform = 'none' | 'upper' | 'lower' | 'trim' | 'digits_only';

export interface TemplateColumn {
  position: number;
  header_label: string;
  source: ColumnSource;
  constant_value: string;
  required: boolean;
  transform: ColumnTransform;
  max_length: number | null;
}

export interface BankTemplate {
  name: string;
  sheet_name: string;
  include_header: boolean;
  date_format: string;          // DD/MM/YYYY | YYYY-MM-DD | DD-MM-YYYY | DD-MMM-YYYY
  amount_format: '2dp' | 'integer';
  debit_account: string;
  debit_ifsc: string;
  columns: TemplateColumn[];
}

export interface PayeeRow {
  employee_code: string;
  full_name: string;
  account_holder: string;
  bank_name: string;
  bank_account: string;
  bank_ifsc: string;
  net_pay: number;
  remarks: string;
}

export interface BankFileIssue {
  row: number;                  // 1-based; 0 = the template itself
  employee_code: string;
  column: string;
  message: string;
}

export interface BankFileResult {
  sheet_name: string;
  /** Header row (when enabled) followed by one row per payee. */
  grid: (string | number)[][];
  row_count: number;
  total_amount: number;
  issues: BankFileIssue[];
  /** False when at least one issue would make the bank reject the upload. */
  valid: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string, pattern: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  switch (pattern) {
    case 'YYYY-MM-DD':  return `${y}-${m}-${d}`;
    case 'DD-MM-YYYY':  return `${d}-${m}-${y}`;
    case 'DD-MMM-YYYY': return `${d}-${MONTHS[Number(m) - 1] ?? m}-${y}`;
    case 'MM/DD/YYYY':  return `${m}/${d}/${y}`;
    case 'DD/MM/YYYY':
    default:            return `${d}/${m}/${y}`;
  }
}

function applyTransform(value: string, t: ColumnTransform): string {
  switch (t) {
    case 'upper':       return value.toUpperCase();
    case 'lower':       return value.toLowerCase();
    case 'trim':        return value.trim();
    case 'digits_only': return value.replace(/\D+/g, '');
    default:            return value;
  }
}

export function buildBankFile(
  template: BankTemplate,
  payees: PayeeRow[],
  paymentDate: string,
): BankFileResult {
  const issues: BankFileIssue[] = [];
  const columns = [...template.columns].sort((a, b) => a.position - b.position);

  if (columns.length === 0) {
    issues.push({ row: 0, employee_code: '', column: '', message: 'This template has no columns configured.' });
  }

  const grid: (string | number)[][] = [];
  if (template.include_header) grid.push(columns.map(c => c.header_label));

  let total = 0;

  payees.forEach((p, i) => {
    const rowNo = i + 1;
    const row: (string | number)[] = [];

    for (const col of columns) {
      // Amount stays a NUMBER in the sheet. Writing it as text is the classic
      // way a bulk-upload gets rejected, or worse, silently truncated.
      if (col.source === 'net_pay') {
        const amount = template.amount_format === 'integer'
          ? Math.round(p.net_pay)
          : round2(p.net_pay);
        if (!(amount > 0)) {
          issues.push({
            row: rowNo, employee_code: p.employee_code, column: col.header_label,
            message: `Net pay is ${amount}. A transfer row must carry a positive amount.`,
          });
        }
        row.push(amount);
        total += amount;
        continue;
      }

      let value: string;
      switch (col.source) {
        case 'employee_name':  value = p.full_name; break;
        case 'employee_code':  value = p.employee_code; break;
        case 'account_holder': value = p.account_holder || p.full_name; break;
        case 'bank_name':      value = p.bank_name; break;
        case 'bank_account':   value = p.bank_account; break;
        case 'bank_ifsc':      value = p.bank_ifsc; break;
        case 'payment_date':   value = formatDate(paymentDate, template.date_format); break;
        case 'remarks':        value = p.remarks; break;
        case 'debit_account':  value = template.debit_account; break;
        case 'debit_ifsc':     value = template.debit_ifsc; break;
        case 'sequence':       value = String(rowNo); break;
        case 'constant':       value = col.constant_value; break;
        default:               value = '';
      }

      value = applyTransform(value ?? '', col.transform);

      if (col.required && value.trim() === '') {
        issues.push({
          row: rowNo, employee_code: p.employee_code, column: col.header_label,
          message: `${col.header_label} is required by this template but is empty.`,
        });
      }

      // Truncating silently is how a wrong account number reaches a bank, so
      // it is reported even though the value is still trimmed to fit.
      if (col.max_length !== null && value.length > col.max_length) {
        issues.push({
          row: rowNo, employee_code: p.employee_code, column: col.header_label,
          message: `${col.header_label} is ${value.length} characters, longer than the ${col.max_length} this template allows. It has been truncated -- check it before uploading.`,
        });
        value = value.slice(0, col.max_length);
      }

      row.push(value);
    }

    grid.push(row);
  });

  if (payees.length === 0) {
    issues.push({ row: 0, employee_code: '', column: '', message: 'No employees to pay in this run.' });
  }

  return {
    sheet_name: template.sheet_name || 'Salary',
    grid,
    row_count: payees.length,
    total_amount: round2(total),
    issues,
    valid: issues.length === 0,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
