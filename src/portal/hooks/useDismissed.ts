import { useCallback, useState } from 'react';

const PREFIX = 'niyom-portal-dismissed:';

/**
 * Remember that the client has dismissed a notice.
 *
 * Keyed by the caller so a notice about a NEW fact reappears: the CAS staleness
 * warning keys on the statement date, so dismissing it silences that statement
 * and no other — import a newer one and the notice is free to speak again.
 *
 * localStorage rather than a table because it is a UI preference, not a record.
 * Reads are guarded: Safari's private mode throws on access, and a notice that
 * cannot be dismissed is better than a portfolio that will not render.
 */
export function useDismissed(key: string | null): [boolean, () => void] {
  const storageKey = key ? `${PREFIX}${key}` : null;

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (!storageKey) return false;
    try {
      return window.localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });

  const dismiss = useCallback(() => {
    setDismissed(true);
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, '1');
    } catch {
      /* the dismissal still holds for this session */
    }
  }, [storageKey]);

  return [dismissed, dismiss];
}
