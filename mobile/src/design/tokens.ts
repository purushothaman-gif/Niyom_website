/**
 * Niyom's design tokens, as TypeScript.
 * -----------------------------------------------------------------------------
 * A faithful port of `src/theme/tokens.css`, which is the website's single
 * source of colour. Same navy elevation ladder, same Niyom gold, same semantic
 * and category ramps, same two themes — so the app and niyomwealth.com are
 * recognisably one product rather than two designs that happen to share a logo.
 *
 * The website resolves these through CSS custom properties and a `data-theme`
 * attribute. React Native has neither, so they are plain objects and the active
 * one is chosen by `ThemeProvider`. Values are literal hex/rgba strings for the
 * same reason the CSS file forbids hex literals at call sites: one place to
 * change a brand colour.
 *
 * The one deliberate addition is `--accent` used as an ON-DARK gold everywhere
 * the app paints a navy panel in LIGHT mode (the sign-in hero, the portfolio
 * header). The website solves this with a `--brand-panel-bg` gradient; here it
 * is `onBrand`, a small fixed set that never follows the theme.
 */

export type ThemeName = 'light' | 'dark';

/** A gradient always has at least two stops — the shape LinearGradient wants. */
export type GradientStops = readonly [string, string, ...string[]];

/**
 * The shape both palettes fill in.
 *
 * Written out rather than inferred from one of them: inference would pin every
 * field to the DARK hex literal, and the light palette would then fail to
 * typecheck against its own colours.
 */
export interface Palette {
  name: ThemeName;
  /** Drives the status bar and keyboard appearance. */
  scheme: 'light' | 'dark';
  bg: {
    base: string;
    elevated: string;
    surface: string;
    raised: string;
    overlay: string;
    disabled: string;
    hover: string;
    selected: string;
    veil: string;
  };
  border: { subtle: string; DEFAULT: string; strong: string; stronger: string };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    faint: string;
    bright: string;
    placeholder: string;
    onAccent: string;
    disabled: string;
  };
  accent: {
    DEFAULT: string;
    soft: string;
    softDeep: string;
    strong: string;
    strongDeep: string;
    gradient: GradientStops;
    /** The accent at an arbitrary alpha, for tinted fills and rings. */
    tint: (alpha: number) => string;
  };
  state: {
    success: string;
    successSoft: string;
    danger: string;
    dangerSoft: string;
    warning: string;
    warningSoft: string;
    info: string;
    infoSoft: string;
  };
  /** Category ramp for donuts, legends and badges. */
  category: readonly string[];
  focusRing: string;
  onBrand: OnBrand;
}

export interface OnBrand {
  gradient: GradientStops;
  gold: string;
  goldSoft: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  veil: string;
}

/** Colours that are the same in both themes — always drawn on deep navy. */
const onBrand: OnBrand = {
  /** The navy hero/panel gradient stops, from `--brand-panel-bg`. */
  gradient: ['#071524', '#081B33', '#10284D'],
  gold: '#c8a45d',
  goldSoft: '#d8bd86',
  text: '#f4f7fc',
  textSecondary: '#9fb0c9',
  textMuted: '#7688a4',
  border: 'rgba(200, 164, 93, 0.22)',
  veil: 'rgba(255, 255, 255, 0.06)',
};

const dark: Palette = {
  name: 'dark',
  scheme: 'dark',

  bg: {
    base: '#071524',
    elevated: '#081B33',
    surface: '#10284D',
    raised: '#16345C',
    overlay: 'rgba(3, 10, 22, 0.72)',
    disabled: '#0e2440',
    hover: 'rgba(255, 255, 255, 0.04)',
    selected: 'rgba(200, 164, 93, 0.12)',
    veil: 'rgba(255, 255, 255, 0.05)',
  },

  border: {
    subtle: '#12294a',
    DEFAULT: '#1b3559',
    strong: '#274672',
    stronger: '#35578a',
  },

  text: {
    primary: '#f4f7fc',
    secondary: '#9fb0c9',
    muted: '#7688a4',
    faint: '#566a86',
    bright: '#c7d3e5',
    placeholder: '#566a86',
    onAccent: '#071524',
    disabled: '#4a5a72',
  },

  accent: {
    DEFAULT: '#c8a45d',
    soft: '#d8bd86',
    softDeep: '#b8934a',
    strong: '#b8934a',
    strongDeep: '#9a7938',
    /** rgba stops for gold gradients on buttons and hero numbers. */
    gradient: ['#d8bd86', '#c8a45d', '#b8934a'],
    tint: (a: number) => `rgba(200, 164, 93, ${a})`,
  },

  state: {
    success: '#16a34a',
    successSoft: '#4ade80',
    danger: '#dc2626',
    dangerSoft: '#f87171',
    warning: '#f59e0b',
    warningSoft: '#fbbf24',
    info: '#3b82f6',
    infoSoft: '#60a5fa',
  },

  /** Category ramp for donuts, legends and badges (Tailwind `-400` on dark). */
  category: [
    '#34d399', // emerald
    '#60a5fa', // blue
    '#fbbf24', // amber
    '#f472b6', // pink
    '#22d3ee', // cyan
    '#a78bfa', // violet
    '#fb923c', // orange
    '#f87171', // red
  ],

  focusRing: 'rgba(200, 164, 93, 0.5)',
  onBrand,
};

const light: Palette = {
  name: 'light',
  scheme: 'light',

  bg: {
    base: '#f6f8fc',
    elevated: '#ffffff',
    surface: '#ffffff',
    raised: '#eef2f9',
    overlay: 'rgba(8, 27, 51, 0.45)',
    disabled: '#eef2f9',
    hover: 'rgba(8, 27, 51, 0.04)',
    selected: 'rgba(184, 147, 74, 0.12)',
    veil: 'rgba(8, 27, 51, 0.04)',
  },

  border: {
    subtle: '#eef2f9',
    DEFAULT: '#dde4ee',
    strong: '#cbd5e3',
    stronger: '#b4c1d4',
  },

  text: {
    primary: '#1b2430',
    secondary: '#475467',
    muted: '#667085',
    faint: '#94a0b3',
    bright: '#0f1a2b',
    placeholder: '#94a0b3',
    onAccent: '#ffffff',
    disabled: '#aab4c4',
  },

  accent: {
    DEFAULT: '#b8934a',
    soft: '#a67f3c',
    softDeep: '#8a6a30',
    strong: '#9a7938',
    strongDeep: '#8a6a30',
    gradient: ['#c8a45d', '#b8934a', '#9a7938'],
    tint: (a: number) => `rgba(184, 147, 74, ${a})`,
  },

  state: {
    success: '#16a34a',
    successSoft: '#16a34a',
    danger: '#dc2626',
    dangerSoft: '#dc2626',
    // amber-600: #F59E0B text is sub-AA on white.
    warning: '#d97706',
    warningSoft: '#b45309',
    info: '#2563eb',
    infoSoft: '#2563eb',
  },

  category: [
    '#059669',
    '#2563eb',
    '#b45309',
    '#be185d',
    '#0e7490',
    '#6d28d9',
    '#c2410c',
    '#dc2626',
  ],

  focusRing: 'rgba(184, 147, 74, 0.5)',
  onBrand,
};

export const palettes: Record<ThemeName, Palette> = { light, dark };

/* -------------------------------------------------------------------------- */
/*  Scales — identical in both themes, mirroring the CSS primitives block      */
/* -------------------------------------------------------------------------- */

/** A 4pt grid. Spacing is only ever taken from here. */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 32,
  8: 40,
  9: 48,
  10: 64,
} as const;

/** The website's four-step radius scale, plus `full` for pills and avatars. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

/**
 * Type ramp. `display` is Space Grotesk — headings, screen titles and every
 * money figure, which is what gives the app its voice. `body` is Inter.
 *
 * Money is set in `tabular` so digits do not shift width as a value animates;
 * a portfolio total that jitters while it counts up looks broken.
 */
export const font = {
  display: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
} as const;

export const type = {
  hero: { fontFamily: font.displayBold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 },
  h1: { fontFamily: font.displayBold, fontSize: 26, lineHeight: 32, letterSpacing: -0.5 },
  h2: { fontFamily: font.display, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  h3: { fontFamily: font.display, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  body: { fontFamily: font.body, fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: font.bodyMedium, fontSize: 15, lineHeight: 22 },
  small: { fontFamily: font.body, fontSize: 13, lineHeight: 18 },
  smallMedium: { fontFamily: font.bodyMedium, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: font.bodyMedium, fontSize: 11, lineHeight: 15 },
  /** Section captions and table headers — always uppercased at the call site. */
  overline: {
    fontFamily: font.bodySemi,
    fontSize: 10.5,
    lineHeight: 14,
    letterSpacing: 1.1,
  },
  /** Money. Never used for prose. */
  money: { fontFamily: font.displayBold, fontSize: 30, lineHeight: 36, letterSpacing: -0.8 },
  moneyLarge: { fontFamily: font.displayBold, fontSize: 40, lineHeight: 46, letterSpacing: -1.2 },
  moneySmall: { fontFamily: font.display, fontSize: 16, lineHeight: 21, letterSpacing: -0.2 },
} as const;

/**
 * Motion. `out` is the decelerate curve the website uses for entrances; every
 * transition in the app should feel like it is settling rather than arriving.
 */
export const motion = {
  fast: 150,
  base: 250,
  slow: 400,
  /** cubic-bezier(0.16, 1, 0.3, 1) — as Reanimated easing arguments. */
  easeOut: [0.16, 1, 0.3, 1],
  easeInOut: [0.65, 0, 0.35, 1],
} as const;

export type ShadowLevel = 'sm' | 'md' | 'lg' | 'card';

export interface ShadowStyle {
  boxShadow: string;
  elevation: number;
}

/**
 * Elevation.
 *
 * `boxShadow` rather than the `shadowOffset` / `shadowOpacity` / `shadowRadius`
 * trio: those are deprecated from React Native 0.76 and warn on every render in
 * 0.86. `elevation` is still given alongside it because Android's shadow comes
 * from the elevation API, and a card styled only for iOS is flat on Android.
 *
 * The two themes are not the same shadow at different strengths. Navy needs a
 * darker, more diffuse cast to register at all, where porcelain needs a light
 * one or every card looks like it is peeling off the page.
 */
export function shadow(level: ShadowLevel, theme: ThemeName): ShadowStyle {
  const alpha = (
    theme === 'dark'
      ? { sm: 0.5, card: 0.4, md: 0.45, lg: 0.55 }
      : { sm: 0.06, card: 0.07, md: 0.08, lg: 0.12 }
  )[level];

  const spec = {
    sm: { y: 1, blur: 2, elevation: 1 },
    card: { y: 2, blur: 8, elevation: 2 },
    md: { y: 4, blur: 14, elevation: 5 },
    lg: { y: 12, blur: 32, elevation: 12 },
  }[level];

  const rgb = theme === 'dark' ? '2, 8, 20' : '16, 24, 40';

  return {
    boxShadow: `0px ${spec.y}px ${spec.blur}px rgba(${rgb}, ${alpha})`,
    elevation: spec.elevation,
  };
}
