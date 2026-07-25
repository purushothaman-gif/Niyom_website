// Lead Management — enumerations, option lists, and status badge colors.
// Colors are plain RGB strings so badges can be tinted (bg = 12% alpha,
// text/border = full) and render consistently in both light and dark themes.

import { LeadStatus, LeadPriority, LeadOrigin, CommType, FollowupMode } from './leadTypes';

export interface StatusMeta { label: LeadStatus; rgb: string; group: StatusGroup; }
export type StatusGroup = 'open' | 'active' | 'progress' | 'won' | 'lost' | 'idle';

// Ordered pipeline — also the column order for the Kanban board (Phase 2).
export const LEAD_STATUSES: StatusMeta[] = [
  { label: 'New',                      rgb: '99,102,241',  group: 'open' },      // indigo
  { label: 'Assigned',                 rgb: '59,130,246',  group: 'open' },      // blue
  { label: 'Attempted',                rgb: '14,165,233',  group: 'active' },    // sky
  { label: 'Connected',                rgb: '6,182,212',   group: 'active' },    // cyan
  { label: 'Interested',               rgb: '16,185,129',  group: 'progress' },  // emerald
  { label: 'Meeting Scheduled',        rgb: '20,184,166',  group: 'progress' },  // teal
  { label: 'Follow-up',                rgb: '234,179,8',   group: 'active' },     // amber
  { label: 'Documentation Pending',    rgb: '245,158,11',  group: 'progress' },  // amber-600
  { label: 'KYC Pending',              rgb: '249,115,22',  group: 'progress' },  // orange
  { label: 'Investment Under Process', rgb: '132,204,22',  group: 'progress' },  // lime
  { label: 'Waiting for Client',       rgb: '168,85,247',  group: 'idle' },      // purple
  { label: 'No Response',              rgb: '148,163,184', group: 'idle' },      // slate
  { label: 'Call Back Later',          rgb: '113,113,122', group: 'idle' },      // zinc
  { label: 'Wrong Number',             rgb: '120,113,108', group: 'lost' },      // stone
  { label: 'Not Interested',           rgb: '239,68,68',   group: 'lost' },      // red
  { label: 'Lost',                     rgb: '220,38,38',   group: 'lost' },      // red-600
  { label: 'Closed - Converted',       rgb: '5,150,105',   group: 'won' },       // emerald-600
  { label: 'Closed - Rejected',        rgb: '113,63,63',   group: 'lost' },      // muted maroon
];

export const STATUS_META: Record<LeadStatus, StatusMeta> =
  Object.fromEntries(LEAD_STATUSES.map(s => [s.label, s])) as Record<LeadStatus, StatusMeta>;

export const statusRgb = (status: string): string =>
  STATUS_META[status as LeadStatus]?.rgb ?? '148,163,184';

// Terminal statuses can't move forward in the pipeline.
export const TERMINAL_STATUSES: LeadStatus[] = [
  'Wrong Number', 'Not Interested', 'Lost', 'Closed - Converted', 'Closed - Rejected',
];

export const PRIORITIES: { value: LeadPriority; label: string; rgb: string }[] = [
  { value: 'urgent', label: 'Urgent', rgb: '239,68,68' },
  { value: 'high',   label: 'High',   rgb: '249,115,22' },
  { value: 'medium', label: 'Medium', rgb: '234,179,8' },
  { value: 'low',    label: 'Low',    rgb: '148,163,184' },
];

export const priorityRgb = (p: string): string =>
  PRIORITIES.find(x => x.value === p)?.rgb ?? '148,163,184';

export const LEAD_ORIGIN_LABEL: Record<LeadOrigin, string> = {
  admin_upload:    'Admin Upload',
  admin_manual:    'Admin Manual Entry',
  employee_manual: 'Employee Manual Entry',
  website_signup:  'Website Sign-up',
};

// Communication / call outcomes (manual entry — no telephony).
export const CALL_OUTCOMES = [
  'Connected', 'Busy', 'No Answer', 'Switched Off', 'Wrong Number', 'Interested',
  'Not Interested', 'Call Back Later', 'Need Information', 'Meeting Fixed',
  'Follow-up Required', 'Converted', 'Lost',
] as const;

export const COMM_TYPES: { value: CommType; label: string }[] = [
  { value: 'call',     label: 'Call' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email',    label: 'Email' },
];

export const FOLLOWUP_MODES: { value: FollowupMode; label: string }[] = [
  { value: 'phone',        label: 'Phone' },
  { value: 'whatsapp',     label: 'WhatsApp' },
  { value: 'office_visit', label: 'Office Visit' },
  { value: 'zoom',         label: 'Zoom' },
  { value: 'google_meet',  label: 'Google Meet' },
];

// Suggested pick-lists (free text still allowed where relevant).
export const INTERESTED_PRODUCTS = [
  'Mutual Funds', 'Unlisted Shares', 'Primary Bonds', 'Secondary Bonds',
  'Fixed Deposits', 'Insurance', 'PMS', 'AIF', 'Portfolio Advisory', 'Other',
];

export const LEAD_SOURCES = [
  'Website', 'Referral', 'Walk-in', 'Cold Call', 'Social Media', 'Campaign',
  'Event / Seminar', 'Existing Client', 'Partner / DSA', 'Advertisement', 'Other',
];

export const PAGE_SIZE = 15;
