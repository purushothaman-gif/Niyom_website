/**
 * Which products this PARTNER may see — admin default, overridden per partner.
 * Runs on the partner session (`partnerSupabase`), mirroring
 * `useHiddenProducts(partnerSupabase, 'partner')` on the website. Fails open;
 * the order triggers enforce it server-side regardless.
 */
import { partnerSupabase } from '@shared/lib/supabase';
import { useAuth } from '@/features/auth/AuthContext';
import { useProductAccessFor, type ProductAccess } from '@/features/productAccess';

export type { ProductAccess } from '@/features/productAccess';
export type { ProductKey } from '@shared/lib/productAccess';

export function useProductAccess(): ProductAccess {
  const { session } = useAuth();
  return useProductAccessFor(
    partnerSupabase,
    'partner',
    session?.surface === 'partner' ? session.id : null,
  );
}
