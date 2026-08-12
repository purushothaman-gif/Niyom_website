/**
 * Who is signed in, on which surface.
 * -----------------------------------------------------------------------------
 * The website keeps this in sessionStorage, so closing the tab signs you out.
 * An app should not work that way — nobody expects to re-authenticate every
 * time they switch away from an app — so the surface and the account id live in
 * SecureStore beside the Supabase session they belong to.
 *
 * ## Why a "surface" and not just a user
 *
 * A client session and a partner session can BOTH exist on one handset (a DSA
 * who is also a client keeps two separate logins by design). Supabase knows
 * nothing about that distinction; it just sees two stored sessions under two
 * keys. `surface` is the app's record of which one the person is currently
 * using, and it decides which navigator is mounted and which Supabase client
 * every service is handed.
 *
 * ## Idle timeout
 *
 * Five minutes of no interaction signs the active surface out, matching the
 * website. On a phone "no interaction" has to include being backgrounded: a
 * handset left on a table with the app open is the same exposure as a browser
 * tab, and a phone lent to someone is a more common one. Time spent in the
 * background counts, so returning after ten minutes lands on the keypad.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { endDemoSession, isDemoSession } from '@shared/partner/demo/demoData';
import { clientSupabase, partnerSupabase } from '@/platform/supabase';

export type Surface = 'client' | 'partner';

export interface Session {
  surface: Surface;
  /** `client_id` for a client, `dsa_id` for a partner. */
  id: string;
  /** False means they are still on the temporary password their RM issued. */
  passwordChanged: boolean;
}

interface AuthValue {
  session: Session | null;
  /** True until the stored session has been checked — hold navigation on it. */
  restoring: boolean;
  signIn: (session: Session) => Promise<void>;
  /** Marks the forced password change as done, without a re-login. */
  markPasswordChanged: () => Promise<void>;
  signOut: (reason?: 'user' | 'idle' | 'revoked') => Promise<void>;
  /** Why the last sign-out happened, so the login screen can explain itself. */
  lastSignOutReason: 'user' | 'idle' | 'revoked' | null;
  /** Any touch resets the idle clock. Wired to the root View. */
  noteActivity: () => void;
}

const STORE_KEY = 'nw_active_session';
const IDLE_MS = 5 * 60 * 1000;

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [lastSignOutReason, setLastSignOutReason] = useState<AuthValue['lastSignOutReason']>(null);

  const lastActivity = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Read inside the interval and the AppState handler, which are set up once.
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  const signOut = useCallback(async (reason: 'user' | 'idle' | 'revoked' = 'user') => {
    const surface = sessionRef.current?.surface;
    setSession(null);
    setLastSignOutReason(reason);
    await SecureStore.deleteItemAsync(STORE_KEY).catch(() => {});
    /*
     * Sign out only the surface being left. A client who also has a partner
     * login should not be thrown out of both because they closed one.
     */
    if (surface === 'partner') {
      if (isDemoSession()) endDemoSession();
      await partnerSupabase.auth.signOut().catch(() => {});
    } else if (surface === 'client') {
      await clientSupabase.auth.signOut().catch(() => {});
    }
  }, []);

  /* ------------------------------ restore -------------------------------- */

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(STORE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as Session;
        if (saved?.surface !== 'client' && saved?.surface !== 'partner') return;

        /*
         * The app's record is not enough. Supabase may have expired or refused
         * to refresh the session while the app was closed, and restoring on the
         * app's word alone would mount the portal and then have every query
         * fail. The stored session is only honoured if a real one backs it.
         */
        const db = saved.surface === 'partner' ? partnerSupabase : clientSupabase;
        const { data } = await db.auth.getSession();
        if (!data.session) {
          await SecureStore.deleteItemAsync(STORE_KEY).catch(() => {});
          return;
        }
        if (alive) {
          setSession(saved);
          lastActivity.current = Date.now();
        }
      } catch {
        /* an unreadable record just means signing in again */
      } finally {
        if (alive) setRestoring(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ---------------------------- idle timeout ------------------------------ */

  const noteActivity = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    timer.current = setInterval(() => {
      if (!sessionRef.current) return;
      if (Date.now() - lastActivity.current >= IDLE_MS) void signOut('idle');
    }, 15_000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [signOut]);

  useEffect(() => {
    /*
     * Coming back from the background is the case the 15-second interval alone
     * would miss: iOS suspends timers, so an app reopened after an hour would
     * otherwise get up to 15 seconds of a live portfolio on screen before the
     * tick fired. Check on the transition itself.
     */
    const onChange = (status: AppStateStatus) => {
      if (status !== 'active') {
        lastActivity.current = Date.now();
        return;
      }
      if (sessionRef.current && Date.now() - lastActivity.current >= IDLE_MS) {
        void signOut('idle');
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [signOut]);

  /* -------------------------------- api ---------------------------------- */

  const signIn = useCallback(async (next: Session) => {
    setSession(next);
    setLastSignOutReason(null);
    lastActivity.current = Date.now();
    await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const markPasswordChanged = useCallback(async () => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, passwordChanged: true };
      void SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      restoring,
      signIn,
      markPasswordChanged,
      signOut,
      lastSignOutReason,
      noteActivity,
    }),
    [session, restoring, signIn, markPasswordChanged, signOut, lastSignOutReason, noteActivity],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}

/**
 * The signed-in client's id, for screens that cannot run without one.
 * Throws rather than returning null so a screen never quietly queries with an
 * empty id and shows an empty portfolio as if it were the truth.
 */
export function useClientId(): string {
  const { session } = useAuth();
  if (session?.surface !== 'client') {
    throw new Error('This screen requires a signed-in client.');
  }
  return session.id;
}

export function useDsaId(): string {
  const { session } = useAuth();
  if (session?.surface !== 'partner') {
    throw new Error('This screen requires a signed-in partner.');
  }
  return session.id;
}
