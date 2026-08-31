// Client/partner markup pricing — React Query hooks over the price-markup RPCs.
// RM proposes; admin approves. RLS scopes rows (admin = all, RM = own).
//
// Two products use this: bonds (bm_price_markup) and unlisted shares
// (us_price_markup). The tables and RPCs are deliberately separate — the spread
// on unlisted equity has nothing to do with the spread on a bond, and one shared
// row would silently reprice both the moment either changed — but the WORKFLOW
// is identical, so it is parameterised here rather than copied. The bond version
// of this file was copied once already, for the partner margin maths, and the
// two copies had drifted by the time anyone looked.

import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

export const pricingQueryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 } },
});

/** Which product's markups a hook is reading or writing. */
export type Product = 'bond' | 'share';

interface ProductBinding {
  table: 'bm_price_markup' | 'us_price_markup';
  propose: 'bm_propose_markup' | 'us_propose_markup';
  approve: 'bm_approve_markup' | 'us_approve_markup';
  reject: 'bm_reject_markup' | 'us_reject_markup';
}

const BINDINGS: Record<Product, ProductBinding> = {
  bond: {
    table: 'bm_price_markup',
    propose: 'bm_propose_markup',
    approve: 'bm_approve_markup',
    reject: 'bm_reject_markup',
  },
  share: {
    table: 'us_price_markup',
    propose: 'us_propose_markup',
    approve: 'us_approve_markup',
    reject: 'us_reject_markup',
  },
};

export type Audience = 'client' | 'partner';
export type Scope = 'group' | 'individual';
export type MarkupStatus = 'pending' | 'approved' | 'rejected' | 'superseded';

export interface MarkupRow {
  id: string;
  audience: Audience;
  scope: Scope;
  client_id: string | null;
  dsa_id: string | null;
  employee_id: string | null;
  markup_percent: number;
  status: MarkupStatus;
  proposed_by: string | null;
  approved_by: string | null;
  rejection_reason: string;
  created_at: string;
  client?: { full_name: string; client_code: string } | null;
  dsa?: { full_name: string; dsa_code: string } | null;
}

export interface NamedRow { id: string; full_name: string; code: string }

/** Active (pending|approved) markups visible to the current staff. */
export function useMarkups(product: Product) {
  const bind = BINDINGS[product];
  return useQuery({
    queryKey: [bind.table],
    queryFn: async (): Promise<MarkupRow[]> => {
      const { data, error } = await supabase
        .from(bind.table)
        .select('*, client:nw_clients(full_name,client_code), dsa:nw_dsa(full_name,dsa_code)')
        .in('status', ['pending', 'approved'])
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as unknown as MarkupRow[]) ?? [];
    },
  });
}

export function useMyClients() {
  return useQuery({
    queryKey: ['pricing_clients'],
    queryFn: async (): Promise<NamedRow[]> => {
      const { data, error } = await supabase.from('nw_clients').select('id, full_name, client_code').order('full_name').limit(3000);
      if (error) throw error;
      return ((data as { id: string; full_name: string | null; client_code: string | null }[]) ?? []).map(c => ({ id: c.id, full_name: c.full_name ?? '', code: c.client_code ?? '' }));
    },
  });
}

export function useMyPartners() {
  return useQuery({
    queryKey: ['pricing_partners'],
    queryFn: async (): Promise<NamedRow[]> => {
      const { data, error } = await supabase.from('nw_dsa').select('id, full_name, dsa_code').eq('status', 'active').order('full_name').limit(3000);
      if (error) throw error;
      return ((data as { id: string; full_name: string | null; dsa_code: string | null }[]) ?? []).map(d => ({ id: d.id, full_name: d.full_name ?? '', code: d.dsa_code ?? '' }));
    },
  });
}

export interface ProposeArgs { audience: Audience; scope: Scope; client_id?: string | null; dsa_id?: string | null; markup: number; company_wide?: boolean }

export function usePropose(product: Product) {
  const qc = useQueryClient();
  const bind = BINDINGS[product];
  return useMutation({
    mutationFn: async (p: ProposeArgs) => {
      const { error } = await supabase.rpc(bind.propose, {
        p_audience: p.audience, p_scope: p.scope,
        // uuid args are typed non-null by the generator but accept SQL NULL at runtime.
        p_client_id: (p.client_id ?? null) as unknown as string,
        p_dsa_id: (p.dsa_id ?? null) as unknown as string,
        p_markup: p.markup, p_company_wide: p.company_wide ?? false,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [bind.table] }),
  });
}

export function useApprove(product: Product) {
  const qc = useQueryClient();
  const bind = BINDINGS[product];
  return useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc(bind.approve, { p_id: id }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: [bind.table] }),
  });
}

export function useReject(product: Product) {
  const qc = useQueryClient();
  const bind = BINDINGS[product];
  return useMutation({
    mutationFn: async (v: { id: string; reason: string }) => { const { error } = await supabase.rpc(bind.reject, { p_id: v.id, p_reason: v.reason }); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: [bind.table] }),
  });
}
