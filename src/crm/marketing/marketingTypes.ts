// Marketing Tool — Content Creation types.
// Hand-rolled to match the mkt_* schema, following the bondTypes.ts convention.

import { ASPECT_VARIANTS } from './marketingConstants';

export type AspectVariant = keyof typeof ASPECT_VARIANTS;

export type ContentStatus = 'draft' | 'approved' | 'rejected' | 'archived';

export type ContentType =
  | 'poster' | 'carousel' | 'story' | 'facebook_post' | 'linkedin_post'
  | 'infographic' | 'animated_poster' | 'motion_graphic' | 'short_video';

export type DownloadEventType =
  | 'download_poster' | 'download_video' | 'copy_caption' | 'copy_hashtags' | 'share_link';

/** One slide of a carousel / infographic. */
export interface ContentSlide {
  heading: string;
  body: string;
}

/** One scene of a generated video script. */
export interface VideoScene {
  scene: string;
  text: string;
  duration_seconds: number;
}

/** Per-platform posting guidance returned by the generator. */
export interface PlatformNotes {
  instagram?: string | null;
  facebook?: string | null;
  linkedin?: string | null;
}

/** The AI-generated draft, before it is saved as mkt_content. */
export interface MktDraft {
  title: string;
  headline: string;
  body: string;
  /** Contains the literal {{REF_LINK}} placeholder exactly once. */
  caption: string;
  hashtags: string[];
  cta: string;
  seo_keywords: string[];
  suggested_post_time: string;
  platform_optimisation: PlatformNotes;
  slides: ContentSlide[] | null;
  video_script: VideoScene[] | null;
}

export interface MktGenerationLint {
  passed: boolean;
  flagged: { field: string; phrase: string; label: string }[];
}

export interface MktGenerateResponse {
  success: boolean;
  draft: MktDraft;
  lint: MktGenerationLint;
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
}

export interface MktGenerateRequest {
  category: string;
  topic?: string;
  content_type: ContentType;
  platforms: string[];
  tone?: string;
  extra_instructions?: string;
  regenerate_of_content_no?: string;
  slide_count?: number;
  video_duration_seconds?: number;
}

/** A row of mkt_content. */
export interface MktContent {
  id: string;
  content_no: string;
  content_type: ContentType;
  platforms: string[];
  category: string;
  topic: string;
  title: string;
  headline: string;
  body: string;
  caption: string;
  hashtags: string[];
  cta: string;
  seo_keywords: string[];
  suggested_post_time: string;
  platform_notes: PlatformNotes;
  template_id: string;
  design_spec: Record<string, unknown>;
  generation_meta: Record<string, unknown>;
  status: ContentStatus;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  scheduled_publish_at: string | null;
  expires_at: string | null;
  reject_reason: string;
  created_at: string;
  updated_at: string;
}

/** A row of mkt_content_assets. */
export interface MktAsset {
  id: string;
  content_id: string;
  variant: string;
  kind: 'image' | 'video';
  storage_path: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  file_size: number | null;
  mime_type: string;
  created_at: string;
}

export interface MktContentWithAssets extends MktContent {
  assets: MktAsset[];
}

/** A row of mkt_content_history — the slim survivor of a hard delete. */
export interface MktContentHistory {
  content_no: string;
  category: string;
  topic: string;
  content_type: string;
  platforms: string[];
  title: string;
  headline: string;
  hashtags: string[];
  final_status: string;
  download_count: number;
  created_by: string | null;
  created_at: string | null;
  approved_at: string | null;
  deleted_at: string;
  delete_reason: 'expired' | 'admin_deleted';
}

export interface MktReferralLink {
  id: string;
  /** Null on the company link — NIYOM's own posts belong to the house. */
  employee_id: string | null;
  kind: 'employee' | 'company';
  /** Display name, set for the company link. */
  label: string | null;
  ref_code: string;
  active: boolean;
  created_at: string;
}

/** Company-channel totals, kept out of the employee leaderboard. */
export interface MktCompanyChannelStats {
  ref_code: string;
  label: string | null;
  active: boolean;
  clicks: number;
  leads: number;
  clients: number;
}

/** Library search + filter state. */
export interface ContentFilters {
  search: string;
  status: ContentStatus | 'all';
  contentType: ContentType | 'all';
  platform: string | 'all';
  category: string | 'all';
  fromDate: string;
  toDate: string;
}

export const EMPTY_FILTERS: ContentFilters = {
  search: '',
  status: 'all',
  contentType: 'all',
  platform: 'all',
  category: 'all',
  fromDate: '',
  toDate: '',
};

// --- analytics RPC shapes --------------------------------------------------

export interface MktDashboardTotals {
  generated_total: number;
  approved_total: number;
  rejected_total: number;
  expired_total: number;
  admin_deleted_total: number;
  downloads_total: number;
  caption_copies: number;
  hashtag_copies: number;
  referral_clicks: number;
  leads_generated: number;
  clients_onboarded: number;
  live_now: number;
}

export interface MktLeaderboardRow {
  employee_id: string;
  employee_code: string;
  full_name: string;
  avatar_url: string | null;
  downloads: number;
  copies: number;
  clicks: number;
  leads: number;
  clients: number;
}

export interface MktContentPerformanceRow {
  content_no: string;
  title: string;
  content_type: string;
  platforms: string[];
  status: string;
  downloads: number;
  copies: number;
  clicks: number;
  leads: number;
  clients: number;
}

export interface MktPlatformUsageRow {
  platform: string;
  content_count: number;
  downloads: number;
}
