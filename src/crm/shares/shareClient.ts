// Unlisted Shares master — React Query hooks over Supabase.
//
// Staff read us_shares directly (RLS already restricts it to active employees);
// only admins may write, and the daily price goes through us_set_price so
// `entered_by` is derived from the session rather than sent by the browser.

import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export const shareQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

export interface UnlistedShare {
  id: string;
  isin: string;
  company_name: string;
  short_name: string;
  sector: string;
  about: string;
  logo_url: string;
  website: string;
  face_value: number | null;
  lot_size: number;
  min_qty: number;
  latest_price: number | null;
  price_date: string | null;
  price_updated_at: string | null;
  active_status: 'active' | 'suspended' | 'inactive';
  display_order: number;
  updated_at: string;
}

export interface SharePriceRow {
  id: string;
  share_id: string;
  price_date: string;
  price: number;
  note: string;
  created_at: string;
  entered_by: string | null;
  employee?: { full_name: string | null } | null;
}

const COLUMNS =
  'id, isin, company_name, short_name, sector, about, logo_url, website, face_value, ' +
  'lot_size, min_qty, latest_price, price_date, price_updated_at, active_status, display_order, updated_at';

export function useShares(search: string) {
  return useQuery({
    queryKey: ['us_shares', 'list', search],
    queryFn: async (): Promise<UnlistedShare[]> => {
      let q = supabase.from('us_shares').select(COLUMNS).order('display_order').order('company_name').limit(1000);
      const s = search.trim();
      if (s) q = q.or(`isin.ilike.%${s}%,company_name.ilike.%${s}%,short_name.ilike.%${s}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as UnlistedShare[]) ?? [];
    },
  });
}

/** The last 60 dated prices for one share — the admin's audit of their own entries. */
export function useSharePrices(shareId: string | null) {
  return useQuery({
    queryKey: ['us_share_prices', shareId],
    enabled: !!shareId,
    queryFn: async (): Promise<SharePriceRow[]> => {
      const { data, error } = await supabase
        .from('us_share_prices')
        .select('id, share_id, price_date, price, note, created_at, entered_by, employee:nw_employees(full_name)')
        .eq('share_id', shareId!)
        .order('price_date', { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data as unknown as SharePriceRow[]) ?? [];
    },
  });
}

export interface SetPriceArgs { shareId: string; price: number; date: string; note?: string }

export function useSetPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: SetPriceArgs) => {
      const { error } = await supabase.rpc('us_set_price', {
        p_share_id: p.shareId, p_price: p.price, p_date: p.date, p_note: p.note ?? '',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['us_shares'] });
      qc.invalidateQueries({ queryKey: ['us_share_prices'] });
    },
  });
}

export type ShareDraft = Partial<Omit<UnlistedShare, 'id' | 'latest_price' | 'price_date' | 'price_updated_at' | 'updated_at'>>;

export function useSaveShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id?: string; draft: ShareDraft }) => {
      if (v.id) {
        const { error } = await supabase.from('us_shares').update(v.draft).eq('id', v.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('us_shares').insert(v.draft as never);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['us_shares'] }),
  });
}

/**
 * Upload a company logo. Named by share id with a fixed extension so a re-upload
 * overwrites rather than orphaning the old object, and cache-busted on the URL so
 * the new logo appears immediately instead of after the CDN's TTL.
 */
export async function uploadShareLogo(shareId: string, file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  const path = `logos/${shareId}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('share-logos')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/png' });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from('share-logos').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
