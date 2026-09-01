// Row shapes for the Email Campaigns module.
//
// Hand-written rather than derived from the generated Database types, matching
// bondTypes.ts / marketingTypes.ts: the generated types spell jsonb as `Json`,
// which every consumer would then have to narrow at each use. `blocks` is
// declared as MailBlock[] here and narrowed once, in mailClient, by parseBlocks.

import type { MailAudience, MailBlock } from '../../../shared/mail/renderEmail';

export type { MailAudience, MailBlock };

export type CampaignStatus = 'draft' | 'approved' | 'sending' | 'sent' | 'cancelled' | 'failed';

/** A compliance lint finding, as produced by _shared/mkt/compliance.ts. */
export interface ComplianceFlag {
  field: string;
  phrase: string;
  label: string;
}

export interface MailCampaign {
  id: string;
  campaign_no: string;
  audience: MailAudience;
  subject: string;
  preheader: string;
  blocks: MailBlock[];
  filters: CampaignFilters;
  cta_portal_enabled: boolean;
  cta_portal_label: string;
  status: CampaignStatus;
  content_hash: string;
  test_sent_at: string | null;
  test_sent_hash: string | null;
  compliance_flags: ComplianceFlag[];
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  approved_by: string | null;
  approved_at: string | null;
  send_started_at: string | null;
  send_completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Audience filters. Every key is optional and an absent key means "no filter" —
 * mail_audience_rows tests each with `p_filters->>'k' IS NULL OR ...`, so an
 * omitted key and a null key behave identically and the default is genuinely
 * everyone.
 */
export interface CampaignFilters {
  /** clients only: 'verified' | 'partial' | 'pending' | 'rejected' */
  verification_status?: string;
  /** partners only: defaults to 'active' when omitted */
  status?: string;
  /** both: restrict to one relationship manager's book */
  employee_id?: string;
  /** clients only */
  city?: string;
  /** both: has portal login enabled */
  login_enabled?: boolean;
}

export interface AudiencePreview {
  total: number;
  suppressed: number;
  sendable: number;
}

export interface MailAsset {
  id: string;
  storage_path: string;
  public_url: string;
  file_name: string;
  byte_size: number;
  created_at: string;
}

export interface SendResult {
  ok: true;
  mode: 'live';
  recipientCount: number;
  sentThisPass: number;
  failedThisPass: number;
  totalSent: number;
  totalFailed: number;
  remaining: number;
}

/** The generated draft returned by mail-campaign-generate. */
export interface GeneratedDraft {
  subject: string;
  preheader: string;
  blocks: MailBlock[];
  flags: ComplianceFlag[];
}

export const STATUS_HELP: Record<CampaignStatus, string> = {
  draft: 'Still being written. Send yourself a test to unlock approval.',
  approved: 'Reviewed and ready. Nothing has been sent yet.',
  sending: 'In progress. Safe to resume if it was interrupted.',
  sent: 'Delivered to every recipient on the list.',
  cancelled: 'Stopped before sending.',
  failed: 'Sending could not complete.',
};
