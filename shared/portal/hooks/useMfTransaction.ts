/**
 * useMfTransaction
 * -----------------------------------------------------------------------------
 * Lifecycle for non-purchase MF transactions (redeem / switch). Shares one
 * placing/result/error state so the Redeem and Switch flows stay declarative.
 */
import { useCallback, useState } from 'react';
import { BSEService } from '../services/BSEService';
import type { RedemptionRequest, SwitchRequest, TxnResult } from '../types/funds';

export function useMfTransaction() {
  const [placing, setPlacing] = useState(false);
  const [result, setResult] = useState<TxnResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (op: () => Promise<TxnResult>): Promise<TxnResult | null> => {
    setPlacing(true);
    setError(null);
    try {
      const res = await op();
      setResult(res);
      return res;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request could not be completed. Please try again.');
      return null;
    } finally {
      setPlacing(false);
    }
  }, []);

  const redeem = useCallback((req: RedemptionRequest) => run(() => BSEService.placeRedemption(req)), [run]);
  const switchFund = useCallback((req: SwitchRequest) => run(() => BSEService.placeSwitch(req)), [run]);

  return { placing, result, error, redeem, switchFund };
}
