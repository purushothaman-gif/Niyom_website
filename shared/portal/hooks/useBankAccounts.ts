/**
 * useBankAccounts
 * -----------------------------------------------------------------------------
 * Loads the client's registered bank accounts for the Profile → Bank tab.
 */
import { useEffect, useState } from 'react';
import { ProfileService } from '../services/ProfileService';
import type { NWClientBankAccount } from '../../crm/types';

export function useBankAccounts(clientId: string) {
  const [accounts, setAccounts] = useState<NWClientBankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    ProfileService.getBankAccounts(clientId)
      .then((data) => {
        if (alive) {
          setAccounts(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (alive) {
          setError(err instanceof Error ? err.message : 'Failed to load bank accounts.');
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [clientId]);

  return { accounts, loading, error };
}
