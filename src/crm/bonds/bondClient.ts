// Bond Master data access — React Query hooks over Supabase.
// Staff read the client-safe bm_bonds_public projection; the importer calls the
// bm_import_prices RPC (create-or-price-update by ISIN).

import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { BondPublic, ImportRow, ImportSummary } from './bondTypes';

export const bondQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

export const bondKeys = {
  list: (search: string) => ['bm_bonds', 'list', search] as const,
  detail: (id: string) => ['bm_bonds', 'detail', id] as const,
};

const LIST_COLUMNS =
  'id, isin, bond_name, issuer_name, coupon_rate, coupon_frequency, maturity_date, rating, ' +
  'rating_agency, latest_price, selling_price, price_updated_at, active_status, ' +
  'verification_status, data_quality_score, updated_at';

export function useBonds(search: string) {
  return useQuery({
    queryKey: bondKeys.list(search),
    queryFn: async (): Promise<BondPublic[]> => {
      let q = supabase.from('bm_bonds_public').select(LIST_COLUMNS)
        .eq('active_status', 'active')      // only bonds in the latest uploaded list
        .order('updated_at', { ascending: false }).limit(5000);
      const s = search.trim();
      if (s) q = q.or(`isin.ilike.%${s}%,bond_name.ilike.%${s}%,issuer_name.ilike.%${s}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as BondPublic[]) ?? [];
    },
  });
}

export function useImportPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: ImportRow[]): Promise<ImportSummary> => {
      const { data, error } = await supabase.rpc('bm_import_prices', { p_rows: rows });
      if (error) throw error;
      return data as ImportSummary;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bm_bonds'] }); },
  });
}

export interface VerifQueueItem {
  id: string; bond_id: string; missing_fields: string[]; reason: string; confidence: number; created_at: string;
  bond: { isin: string; bond_name: string; data_quality_score: number } | null;
}

// Admin-only: bonds needing manual verification (missing required fields).
export function useVerificationQueue() {
  return useQuery({
    queryKey: ['bm_verif_queue'],
    queryFn: async (): Promise<VerifQueueItem[]> => {
      const { data, error } = await supabase.from('bm_verification_queue')
        .select('id,bond_id,missing_fields,reason,confidence,created_at,bond:bm_bonds(isin,bond_name,data_quality_score)')
        .eq('status', 'open').order('created_at', { ascending: false });
      if (error) throw error;
      return (data as unknown as VerifQueueItem[]) ?? [];
    },
  });
}

export interface EnrichResult { isin: string; status: string; quality?: number; ytm?: number | null; error?: string }
export interface EnrichResponse { enriched: number; results: EnrichResult[] }

// One enrichment batch (edge function loops internally, bounded by `limit`).
export async function enrichBatch(params: { bond_ids?: string[]; isin?: string; limit?: number; recompute?: boolean }): Promise<EnrichResponse> {
  const { data, error } = await supabase.functions.invoke('bond-enrich', { body: params });
  if (error) throw error;
  return data as EnrichResponse;
}

// Recompute analytics (yields, cashflows, accrued) from the stored master + current
// price for every ACTIVE bond — no provider calls, so it's fast and rate-limit-free.
// Used after the fixed engine deploy and after each daily price upload so yields track
// the latest price. Chunked by explicit ids to scale past one invocation's row cap.
export async function recomputeAllActive(onProgress?: (done: number, total: number) => void, chunk = 40): Promise<number> {
  const { data, error } = await supabase.from('bm_bonds_public').select('id').eq('active_status', 'active').limit(5000);
  if (error) throw error;
  const ids = ((data as { id: string }[]) ?? []).map(r => r.id);
  let done = 0;
  for (let i = 0; i < ids.length; i += chunk) {
    const res = await enrichBatch({ recompute: true, bond_ids: ids.slice(i, i + chunk) });
    done += res.enriched;
    onProgress?.(done, ids.length);
  }
  return done;
}

// Drive enrichment of all pending bonds in safe batches (keeps each invocation
// well under the edge-function timeout). Calls onProgress after each batch.
export async function enrichPendingLoop(onProgress?: (done: number) => void, batch = 12, maxBatches = 200): Promise<number> {
  let done = 0;
  for (let i = 0; i < maxBatches; i++) {
    const res = await enrichBatch({ limit: batch });
    done += res.enriched;
    onProgress?.(done);
    if (res.enriched === 0) break;
  }
  return done;
}

// Admin: manually set + lock master fields, then recompute analytics.
export function useSetFields() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isin, fields, lock }: { id: string; isin: string; fields: Record<string, string>; lock: boolean }) => {
      const { error } = await supabase.rpc('bm_set_fields', { p_bond_id: id, p_fields: fields, p_lock: lock });
      if (error) throw error;
      await enrichBatch({ isin });   // recompute analytics/schedules from the now-present values
    },
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: bondKeys.detail(v.id) }); qc.invalidateQueries({ queryKey: ['bm_bonds'] }); qc.invalidateQueries({ queryKey: ['bm_verif_queue'] }); },
  });
}

// Admin: set the markup% → selling price on the master.
export function useSaveMargin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, marginValue, sellingPrice }: { id: string; marginValue: number; sellingPrice: number }) => {
      const { error } = await supabase.from('bm_bonds')
        .update({ default_margin_type: 'percent', default_margin_value: marginValue, selling_price: sellingPrice }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: bondKeys.detail(v.id) }); qc.invalidateQueries({ queryKey: ['bm_bonds'] }); },
  });
}

// Single-bond enrich (on-demand when opening a Pending bond).
export function useEnrichOne() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (isin: string) => enrichBatch({ isin }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bm_bonds'] }); },
  });
}
