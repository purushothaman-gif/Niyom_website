import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';

export type Theme = 'light' | 'dark';
/** What the user picked. 'system' follows the OS setting live. */
export type ThemePreference = Theme | 'system';

const STORAGE_KEY = 'niyom-theme';

/** Mirrors --theme-color in tokens.css (browser address bar / PWA chrome). */
const THEME_COLOR: Record<Theme, string> = { dark: '#071524', light: '#f6f8fc' };

interface ThemeContextValue {
  /** Current resolved theme. */
  theme: Theme;
  /** The stored choice: light, dark or system. */
  preference: ThemePreference;
  /** True when the user has not made an explicit choice (following the OS). */
  isSystem: boolean;
  /** Set an explicit theme (persisted to localStorage). */
  setTheme: (theme: Theme) => void;
  /** Set light / dark / system. */
  setPreference: (pref: ThemePreference) => void;
  /** Toggle between light and dark (persists the result). */
  toggleTheme: () => void;
  /** Clear the saved preference and follow the OS again. */
  useSystemTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null; // private mode / blocked storage
  }
}

function writeStored(v: Theme | null) {
  try {
    if (v) localStorage.setItem(STORAGE_KEY, v);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — the choice still applies for this page view */
  }
}

function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  // Same precedence as the inline script in index.html: only an explicit
  // light preference yields light; no preference -> dark (production default).
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Resolve the initial theme using the same precedence as the anti-FOUC script
 * in index.html: saved preference -> OS preference -> dark (production default).
 */
function getInitialTheme(): { theme: Theme; isSystem: boolean } {
  if (typeof window === 'undefined') return { theme: 'dark', isSystem: false };
  const stored = readStored();
  if (stored) return { theme: stored, isSystem: false };
  return { theme: systemTheme(), isSystem: true };
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  // Keep a class in sync so Tailwind's `dark:` variant works too.
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  // Tint the mobile browser chrome to match the app shell.
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLOR[theme];
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Run a theme change as one clean cross-fade.
 *
 * Without this every element runs its own 250ms colour transition, so a dense
 * CRM table repaints thousands of nodes and visibly ripples. With the View
 * Transitions API the browser snapshots old/new and fades once; per-element
 * transitions are suppressed for the duration (`theme-switching`) so the "new"
 * snapshot is already in its final colours. Browsers without the API fall back
 * to the per-element transition in index.css.
 */
function withThemeTransition(update: () => void) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };
  if (!doc.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }
  const root = document.documentElement;
  root.classList.add('theme-switching');
  const vt = doc.startViewTransition(() => {
    flushSync(update);
  });
  vt.finished.finally(() => root.classList.remove('theme-switching'));
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [{ theme, isSystem }, setState] = useState(getInitialTheme);

  // Apply theme to <html> whenever it changes.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Follow OS changes while the user is on the "system" preference.
  useEffect(() => {
    if (!isSystem || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (e: MediaQueryListEvent) =>
      withThemeTransition(() =>
        setState({ theme: e.matches ? 'light' : 'dark', isSystem: true }),
      );
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [isSystem]);

  // Keep multiple tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === 'light' || e.newValue === 'dark') {
        setState({ theme: e.newValue, isSystem: false });
      } else {
        setState(getInitialTheme());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setPreference = useCallback((pref: ThemePreference) => {
    writeStored(pref === 'system' ? null : pref);
    const next =
      pref === 'system'
        ? { theme: systemTheme(), isSystem: true }
        : { theme: pref, isSystem: false };
    withThemeTransition(() => setState(next));
  }, []);

  const setTheme = useCallback((next: Theme) => setPreference(next), [setPreference]);

  const toggleTheme = useCallback(() => {
    setPreference(
      document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light',
    );
  }, [setPreference]);

  const useSystemTheme = useCallback(() => setPreference('system'), [setPreference]);

  const preference: ThemePreference = isSystem ? 'system' : theme;

  return (
    <ThemeContext.Provider
      value={{ theme, preference, isSystem, setTheme, setPreference, toggleTheme, useSystemTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
