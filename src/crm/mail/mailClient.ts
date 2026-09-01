// Email Campaigns — React Query hooks over Supabase.
//
// Same shape as bondClient.ts / shareClient.ts: a module-scoped QueryClient, a
// key factory, and every data access in one file.
//
// Two rules specific to this module:
//
//   1. Reads go through RLS (admin-only policies); every WRITE that matters
//      goes through a SECURITY DEFINER RPC. Approving, sending and unsubscribing
//      all re-check admin server-side, so the disabled buttons in the UI are a
//      courtesy rather than the control.
//
//   2. content_hash is recomputed from the draft on every save. It is what the
//      approve gate compares against test_sent_hash, so it must be written by
//      the same code that renders the preview — never assembled by hand.

import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { campaignContentHash, parseBlocks } from '../../../shared/mail/renderEmail';
import type {
  AudiencePreview, CampaignFilters, GeneratedDraft, MailAsset, MailAudience,
  MailBlock, MailCampaign, SendResult,
} from './mailTypes';

export const mailQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 } },
});

export const mailKeys = {
  all: ['mail_campaigns'] as const,
  list: () => ['mail_campaigns', 'list'] as const,
  one: (id: string) => ['mail_campaigns', 'one', id] as const,
  audience: (audience: MailAudience, filters: CampaignFilters) =>
    ['mail_campaigns', 'audience', audience, JSON.stringify(filters)] as const,
  assets: () => ['mail_assets'] as const,
  recipients: (id: string) => ['mail_campaign_recipients', id] as const,
};

const COLUMNS =
  'id, campaign_no, audience, subject, preheader, blocks, filters, cta_portal_enabled, ' +
  'cta_portal_label, status, content_hash, test_sent_at, test_sent_hash, compliance_flags, ' +
  'recipient_count, sent_count, failed_count, approved_by, approved_at, send_started_at, ' +
  'send_completed_at, created_by, created_at, updated_at';

/** Narrow the jsonb columns once, here, so no component has to deal with Json. */
function hydrate(row: Record<string, unknown>): MailCampaign {
  return {
    ...row,
    blocks: parseBlocks(row.blocks),
    filters: (row.filters ?? {}) as CampaignFilters,
    compliance_flags: Array.isArray(row.compliance_flags)
      ? (row.compliance_flags as MailCampaign['compliance_flags'])
      : [],
  } as MailCampaign;
}

export function useCampaigns() {
  return useQuery({
    queryKey: mailKeys.list(),
    queryFn: async (): Promise<MailCampaign[]> => {
      const { data, error } = await supabase
        .from('mail_campaigns').select(COLUMNS)
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return ((data ?? []) as unknown as Record<string, unknown>[]).map(hydrate);
    },
  });
}

export function useCampaign(id: string | null) {
  return useQuery({
    queryKey: mailKeys.one(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<MailCampaign | null> => {
      const { data, error } = await supabase
        .from('mail_campaigns').select(COLUMNS).eq('id', id!).maybeSingle();
      if (error) throw error;
      return data ? hydrate(data as unknown as Record<string, unknown>) : null;
    },
  });
}

/** Live recipient counts, for the progress bar during and after a send. */
export function useRecipientStats(id: string | null, live: boolean) {
  return useQuery({
    queryKey: mailKeys.recipients(id ?? ''),
    enabled: !!id,
    refetchInterval: live ? 3_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mail_campaign_recipients').select('status').eq('campaign_id', id!).limit(20_000);
      if (error) throw error;
      const rows = (data ?? []) as { status: string }[];
      const by = (s: string) => rows.filter((r) => r.status === s).length;
      return { total: rows.length, sent: by('sent'), failed: by('failed'), queued: by('queued') + by('sending') };
    },
  });
}

/** How many people this campaign would reach, without sending anything. */
export function useAudiencePreview(audience: MailAudience, filters: CampaignFilters) {
  return useQuery({
    queryKey: mailKeys.audience(audience, filters),
    queryFn: async (): Promise<AudiencePreview> => {
      const { data, error } = await supabase.rpc('mail_preview_audience', {
        p_audience: audience,
        p_filters: filters as never,
      });
      if (error) throw error;
      return (data ?? { total: 0, suppressed: 0, sendable: 0 }) as unknown as AudiencePreview;
    },
  });
}

export interface CampaignDraft {
  audience: MailAudience;
  subject: string;
  preheader: string;
  blocks: MailBlock[];
  filters: CampaignFilters;
  cta_portal_enabled: boolean;
  cta_portal_label: string;
  compliance_flags?: MailCampaign['compliance_flags'];
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (audience: MailAudience): Promise<string> => {
      const { data, error } = await supabase
        .from('mail_campaigns')
        .insert({ audience, created_by: await currentEmployeeId() } as never)
        .select('id').single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      await supabase.rpc('mail_log_event', { p_campaign_id: id, p_event_type: 'created' });
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: mailKeys.all }),
  });
}

export function useSaveCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: CampaignDraft }) => {
      // Recomputed on every save so the approve gate is comparing like with
      // like. Rendering and hashing come from the same shared module the send
      // path uses, so a hash match really does mean identical mail.
      const content_hash = await campaignContentHash({
        subject: draft.subject,
        preheader: draft.preheader,
        blocks: draft.blocks,
        audience: draft.audience,
        ctaPortalEnabled: draft.cta_portal_enabled,
        ctaPortalLabel: draft.cta_portal_label,
      });

      const { error } = await supabase.from('mail_campaigns').update({
        audience: draft.audience,
        subject: draft.subject,
        preheader: draft.preheader,
        blocks: draft.blocks as never,
        filters: draft.filters as never,
        cta_portal_enabled: draft.cta_portal_enabled,
        cta_portal_label: draft.cta_portal_label,
        compliance_flags: (draft.compliance_flags ?? []) as never,
        content_hash,
      } as never).eq('id', id);
      if (error) throw error;
      return content_hash;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: mailKeys.one(v.id) });
      qc.invalidateQueries({ queryKey: mailKeys.list() });
    },
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Only ever offered for a draft; a sent campaign is a record of what
      // reached clients and the UI never exposes a delete for one.
      const { error } = await supabase.from('mail_campaigns').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: mailKeys.all }),
  });
}

export function useSetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; action: 'approve' | 'cancel'; note?: string; ackCompliance?: boolean }) => {
      const { error } = await supabase.rpc('mail_set_campaign_status', {
        p_campaign_id: v.id,
        p_action: v.action,
        p_note: v.note ?? '',
        p_ack_compliance: v.ackCompliance ?? false,
      });
      if (error) throw error;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: mailKeys.one(v.id) });
      qc.invalidateQueries({ queryKey: mailKeys.list() });
    },
  });
}

export function useTestSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke('mail-campaign-send', {
        body: { campaignId: id, mode: 'test' },
      });
      if (error) throw new Error(await readFunctionError(error, 'The test email could not be sent.'));
      const res = data as { error?: string; sentTo?: string };
      if (res?.error) throw new Error(res.error);
      return res.sentTo ?? '';
    },
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: mailKeys.one(id) });
      qc.invalidateQueries({ queryKey: mailKeys.list() });
    },
  });
}

/**
 * One pass of a live send.
 *
 * The function drains for ~110s and returns what is left, so the caller loops
 * until `remaining` is zero. That is what makes a blast resumable: each pass is
 * a complete, committed unit of work rather than one long request that loses
 * everything if the connection drops.
 */
export function useSendPass() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<SendResult> => {
      const { data, error } = await supabase.functions.invoke('mail-campaign-send', {
        body: { campaignId: id, mode: 'live' },
      });
      if (error) throw new Error(await readFunctionError(error, 'The campaign could not be sent.'));
      const res = data as SendResult & { error?: string };
      if (res?.error) throw new Error(res.error);
      return res;
    },
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: mailKeys.one(id) });
      qc.invalidateQueries({ queryKey: mailKeys.recipients(id) });
      qc.invalidateQueries({ queryKey: mailKeys.list() });
    },
  });
}

export function useGenerate() {
  return useMutation({
    mutationFn: async (brief: {
      audience: MailAudience; keywords: string; purpose: string; tone: string; length: string;
    }): Promise<GeneratedDraft> => {
      const { data, error } = await supabase.functions.invoke('mail-campaign-generate', { body: brief });
      if (error) throw new Error(await readFunctionError(error, 'The draft could not be generated.'));
      const res = data as GeneratedDraft & { error?: string };
      if (res?.error) throw new Error(res.error);
      return { ...res, blocks: parseBlocks(res.blocks) };
    },
  });
}

// --------------------------------------------------------------------------
// Image library
// --------------------------------------------------------------------------

export function useAssets() {
  return useQuery({
    queryKey: mailKeys.assets(),
    queryFn: async (): Promise<MailAsset[]> => {
      const { data, error } = await supabase
        .from('mail_assets').select('id, storage_path, public_url, file_name, byte_size, created_at')
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as MailAsset[];
    },
  });
}

export function useUploadAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<MailAsset> => {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      // Content-addressed by time + a random suffix rather than by name: two
      // campaigns uploading "banner.png" must not overwrite each other, because
      // the first campaign's mail is already in inboxes pointing at that URL.
      const path = `campaigns/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('campaign-images').upload(path, file, { upsert: false, contentType: file.type || 'image/png' });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('campaign-images').getPublicUrl(path);
      const { data, error } = await supabase.from('mail_assets').insert({
        storage_path: path,
        public_url: pub.publicUrl,
        file_name: file.name,
        byte_size: file.size,
        uploaded_by: await currentEmployeeId(),
      } as never).select('id, storage_path, public_url, file_name, byte_size, created_at').single();
      if (error) throw error;
      return data as unknown as MailAsset;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: mailKeys.assets() }),
  });
}

// --------------------------------------------------------------------------

async function currentEmployeeId(): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from('nw_employees').select('id').eq('auth_user_id', auth.user.id).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Pull the real message out of a FunctionsHttpError.
 *
 * supabase-js reports every non-2xx from an edge function as a generic
 * "Edge Function returned a non-2xx status code", which hides the actual
 * reason — and here the reason is usually something the admin needs to act on
 * ("send yourself a test first", "Resend rejected the key").
 */
async function readFunctionError(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json();
      const msg = (body as { error?: string })?.error;
      if (msg) return msg;
    } catch { /* fall through to the message below */ }
  }
  const msg = (error as { message?: string })?.message;
  return msg && !msg.includes('non-2xx') ? msg : fallback;
}
