import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Sign a client out after a stretch of inactivity.
 *
 * This is the other half of PIN sign-in. A PIN makes getting back in cheap, and
 * that is only a good trade if the session does not sit open on an unattended
 * screen — which, on a shared laptop, is how a portfolio gets read by whoever
 * walks past next. Five minutes is the usual figure for a financial account.
 *
 * "Activity" is any sign of a person: pointer, keyboard, scroll, touch, or the
 * tab being brought back to the front. A background tab that nobody looks at
 * is idle, which is exactly the case worth timing out.
 *
 * The countdown is driven off a timestamp rather than a decrementing timer, so
 * a laptop that slept through the window is idle on wake instead of resuming
 * mid-count.
 */
interface Options {
  /** Idle minutes before sign-out. */
  minutes?: number;
  /** How long the warning shows before the sign-out lands. */
  warnSeconds?: number;
  onTimeout: () => void;
  /** Set false to suspend (e.g. while a modal owns the screen). */
  enabled?: boolean;
}

const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'scroll',
  'touchstart',
  'wheel',
] as const;

export function useIdleTimeout({
  minutes = 5,
  warnSeconds = 30,
  onTimeout,
  enabled = true,
}: Options) {
  const idleMs = minutes * 60 * 1000;
  const warnMs = warnSeconds * 1000;

  const lastActive = useRef(Date.now());
  const firedRef = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const markActive = useCallback(() => {
    lastActive.current = Date.now();
    firedRef.current = false;
    setSecondsLeft(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setSecondsLeft(null);
      return;
    }

    /* Throttled: mousemove fires hundreds of times a second and all we need is
       "someone is here", which a 1s resolution answers. */
    let lastWrite = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite < 1000) return;
      lastWrite = now;
      lastActive.current = now;
      firedRef.current = false;
      setSecondsLeft(null); // dismisses the warning if it was showing
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') onActivity();
    };

    ACTIVITY_EVENTS.forEach((e) =>
      window.addEventListener(e, onActivity, { passive: true }),
    );
    document.addEventListener('visibilitychange', onVisible);

    const tick = window.setInterval(() => {
      const idleFor = Date.now() - lastActive.current;
      if (idleFor >= idleMs) {
        if (!firedRef.current) {
          firedRef.current = true;
          setSecondsLeft(null);
          onTimeoutRef.current();
        }
        return;
      }
      const untilTimeout = idleMs - idleFor;
      setSecondsLeft(untilTimeout <= warnMs ? Math.ceil(untilTimeout / 1000) : null);
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(tick);
    };
  }, [enabled, idleMs, warnMs]);

  return { secondsLeft, stayActive: markActive };
}
