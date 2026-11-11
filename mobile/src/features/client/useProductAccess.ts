/**
 * Which products this CLIENT may see — admin default, overridden per client by
 * an admin or RM. Mirrors `useHiddenProducts(clientSupabase, 'client')` on the
 * website. Fails open; the order triggers enforce it server-side regardless.
 */
import { clientSupabase } from '@shared/lib/supabase';
import { useAuth } from '@/features/auth/AuthContext';
import { useProductAccessFor, type ProductAccess } from '@/features/productAccess';

export type { ProductAccess } from '@/features/productAccess';
export type { ProductKey } from '@shared/lib/productAccess';

export function useProductAccess(): ProductAccess {
  const { session } = useAuth();
  return useProductAccessFor(
    clientSupabase,
    'client',
    session?.surface === 'client' ? session.id : null,
  );
}
