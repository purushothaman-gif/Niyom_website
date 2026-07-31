/**
 * The EUIN that will be stamped on transactions this user places.
 *
 * Display only — the proxy resolves the EUIN itself from the caller's session
 * and never trusts a value from the browser. This exists so staff can see the
 * attribution on the confirmation step before committing, not to supply it.
 *
 * Mirrors the proxy's rule: the signed-in employee's EUIN, falling back to the
 * default when they hold none.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

/** Keep in step with BSE_DEFAULT_EUIN on the proxy. */
export const DEFAULT_EUIN = 'E124361';

export function useCallerEuin(): string {
  const [euin, setEuin] = useState(DEFAULT_EUIN);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase
        .from('nw_employees')
        .select('euin')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();
      const own = (data as { euin?: string | null } | null)?.euin;
      if (alive && own) setEuin(own);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return euin;
}
