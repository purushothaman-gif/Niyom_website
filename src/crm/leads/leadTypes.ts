// Lead Management — shared types. Mirrors the nw_lead* schema
// (supabase/migrations/20260719120000_lead_management_phase1.sql).

export type LeadPriority = 'low' | 'medium' | 'high' | 'urgent';

export type LeadOrigin = 'admin_upload' | 'admin_manual' | 'employee_manual' | 'website_signup';

export type LeadScoreBand = 'Hot' | 'Warm' | 'Cold';

export type LeadStatus =
  | 'New'
  | 'Assigned'
  | 'Attempted'
  | 'Connected'
  | 'Interested'
  | 'Meeting Scheduled'
  | 'Follow-up'
  | 'WhatsApp Sent'
  | 'Email Sent'
  | 'Documentation Pending'
  | 'KYC Pending'
  | 'Investment Under Process'
  | 'Waiting for Client'
  | 'No Response'
  | 'Call Back Later'
  | 'Wrong Number'
  | 'Not Interested'
  | 'Lost'
  | 'Closed - Converted'
  | 'Closed - Rejected';

export type CommType = 'call' | 'whatsapp' | 'email';

export type FollowupMode = 'phone' | 'whatsapp' | 'office_visit' | 'zoom' | 'google_meet';

export type FollowupStatus = 'pending' | 'completed' | 'missed' | 'cancelled';

export interface NWLead {
  id: string;
  lead_code: string;

  lead_name: string;
  mobile: string;
  alternate_number: string;
  email: string;
  pan: string;
  address: string;
  city: string;
  state: string;
  occupation: string;
  company_name: string;
  age: number | null;
  annual_income: number | null;
  investment_capacity: number | null;
  interested_product: string;
  lead_source: string;
  campaign: string;
  priority: LeadPriority;
  remarks: string;

  status: LeadStatus;
  lead_origin: LeadOrigin;
  owner_employee_id: string | null;
  created_by_employee_id: string | null;
  is_locked: boolean;
  is_archived: boolean;
  converted_client_id: string | null;

  lead_score: number;
  score_band: LeadScoreBand;

  assigned_at: string | null;
  first_call_at: string | null;
  first_contact_at: string | null;
  last_activity_at: string | null;
  last_followup_at: string | null;
  converted_at: string | null;

  created_at: string;
  updated_at: string;

  // Embedded relations (optional; populated by select joins)
  owner?: { full_name: string; employee_code: string } | null;
  created_by?: { full_name: string; employee_code: string } | null;
}

export interface NWLeadNote {
  id: string;
  lead_id: string;
  employee_id: string | null;
  status_at_time: string;
  remarks: string;
  created_at: string;
  employee?: { full_name: string } | null;
}

export interface NWLeadActivity {
  id: string;
  lead_id: string;
  employee_id: string | null;
  action: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
  employee?: { full_name: string } | null;
}

export interface NWLeadFollowup {
  id: string;
  lead_id: string;
  employee_id: string | null;
  scheduled_at: string;
  priority: LeadPriority;
  purpose: string;
  mode: FollowupMode;
  reminder_minutes: number;
  status: FollowupStatus;
  completed_at: string | null;
  outcome: string;
  created_at: string;
}

export interface NWLeadCommunication {
  id: string;
  lead_id: string;
  employee_id: string | null;
  comm_type: CommType;
  outcome: string;
  remarks: string;
  duration_seconds: number | null;
  direction: 'outbound' | 'inbound';
  created_at: string;
}

export interface NWLeadDocument {
  id: string;
  lead_id: string;
  employee_id: string | null;
  doc_type: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  uploaded_by_name: string;
  created_at: string;
}

export interface NWLeadAssignment {
  id: string;
  lead_id: string;
  from_employee_id: string | null;
  to_employee_id: string | null;
  assigned_by_employee_id: string | null;
  reason: string;
  created_at: string;
}

export interface NWLeadAudit {
  id: string;
  lead_id: string;
  employee_id: string | null;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export interface NWLeadSavedView {
  id: string;
  employee_id: string;
  name: string;
  filters: Record<string, unknown>;
  is_shared: boolean;
  created_at: string;
}

// The subset of fields captured in the create/edit form.
export interface LeadFormData {
  lead_name: string;
  mobile: string;
  alternate_number: string;
  email: string;
  pan: string;
  address: string;
  city: string;
  state: string;
  occupation: string;
  company_name: string;
  age: string;
  annual_income: string;
  investment_capacity: string;
  interested_product: string;
  lead_source: string;
  campaign: string;
  priority: LeadPriority;
  remarks: string;
}

export interface LeadListFilters {
  search: string;
  status: LeadStatus | '';
  priority: LeadPriority | '';
  lead_origin: LeadOrigin | '';
  owner_employee_id: string | '';
  scope: 'all' | 'assigned' | 'self_generated' | 'pool';
  city: string;
  state: string;
  product: string;
  source: string;
  min_investment: string;
  max_investment: string;
  date_from: string;
  date_to: string;
  include_archived: boolean;
}
