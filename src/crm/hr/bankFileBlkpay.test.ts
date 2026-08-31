import { describe, it, expect } from 'vitest';
import { buildBankFile, transactionType, type BankTemplate } from '../../lib/hr/bankFile';

/*
 * The salary file is uploaded straight into IDFC's bulk-payment screen, so
 * "close enough" is a rejected file on payday. These fixtures are the bank's
 * own BLKPAY_YYYYMMDD.xlsx, transcribed exactly -- the fifteen headers and the
 * instruction text of row 2, CRLF wrapping and EN DASHes included.
 *
 * Transcribed rather than read from disk on purpose: a test that opens a file
 * in somebody's Downloads folder passes on one machine and fails everywhere
 * else. If the bank reissues the template, update these two lists and the test
 * will tell you what no longer lines up.
 */
const ISSUED_HEADERS = [
  "Beneficiary Name",
  "Beneficiary Account Number",
  "IFSC",
  "Transaction Type",
  "Debit Account Number",
  "Transaction Date",
  "Amount",
  "Currency",
  "Beneficiary Email ID",
  "Remarks",
  "Custom Header – 1",
  "Custom Header – 2",
  "Custom Header – 3",
  "Custom Header – 4",
  "Custom Header – 5",
];

const ISSUED_INSTRUCTIONS = [
  "Enter beneficiary name.\r\nMANDATORY",
  "Enter beneficiary account number. \r\nThis can be IDFC FIRST Bank account or other Bank account.\r\nMANDATORY",
  "Enter beneficiary bank IFSC code. Required only for Inter bank (NEFT/RTGS) payment.",
  "Enter payment type:\r\nIFT - Within Bank payment\r\nNEFT - Inter-Bank(NEFT) payment\r\nRTGS - Inter-Bank(RTGS) payment\r\nMANDATORY",
  "Enter debit account number. This should be IDFC FIRST Bank account only. User should have access to do transaction on this account",
  "Enter transaction value date. Should be today's date or future date.\r\nMANDATORY\r\nDD/MM/YYYY format",
  "Enter payment amount.\r\nMANDATORY",
  "Enter transaction currency. Should be INR only.\r\nMANDATORY",
  "Enter beneficiary email id\r\nOPTIONAL",
  "Enter remarks\r\nOPTIONAL",
  "Credit Advice:\r\nEnter Custom Info -1\r\nNote: Header label is editable in Row 1\r\nOPTIONAL",
  "Credit Advice:\r\nEnter Custom Info -2\r\nNote: Header label is editable in Row 1\r\nOPTIONAL",
  "Credit Advice:\r\nEnter Custom Info -3\r\nNote: Header label is editable in Row 1\r\nOPTIONAL",
  "Credit Advice:\r\nEnter Custom Info -4\r\nNote: Header label is editable in Row 1\r\nOPTIONAL",
  "Credit Advice:\r\nEnter Custom Info -5\r\nNote: Header label is editable in Row 1\r\nOPTIONAL",
];

/** The stored template, as hr_42 configures it. */
const COLUMNS = [
  {
    "position": 1,
    "header_label": "Beneficiary Name",
    "source": "account_holder",
    "constant_value": "",
    "required": true,
    "transform": "none",
    "max_length": null,
    "instruction_text": "Enter beneficiary name.\r\nMANDATORY"
  },
  {
    "position": 2,
    "header_label": "Beneficiary Account Number",
    "source": "bank_account",
    "constant_value": "",
    "required": true,
    "transform": "digits_only",
    "max_length": null,
    "instruction_text": "Enter beneficiary account number. \r\nThis can be IDFC FIRST Bank account or other Bank account.\r\nMANDATORY"
  },
  {
    "position": 3,
    "header_label": "IFSC",
    "source": "bank_ifsc",
    "constant_value": "",
    "required": false,
    "transform": "upper",
    "max_length": 11,
    "instruction_text": "Enter beneficiary bank IFSC code. Required only for Inter bank (NEFT/RTGS) payment."
  },
  {
    "position": 4,
    "header_label": "Transaction Type",
    "source": "transaction_type",
    "constant_value": "",
    "required": true,
    "transform": "none",
    "max_length": null,
    "instruction_text": "Enter payment type:\r\nIFT - Within Bank payment\r\nNEFT - Inter-Bank(NEFT) payment\r\nRTGS - Inter-Bank(RTGS) payment\r\nMANDATORY"
  },
  {
    "position": 5,
    "header_label": "Debit Account Number",
    "source": "debit_account",
    "constant_value": "",
    "required": true,
    "transform": "digits_only",
    "max_length": null,
    "instruction_text": "Enter debit account number. This should be IDFC FIRST Bank account only. User should have access to do transaction on this account"
  },
  {
    "position": 6,
    "header_label": "Transaction Date",
    "source": "payment_date",
    "constant_value": "",
    "required": true,
    "transform": "none",
    "max_length": null,
    "instruction_text": "Enter transaction value date. Should be today's date or future date.\r\nMANDATORY\r\nDD/MM/YYYY format"
  },
  {
    "position": 7,
    "header_label": "Amount",
    "source": "net_pay",
    "constant_value": "",
    "required": true,
    "transform": "none",
    "max_length": null,
    "instruction_text": "Enter payment amount.\r\nMANDATORY"
  },
  {
    "position": 8,
    "header_label": "Currency",
    "source": "constant",
    "constant_value": "INR",
    "required": true,
    "transform": "none",
    "max_length": null,
    "instruction_text": "Enter transaction currency. Should be INR only.\r\nMANDATORY"
  },
  {
    "position": 9,
    "header_label": "Beneficiary Email ID",
    "source": "constant",
    "constant_value": "",
    "required": false,
    "transform": "none",
    "max_length": null,
    "instruction_text": "Enter beneficiary email id\r\nOPTIONAL"
  },
  {
    "position": 10,
    "header_label": "Remarks",
    "source": "remarks",
    "constant_value": "",
    "required": false,
    "transform": "none",
    "max_length": 30,
    "instruction_text": "Enter remarks\r\nOPTIONAL"
  },
  {
    "position": 11,
    "header_label": "Custom Header – 1",
    "source": "constant",
    "constant_value": "",
    "required": false,
    "transform": "none",
    "max_length": null,
    "instruction_text": "Credit Advice:\r\nEnter Custom Info -1\r\nNote: Header label is editable in Row 1\r\nOPTIONAL"
  },
  {
    "position": 12,
    "header_label": "Custom Header – 2",
    "source": "constant",
    "constant_value": "",
    "required": false,
    "transform": "none",
    "max_length": null,
    "instruction_text": "Credit Advice:\r\nEnter Custom Info -2\r\nNote: Header label is editable in Row 1\r\nOPTIONAL"
  },
  {
    "position": 13,
    "header_label": "Custom Header – 3",
    "source": "constant",
    "constant_value": "",
    "required": false,
    "transform": "none",
    "max_length": null,
    "instruction_text": "Credit Advice:\r\nEnter Custom Info -3\r\nNote: Header label is editable in Row 1\r\nOPTIONAL"
  },
  {
    "position": 14,
    "header_label": "Custom Header – 4",
    "source": "constant",
    "constant_value": "",
    "required": false,
    "transform": "none",
    "max_length": null,
    "instruction_text": "Credit Advice:\r\nEnter Custom Info -4\r\nNote: Header label is editable in Row 1\r\nOPTIONAL"
  },
  {
    "position": 15,
    "header_label": "Custom Header – 5",
    "source": "constant",
    "constant_value": "",
    "required": false,
    "transform": "none",
    "max_length": null,
    "instruction_text": "Credit Advice:\r\nEnter Custom Info -5\r\nNote: Header label is editable in Row 1\r\nOPTIONAL"
  }
] as BankTemplate['columns'];

const template: BankTemplate = {
  name: 'IDFC FIRST Bulk Payment (BLKPAY)', sheet_name: 'Sheet1',
  include_header: true, include_instructions: true,
  date_format: 'DD/MM/YYYY', amount_format: '2dp',
  debit_account: '10012345678', debit_ifsc: 'IDFB0080131',
  columns: COLUMNS,
};

const inHouse = {
  employee_code: 'N-1', full_name: 'Prabhu S', account_holder: 'PRABHU S',
  bank_name: 'IDFC FIRST BANK', bank_account: '10120211772', bank_ifsc: 'IDFB0080131',
  net_pay: 47000, remarks: 'Salary Aug 2026',
};
const outside = {
  employee_code: 'N-2', full_name: 'Outside Person', account_holder: 'OUTSIDE PERSON',
  bank_name: 'STATE BANK OF INDIA', bank_account: '30012345678', bank_ifsc: 'SBIN0001234',
  net_pay: 25000, remarks: 'Salary Aug 2026',
};

describe('the salary file against the bank\'s issued sheet', () => {
  const built = buildBankFile(template, [inHouse, outside], '2026-08-31');

  it('has the bank\'s fifteen headers, verbatim and in order', () => {
    expect(built.grid[0]).toEqual(ISSUED_HEADERS);
  });

  it('reproduces the instruction row verbatim, CRLF and all', () => {
    expect(built.grid[1]).toEqual(ISSUED_INSTRUCTIONS);
  });

  it('starts the payees at row 3, where the issued sheet starts its examples', () => {
    expect(built.grid).toHaveLength(4);
    expect(built.grid[2][0]).toBe('PRABHU S');
  });

  it('every row is fifteen cells wide', () => {
    for (const row of built.grid) expect(row).toHaveLength(15);
  });

  it('writes the amount as a NUMBER, not text', () => {
    // The classic way a bulk upload is rejected, or silently truncated.
    expect(built.grid[2][6]).toBe(47000);
    expect(typeof built.grid[2][6]).toBe('number');
  });

  it('dates DD/MM/YYYY and prices in INR, as the template demands', () => {
    expect(built.grid[2][5]).toBe('31/08/2026');
    expect(built.grid[2][7]).toBe('INR');
  });

  it('carries the company debit account on every row', () => {
    expect(built.grid[2][4]).toBe('10012345678');
    expect(built.grid[3][4]).toBe('10012345678');
  });

  it('builds clean and totals the run', () => {
    expect(built.issues).toEqual([]);
    expect(built.valid).toBe(true);
    expect(built.total_amount).toBe(72000);
  });
});

describe('routing each payee', () => {
  const built = buildBankFile(template, [inHouse, outside], '2026-08-31');

  it('sends an IDFC beneficiary as IFT with no IFSC, like the bank\'s own example', () => {
    expect(built.grid[2][3]).toBe('IFT');
    expect(built.grid[2][2]).toBe('');
  });

  it('sends another bank as NEFT and keeps the IFSC', () => {
    expect(built.grid[3][3]).toBe('NEFT');
    expect(built.grid[3][2]).toBe('SBIN0001234');
  });

  it('decides on the bank code alone, not the branch', () => {
    expect(transactionType('IDFB0080133', 'IDFB0080131')).toBe('IFT');
    expect(transactionType('idfb0080133', 'IDFB0080131')).toBe('IFT');
    expect(transactionType('SBIN0001234', 'IDFB0080131')).toBe('NEFT');
  });

  it('falls back to NEFT when the company IFSC is unknown, and says so once', () => {
    // NEFT reaches any bank, so an unknown answer errs towards the payment
    // arriving -- but silently guessing on a money file is not acceptable.
    const built2 = buildBankFile({ ...template, debit_ifsc: '' }, [inHouse, outside], '2026-08-31');
    expect(built2.grid[2][3]).toBe('NEFT');
    expect(built2.issues.filter(i => i.column === 'Transaction Type')).toHaveLength(1);
  });
});

describe('refusing a file the bank would reject', () => {
  it('will not build without the company debit account', () => {
    const bad = buildBankFile({ ...template, debit_account: '' }, [inHouse], '2026-08-31');
    expect(bad.valid).toBe(false);
    expect(bad.issues.some(i => i.column === 'Debit Account Number')).toBe(true);
  });

  it('will not build a row with no beneficiary account number', () => {
    const bad = buildBankFile(template, [{ ...inHouse, bank_account: '' }], '2026-08-31');
    expect(bad.valid).toBe(false);
    expect(bad.issues.some(i => i.column === 'Beneficiary Account Number')).toBe(true);
  });

  it('will not build a row with a zero amount', () => {
    const bad = buildBankFile(template, [{ ...inHouse, net_pay: 0 }], '2026-08-31');
    expect(bad.valid).toBe(false);
    expect(bad.issues.some(i => /positive amount/.test(i.message))).toBe(true);
  });
});
