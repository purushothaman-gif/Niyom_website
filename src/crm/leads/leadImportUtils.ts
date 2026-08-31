// Lead Management — bulk import/export helpers. SheetJS is dynamically imported
// so the (heavy) xlsx parser never lands in the main bundle; it loads only when
// an admin actually opens the importer.

import { NWLead, LeadPriority } from './leadTypes';
import { PRIORITIES } from './leadConstants';
import { isValidMobile, isValidEmail, isValidPan } from './leadUtils';

// Template column header  ->  nw_leads insert field.
export const IMPORT_COLUMNS: { header: string; field: string; required?: boolean }[] = [
  { header: 'Lead Name', field: 'lead_name', required: true },
  { header: 'Mobile', field: 'mobile', required: true },
  { header: 'Alternate Number', field: 'alternate_number' },
  { header: 'Email', field: 'email' },
  { header: 'PAN', field: 'pan' },
  { header: 'Address', field: 'address' },
  { header: 'City', field: 'city' },
  { header: 'State', field: 'state' },
  { header: 'Occupation', field: 'occupation' },
  { header: 'Company Name', field: 'company_name' },
  { header: 'Age', field: 'age' },
  { header: 'Annual Income', field: 'annual_income' },
  { header: 'Investment Capacity', field: 'investment_capacity' },
  { header: 'Interested Product', field: 'interested_product' },
  { header: 'Lead Source', field: 'lead_source' },
  { header: 'Campaign', field: 'campaign' },
  { header: 'Priority', field: 'priority' },
  { header: 'Remarks', field: 'remarks' },
];

export interface LeadInsert {
  lead_name: string; mobile: string; alternate_number: string; email: string; pan: string;
  address: string; city: string; state: string; occupation: string; company_name: string;
  age: number | null; annual_income: number | null; investment_capacity: number | null;
  interested_product: string; lead_source: string; campaign: string;
  priority: LeadPriority; remarks: string;
}

export interface ParsedRow {
  rowNumber: number;
  data: LeadInsert;
  errors: string[];
  duplicate?: { matched_on: string; owner_name: string | null; status: string } | null;
}

const norm = (v: unknown): string => (v == null ? '' : String(v).trim());
const numOrNull = (v: unknown): number | null => {
  const s = norm(v).replace(/[₹,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
};

// Parse .xlsx / .xls / .csv → normalized rows keyed by our known headers.
export async function parseLeadFile(file: File): Promise<ParsedRow[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  // Build a case-insensitive header lookup so slightly-off headers still map.
  return raw.map((r, i) => {
    const lower: Record<string, unknown> = {};
    Object.keys(r).forEach(k => { lower[k.trim().toLowerCase()] = r[k]; });
    const get = (header: string) => lower[header.toLowerCase()];

    const priorityRaw = norm(get('Priority')).toLowerCase();
    const priority = (PRIORITIES.find(p => p.value === priorityRaw)?.value ?? 'medium') as LeadPriority;

    const data: LeadInsert = {
      lead_name: norm(get('Lead Name')),
      mobile: norm(get('Mobile')).replace(/\D/g, '').slice(0, 10),
      alternate_number: norm(get('Alternate Number')).replace(/\D/g, '').slice(0, 10),
      email: norm(get('Email')).toLowerCase(),
      pan: norm(get('PAN')).toUpperCase().replace(/[^A-Z0-9]/g, ''),
      address: norm(get('Address')),
      city: norm(get('City')),
      state: norm(get('State')),
      occupation: norm(get('Occupation')),
      company_name: norm(get('Company Name')),
      age: (() => { const n = numOrNull(get('Age')); return n == null ? null : Math.round(n); })(),
      annual_income: numOrNull(get('Annual Income')),
      investment_capacity: numOrNull(get('Investment Capacity')),
      interested_product: norm(get('Interested Product')),
      lead_source: norm(get('Lead Source')),
      campaign: norm(get('Campaign')),
      priority,
      remarks: norm(get('Remarks')),
    };

    const errors: string[] = [];
    if (!data.lead_name) errors.push('Lead Name is required');
    if (!data.mobile) errors.push('Mobile is required');
    else if (!isValidMobile(data.mobile)) errors.push('Invalid mobile');
    if (data.email && !isValidEmail(data.email)) errors.push('Invalid email');
    if (data.pan && !isValidPan(data.pan)) errors.push('Invalid PAN');

    return { rowNumber: i + 2, data, errors, duplicate: null }; // +2: header row + 1-index
  });
}

// Generate a downloadable .xlsx template with headers + one example row.
export async function downloadTemplate() {
  const XLSX = await import('xlsx');
  const headers = IMPORT_COLUMNS.map(c => c.header);
  const example = [
    'Ramesh Kumar', '9876543210', '9812345678', 'ramesh@example.com', 'ABCDE1234F',
    '12 MG Road', 'Mumbai', 'Maharashtra', 'Business Owner', 'Kumar Traders',
    '42', '2500000', '1000000', 'Mutual Funds', 'Referral', 'Diwali Drive', 'high',
    'Interested in tax-saving options',
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  XLSX.writeFile(wb, 'niyom_leads_template.xlsx');
}

// Split N ids into `count` round-robin buckets (bucket i gets ids i, i+count, …).
export function roundRobinBuckets<T>(items: T[], count: number): T[][] {
  const buckets: T[][] = Array.from({ length: count }, () => []);
  items.forEach((it, i) => buckets[i % count].push(it));
  return buckets;
}

// Export leads to a CSV string (client-side; used by the List export button).
const EXPORT_COLS: { header: string; get: (l: NWLead) => string }[] = [
  { header: 'Lead Code', get: l => l.lead_code },
  { header: 'Lead Name', get: l => l.lead_name },
  { header: 'Mobile', get: l => l.mobile },
  { header: 'Alternate Number', get: l => l.alternate_number },
  { header: 'Email', get: l => l.email },
  { header: 'PAN', get: l => l.pan },
  { header: 'City', get: l => l.city },
  { header: 'State', get: l => l.state },
  { header: 'Occupation', get: l => l.occupation },
  { header: 'Company', get: l => l.company_name },
  { header: 'Annual Income', get: l => l.annual_income?.toString() ?? '' },
  { header: 'Investment Capacity', get: l => l.investment_capacity?.toString() ?? '' },
  { header: 'Product', get: l => l.interested_product },
  { header: 'Source', get: l => l.lead_source },
  { header: 'Campaign', get: l => l.campaign },
  { header: 'Priority', get: l => l.priority },
  { header: 'Status', get: l => l.status },
  { header: 'Score', get: l => l.lead_score.toString() },
  { header: 'Owner', get: l => l.owner?.full_name ?? '' },
  { header: 'Origin', get: l => l.lead_origin },
  { header: 'Dataset', get: l => (l.lead_category === 'client' ? 'Client' : 'Partner') },
  { header: 'Created', get: l => l.created_at },
];

const csvCell = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;

export function leadsToCsv(leads: NWLead[]): string {
  const head = EXPORT_COLS.map(c => csvCell(c.header)).join(',');
  const body = leads.map(l => EXPORT_COLS.map(c => csvCell(c.get(l))).join(',')).join('\n');
  return `${head}\n${body}`;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
