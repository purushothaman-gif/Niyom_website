/**
 * Which palette is live, and who gets to decide.
 * -----------------------------------------------------------------------------
 * Three states, matching the website's toggle plus the thing a phone adds:
 * `system` follows the OS appearance, `light` and `dark` override it. System is
 * the default because a phone user has already told their device how they want
 * to be shown things, and asking again on first launch is a question with a
 * known answer.
 *
 * The choice persists in AsyncStorage rather than SecureStore — it is a display
 * preference, not a credential, and it should survive a sign-out so the app
 * does not flash back to a theme the user rejected.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { palettes, shadow, type Palette, type ThemeName } from './tokens';

export type ThemePreference = 'system' | ThemeName;

interface ThemeContextValue {
  /** The resolved palette to draw with. */
  theme: Palette;
  /** 'light' | 'dark' — what is actually on screen right now. */
  name: ThemeName;
  /** What the user chose, which may be 'system'. */
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
  /** Elevation for the ACTIVE theme, so call sites never pass the name. */
  shadow: (level: 'sm' | 'md' | 'lg' | 'card') => ReturnType<typeof shadow>;
}

const STORAGE_KEY = 'nw_theme_preference';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!alive) return;
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          setPreferenceState(saved);
        }
      })
      .catch(() => {
        /* an unreadable preference just means the OS decides */
      });
    return () => {
      alive = false;
    };
  }, []);

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  };

  const value = useMemo<ThemeContextValue>(() => {
    // Dark is the fallback, not light: the brand is a navy one, and an unknown
    // OS scheme should land on the app's own identity.
    const name: ThemeName = preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;
    return {
      theme: palettes[name],
      name,
      preference,
      setPreference,
      shadow: (level) => shadow(level, name),
    };
  }, [preference, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return ctx;
}

/** Shorthand for the common case of only wanting the palette. */
export function usePalette(): Palette {
  return useTheme().theme;
}
