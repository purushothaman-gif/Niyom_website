/**
 * useTransactions
 * -----------------------------------------------------------------------------
 * Loads the client's full transaction history and exposes normalized rows.
 * Shared by the Transactions page and Reports export.
 */
import { useCallback, useEffect, useState } from 'react';
import { TransactionService } from '../services/TransactionService';
import type { TransactionRow } from '../types/activity';

export function useTransactions(clientId: string) {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const txns = await TransactionService.getAll(clientId);
      setRows(TransactionService.toRows(txns));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions.');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { rows, loading, error, refresh: load };
}
