/**
 * usePlaceOrder
 * -----------------------------------------------------------------------------
 * Manages the async lifecycle of a BSE order placement. UI stays declarative:
 * call submit(req), read { placing, result, error }.
 */
import { useCallback, useState } from 'react';
import { BSEService } from '../services/BSEService';
import type { OrderRequest, OrderResult } from '../types/funds';

export function usePlaceOrder() {
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<OrderResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (req: OrderRequest): Promise<OrderResult | null> => {
    setPlacing(true);
    setError(null);
    try {
      const res = await BSEService.placeOrder(req);
      setResult(res);
      return res;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order could not be placed. Please try again.');
      return null;
    } finally {
      setPlacing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { submit, reset, placing, result, error };
}
