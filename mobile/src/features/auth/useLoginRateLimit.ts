/**
 * Client-side attempt limiting on the sign-in screens.
 *
 * Five wrong tries locks the form for five minutes, matching
 * `src/pages/ClientLogin.tsx`. This is a courtesy, not a control: it lives in
 * the app, so anyone willing to reinstall is past it. The real limits are
 * server-side — `client-pin-login` counts PIN attempts and burns the PIN after
 * ten, and Supabase Auth rate-limits password attempts per account.
 *
 * What it is genuinely for is the honest case: someone misremembering which of
 * their passwords this is, hammering the button, and being told to slow down
 * before Supabase locks the account itself.
 *
 * Held in memory rather than on disk for the same reason the website uses
 * sessionStorage: it should not outlive the attempt to sign in.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 300;

interface State {
  attempts: number;
  lockedUntil: number;
}

/** Module-scope so it survives a screen unmounting, but not an app restart. */
const stores: Record<string, State> = {};

export function useLoginRateLimit(key: string) {
  const store = (stores[key] ??= { attempts: 0, lockedUntil: 0 });
  const [secondsLeft, setSecondsLeft] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    const remaining = Math.ceil((store.lockedUntil - Date.now()) / 1000);
    setSecondsLeft(remaining > 0 ? remaining : 0);
    if (remaining <= 0 && store.lockedUntil > 0) {
      store.attempts = 0;
      store.lockedUntil = 0;
    }
  }, [store]);

  useEffect(() => {
    refresh();
    tick.current = setInterval(refresh, 1000);
    return () => {
      if (tick.current) clearInterval(tick.current);
    };
  }, [refresh]);

  const recordFailure = useCallback((): { locked: boolean; remaining: number } => {
    const next = store.attempts + 1;
    store.attempts = next;
    if (next >= MAX_ATTEMPTS) {
      store.lockedUntil = Date.now() + LOCKOUT_SECONDS * 1000;
      refresh();
      return { locked: true, remaining: 0 };
    }
    return { locked: false, remaining: MAX_ATTEMPTS - next };
  }, [store, refresh]);

  const clear = useCallback(() => {
    store.attempts = 0;
    store.lockedUntil = 0;
    setSecondsLeft(0);
  }, [store]);

  /**
   * The message to show after a rejected attempt: the countdown once locked,
   * and a remaining-tries warning only in the last two — counting down from
   * five reads as a threat on the first honest typo.
   */
  const failureMessage = useCallback((): string => {
    const { locked, remaining } = recordFailure();
    if (locked) {
      return `Too many failed attempts. Try again in ${Math.ceil(LOCKOUT_SECONDS / 60)} minutes.`;
    }
    return remaining <= 2
      ? `Invalid PAN or password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
      : 'Invalid PAN or password.';
  }, [recordFailure]);

  return {
    locked: secondsLeft > 0,
    secondsLeft,
    lockMessage: secondsLeft > 0 ? `Too many failed attempts. Try again in ${secondsLeft}s.` : '',
    failureMessage,
    clear,
  };
}
