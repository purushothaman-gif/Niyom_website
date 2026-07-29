// Marketing Tool — data access. React Query hooks over Supabase, following the
// bondClient.ts pattern (module-scoped QueryClient + a key factory).
//
// NOTE ON DELETION: there is deliberately no client-side delete of mkt_content,
// and no RLS DELETE policy backing one. Every deletion goes through the
// mkt-expire-content edge function so that storage objects are removed, the
// slim history row is written and the deletion is logged — none of which can be
// guaranteed from the browser. Please don't "simplify" this into a .delete().

import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import {
  ContentFilters, MktAsset, MktContent, MktContentHistory, MktContentPerformanceRow,
  MktDashboardTotals, MktGenerateRequest, MktGenerateResponse, MktLeaderboardRow,
  MktPlatformUsageRow, MktReferralLink, MktCompanyChannelStats, DownloadEventType,
} from './marketingTypes';

export const mktQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

export const mktKeys = {
  list: (f: ContentFilters) => ['mkt_content', 'list', f] as const,
  gallery: () => ['mkt_content', 'gallery'] as const,
  detail: (id: string) => ['mkt_content', 'detail', id] as const,
  assets: (id: string) => ['mkt_content', 'assets', id] as const,
  history: (search: string) => ['mkt_content', 'history', search] as const,
  myLink: (employeeId: string) => ['mkt_referral_link', 'me', employeeId] as const,
  companyLink: () => ['mkt_referral_link', 'company'] as const,
  companyStats: () => ['mkt_company_channel_stats'] as const,
  totals: () => ['mkt_analytics', 'totals'] as const,
  leaderboard: () => ['mkt_analytics', 'leaderboard'] as const,
  performance: () => ['mkt_analytics', 'performance'] as const,
  platformUsage: () => ['mkt_analytics', 'platforms'] as const,
};

const CONTENT_COLUMNS =
  'id, content_no, content_type, platforms, category, topic, title, headline, body, caption, ' +
  'hashtags, cta, seo_keywords, suggested_post_time, platform_notes, template_id, design_spec, ' +
  'generation_meta, status, created_by, approved_by, approved_at, scheduled_publish_at, ' +
  'expires_at, reject_reason, created_at, updated_at';

function invalidateContent(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['mkt_content'] });
  qc.invalidateQueries({ queryKey: ['mkt_analytics'] });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Admin library. Filters are applied server-side where indexed. */
export function useContentList(filters: ContentFilters) {
  return useQuery({
    queryKey: mktKeys.list(filters),
    queryFn: async (): Promise<MktContent[]> => {
      let q = supabase.from('mkt_content').select(CONTENT_COLUMNS)
        .order('created_at', { ascending: false }).limit(500);

      if (filters.status !== 'all') q = q.eq('status', filters.status);
      if (filters.contentType !== 'all') q = q.eq('content_type', filters.contentType);
      if (filters.category !== 'all') q = q.eq('category', filters.category);
      if (filters.platform !== 'all') q = q.contains('platforms', [filters.platform]);
      if (filters.fromDate) q = q.gte('created_at', filters.fromDate);
      // Inclusive end-of-day so a same-day from/to range returns that day.
      if (filters.toDate) q = q.lte('created_at', `${filters.toDate}T23:59:59.999Z`);

      const s = filters.search.trim();
      if (s) {
        const safe = s.replace(/[%,()]/g, ' ');
        q = q.or(
          `title.ilike.%${safe}%,headline.ilike.%${safe}%,topic.ilike.%${safe}%,` +
          `category.ilike.%${safe}%,content_no.ilike.%${safe}%,caption.ilike.%${safe}%`,
        );
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as MktContent[]) ?? [];
    },
  });
}

/**
 * Employee gallery. RLS already restricts this to approved, unexpired,
 * published content — the query does not need (and must not rely on) its own
 * status filter.
 */
export function useApprovedGallery() {
  return useQuery({
    queryKey: mktKeys.gallery(),
    queryFn: async (): Promise<MktContent[]> => {
      const { data, error } = await supabase.from('mkt_content').select(CONTENT_COLUMNS)
        .order('approved_at', { ascending: false }).limit(200);
      if (error) throw error;
      return (data as unknown as MktContent[]) ?? [];
    },
    // Content expires on a wall clock, so refresh periodically to drop items
    // that have aged out while the tab sat open.
    refetchInterval: 60_000,
  });
}

export function useContentAssets(contentId: string | undefined) {
  return useQuery({
    queryKey: mktKeys.assets(contentId ?? ''),
    enabled: !!contentId,
    queryFn: async (): Promise<MktAsset[]> => {
      const { data, error } = await supabase.from('mkt_content_assets')
        .select('*').eq('content_id', contentId!).order('variant');
      if (error) throw error;
      return (data as MktAsset[]) ?? [];
    },
  });
}

export function useContentHistory(search: string) {
  return useQuery({
    queryKey: mktKeys.history(search),
    queryFn: async (): Promise<MktContentHistory[]> => {
      let q = supabase.from('mkt_content_history').select('*')
        .order('deleted_at', { ascending: false }).limit(500);
      const s = search.trim();
      if (s) {
        const safe = s.replace(/[%,()]/g, ' ');
        q = q.or(`title.ilike.%${safe}%,topic.ilike.%${safe}%,category.ilike.%${safe}%,content_no.ilike.%${safe}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data as MktContentHistory[]) ?? [];
    },
  });
}

/**
 * The signed-in employee's own referral link.
 *
 * Filtered explicitly rather than leaning on RLS to return a single row: an
 * admin can read every link, so an unfiltered `.limit(1)` would hand them an
 * arbitrary person's code — or the company one.
 */
export function useMyReferralLink(employeeId: string) {
  return useQuery({
    queryKey: mktKeys.myLink(employeeId),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<MktReferralLink | null> => {
      const { data, error } = await supabase.from('mkt_referral_links')
        .select('*')
        .eq('kind', 'employee')
        .eq('employee_id', employeeId)
        .eq('active', true)
        .maybeSingle();
      if (error) throw error;
      return (data as MktReferralLink) ?? null;
    },
  });
}

/**
 * The single company link, for posts made from NIYOM's own accounts.
 *
 * Admin-only by RLS. Signups through it stay on the house account and are
 * reported as their own channel rather than counting toward any employee.
 */
export function useCompanyReferralLink() {
  return useQuery({
    queryKey: mktKeys.companyLink(),
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<MktReferralLink | null> => {
      const { data, error } = await supabase.from('mkt_referral_links')
        .select('*').eq('kind', 'company').maybeSingle();
      if (error) throw error;
      return (data as MktReferralLink) ?? null;
    },
  });
}

/** Company-channel performance, excluded from the employee leaderboard. */
export function useCompanyChannelStats() {
  return useQuery({
    queryKey: mktKeys.companyStats(),
    staleTime: 60_000,
    queryFn: async (): Promise<MktCompanyChannelStats | null> => {
      const { data, error } = await supabase.rpc('mkt_company_channel_stats');
      if (error) throw error;
      return ((data as MktCompanyChannelStats[]) ?? [])[0] ?? null;
    },
  });
}

/** Short-lived signed URL for a private asset. */
export async function signedUrlFor(storagePath: string, seconds = 120): Promise<string> {
  const { data, error } = await supabase.storage
    .from('marketing-content').createSignedUrl(storagePath, seconds);
  if (error) throw error;
  return data.signedUrl;
}

// ---------------------------------------------------------------------------
// Generation + authoring (admin)
// ---------------------------------------------------------------------------

export function useGenerateContent() {
  return useMutation({
    mutationFn: async (req: MktGenerateRequest): Promise<MktGenerateResponse> => {
      const { data, error } = await supabase.functions.invoke('mkt-generate-content', { body: req });
      if (error) {
        // Edge function errors carry the useful message in the response body.
        let detail = error.message;
        try {
          const ctx = (error as { context?: Response }).context;
          if (ctx && typeof ctx.json === 'function') {
            const parsed = await ctx.json();
            if (parsed?.error) detail = parsed.error;
          }
        } catch { /* keep the transport message */ }
        throw new Error(detail);
      }
      if (data?.error) throw new Error(data.error);
      return data as MktGenerateResponse;
    },
  });
}

export function useSaveDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: Partial<MktContent>): Promise<MktContent> => {
      const { data, error } = await supabase.from('mkt_content')
        .insert([draft]).select(CONTENT_COLUMNS).single();
      if (error) throw error;

      const row = data as unknown as MktContent;
      await supabase.from('mkt_approval_events').insert([{
        content_id: row.id, content_no: row.content_no,
        action: 'generated', actor_employee_id: draft.created_by ?? null,
      }]);
      return row;
    },
    onSuccess: () => invalidateContent(qc),
  });
}

export function useUpdateContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch, actorId }: { id: string; patch: Partial<MktContent>; actorId?: string }) => {
      const { data, error } = await supabase.from('mkt_content')
        .update(patch).eq('id', id).select(CONTENT_COLUMNS).single();
      if (error) throw error;

      const row = data as unknown as MktContent;
      await supabase.from('mkt_approval_events').insert([{
        content_id: row.id, content_no: row.content_no,
        action: 'edited', actor_employee_id: actorId ?? null,
      }]);
      return row;
    },
    onSuccess: () => invalidateContent(qc),
  });
}

/**
 * Approve / reject / archive. Routed through the RPC so expires_at is computed
 * on the server clock and the audit event is always written.
 */
export function useSetContentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action, note }: {
      id: string; action: 'approved' | 'rejected' | 'archived'; note?: string;
    }) => {
      const { data, error } = await supabase.rpc('mkt_set_content_status', {
        p_content_id: id, p_action: action, p_note: note ?? '',
      });
      if (error) throw error;
      return data as MktContent;
    },
    onSuccess: () => invalidateContent(qc),
  });
}

/** Hard delete — always via the edge function (storage + history + log). */
export function useDeleteContent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contentId, note }: { contentId: string; note?: string }) => {
      const { data, error } = await supabase.functions.invoke('mkt-expire-content', {
        body: { source: 'admin', content_id: contentId, note: note ?? '' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => invalidateContent(qc),
  });
}

/** Upload one rendered asset and register it. */
export function useUploadAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contentId, variant, blob, width, height, kind, durationSeconds }: {
      contentId: string; variant: string; blob: Blob;
      width: number; height: number; kind: 'image' | 'video'; durationSeconds?: number;
    }) => {
      const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('webm') ? 'webm' : 'png';
      const path = `content/${contentId}/${variant}.${ext}`;

      const { error: upErr } = await supabase.storage.from('marketing-content')
        .upload(path, blob, { upsert: true, contentType: blob.type || 'image/png' });
      if (upErr) throw upErr;

      const { error } = await supabase.from('mkt_content_assets').upsert([{
        content_id: contentId, variant, kind, storage_path: path,
        width, height, duration_seconds: durationSeconds ?? null,
        file_size: blob.size, mime_type: blob.type || 'image/png',
      }], { onConflict: 'content_id,variant' });
      if (error) throw error;

      return path;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: mktKeys.assets(vars.contentId) }),
  });
}

// ---------------------------------------------------------------------------
// Employee activity
// ---------------------------------------------------------------------------

/** Log a download/copy/share. Best-effort: never block the user's action. */
export function useRecordEvent() {
  return useMutation({
    mutationFn: async (evt: {
      contentId: string; contentNo: string; employeeId: string;
      eventType: DownloadEventType; variant?: string; platform?: string;
    }) => {
      const { error } = await supabase.from('mkt_downloads').insert([{
        content_id: evt.contentId, content_no: evt.contentNo,
        employee_id: evt.employeeId, event_type: evt.eventType,
        variant: evt.variant ?? '', platform: evt.platform ?? '',
      }]);
      if (error) throw error;
    },
  });
}

// ---------------------------------------------------------------------------
// Analytics (admin RPCs)
// ---------------------------------------------------------------------------

export function useDashboardTotals() {
  return useQuery({
    queryKey: mktKeys.totals(),
    queryFn: async (): Promise<MktDashboardTotals | null> => {
      const { data, error } = await supabase.rpc('mkt_dashboard_totals');
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as MktDashboardTotals ?? null;
    },
  });
}

export function useLeaderboard() {
  return useQuery({
    queryKey: mktKeys.leaderboard(),
    queryFn: async (): Promise<MktLeaderboardRow[]> => {
      const { data, error } = await supabase.rpc('mkt_employee_leaderboard');
      if (error) throw error;
      return (data as MktLeaderboardRow[]) ?? [];
    },
  });
}

export function useContentPerformance(limit = 20) {
  return useQuery({
    queryKey: [...mktKeys.performance(), limit],
    queryFn: async (): Promise<MktContentPerformanceRow[]> => {
      const { data, error } = await supabase.rpc('mkt_content_performance', { p_limit: limit });
      if (error) throw error;
      return (data as MktContentPerformanceRow[]) ?? [];
    },
  });
}

export function usePlatformUsage() {
  return useQuery({
    queryKey: mktKeys.platformUsage(),
    queryFn: async (): Promise<MktPlatformUsageRow[]> => {
      const { data, error } = await supabase.rpc('mkt_platform_usage');
      if (error) throw error;
      return (data as MktPlatformUsageRow[]) ?? [];
    },
  });
}
