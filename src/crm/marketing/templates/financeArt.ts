// Large-scale illustration compositions for generated artwork.
//
// Distinct from financeIcons.ts, which holds 24x24 line marks used as a small
// category cue. These are the opposite end of the scale: multi-element scenes
// meant to occupy a quarter to a third of a poster and carry it visually. A
// headline on an otherwise empty field reads as a placeholder, not a design —
// this is what fills that space.
//
// Every piece is drawn inside a normalised 100x100 box and positioned by
// `art()`, so a composition can be dropped into any layout at any size without
// touching its internals. Colour comes from the active palette rather than
// being baked in, so one piece serves every colourway.
//
// Pure shapes and gradients only — no external references, nothing that could
// taint the canvas or silently fail to load inside the rasterised SVG.

import { Palette } from './brandTokens';

export interface ArtContext {
  /** Unique per render, so gradient ids cannot collide between compositions. */
  uid: string;
  palette: Palette;
}

type ArtFn = (c: ArtContext) => string;

// --- helpers ---------------------------------------------------------------

/** Accent at a given opacity — the workhorse for depth without new hues. */
const acc = (p: Palette, o: number) => `${p.accent}${Math.round(o * 255).toString(16).padStart(2, '0')}`;

function linearFade(id: string, from: string, to: string, vertical = true): string {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">
    <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
  </linearGradient>`;
}

// --- compositions ----------------------------------------------------------

/** Area chart climbing to the right, with plotted points and a soft fill. */
const growthChart: ArtFn = ({ uid, palette: p }) => `
  <defs>${linearFade(`${uid}g`, acc(p, 0.42), acc(p, 0))}</defs>
  <path d="M6 78 L26 58 L44 66 L62 36 L82 46 L94 20 L94 88 L6 88 Z" fill="url(#${uid}g)"/>
  <path d="M6 78 L26 58 L44 66 L62 36 L82 46 L94 20" fill="none"
        stroke="${p.accent}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
  ${[[6, 78], [26, 58], [44, 66], [62, 36], [82, 46], [94, 20]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.6" fill="${p.bgFrom}" stroke="${p.accent}" stroke-width="2.6"/>`)
    .join('')}
  <path d="M6 88 H94" stroke="${acc(p, 0.35)}" stroke-width="1.6"/>`;

/** Three stacked coins seen at a slight angle. */
const coinStack: ArtFn = ({ uid, palette: p }) => `
  <defs>${linearFade(`${uid}c`, acc(p, 0.95), acc(p, 0.45), false)}</defs>
  ${[70, 50, 30].map((y, i) => `
    <ellipse cx="50" cy="${y + 10}" rx="${30 - i * 2}" ry="${9 - i * 0.4}" fill="${acc(p, 0.18)}"/>
    <rect x="${20 + i * 2}" y="${y}" width="${60 - i * 4}" height="11" rx="5.5" fill="url(#${uid}c)"/>
    <ellipse cx="50" cy="${y}" rx="${30 - i * 2}" ry="${9 - i * 0.4}" fill="${p.accent}"/>
    <ellipse cx="50" cy="${y}" rx="${20 - i * 1.5}" ry="${5.6 - i * 0.3}" fill="${acc(p, 0.35)}"/>`).join('')}
  <circle cx="78" cy="24" r="9" fill="none" stroke="${p.accent}" stroke-width="2.6"/>
  <path d="M78 19 v10 M75 22 h6" stroke="${p.accent}" stroke-width="2.2" stroke-linecap="round"/>`;

/** Donut breakdown — allocation, diversification, "where the money goes". */
const donutSplit: ArtFn = ({ uid, palette: p }) => {
  const seg = (from: number, to: number, w: number, o: number) => {
    const r = 34;
    const a1 = (from - 90) * Math.PI / 180, a2 = (to - 90) * Math.PI / 180;
    const x1 = 50 + r * Math.cos(a1), y1 = 50 + r * Math.sin(a1);
    const x2 = 50 + r * Math.cos(a2), y2 = 50 + r * Math.sin(a2);
    return `<path d="M${x1.toFixed(2)} ${y1.toFixed(2)} A34 34 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}"
      fill="none" stroke="${acc(p, o)}" stroke-width="${w}" stroke-linecap="round"/>`;
  };
  return `
    <circle cx="50" cy="50" r="34" fill="none" stroke="${acc(p, 0.14)}" stroke-width="15"/>
    ${seg(0, 128, 15, 1)}${seg(134, 226, 15, 0.62)}${seg(232, 316, 15, 0.34)}
    <circle cx="50" cy="50" r="18" fill="${acc(p, 0.1)}"/>
    <circle cx="50" cy="50" r="5.5" fill="${p.accent}"/>
    <!-- uid kept in scope for signature parity across compositions -->
    <g opacity="0" id="${uid}s"/>`;
};

/** Bar trio with a trend arrow — comparison, progress, results over time. */
const barTrio: ArtFn = ({ uid, palette: p }) => `
  <defs>${linearFade(`${uid}b`, p.accent, acc(p, 0.3))}</defs>
  <path d="M10 86 H92" stroke="${acc(p, 0.35)}" stroke-width="2"/>
  ${[[20, 46], [45, 30], [70, 14]].map(([x, y]) => `
    <rect x="${x}" y="${y}" width="18" height="${86 - y}" rx="6" fill="url(#${uid}b)"/>`).join('')}
  <path d="M22 40 L48 24 L76 9" fill="none" stroke="${p.heading}" stroke-width="2.6"
        stroke-linecap="round" stroke-dasharray="5 5" opacity="0.6"/>
  <path d="M70 8 L79 7 L78 16" fill="none" stroke="${p.heading}" stroke-width="2.6"
        stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>`;

/** Shield with a tick — protection, emergency fund, insurance awareness. */
const shieldGuard: ArtFn = ({ uid, palette: p }) => `
  <defs>${linearFade(`${uid}sh`, acc(p, 0.34), acc(p, 0.06))}</defs>
  <path d="M50 8 L86 21 v27 c0 20 -16 33 -36 42 -20 -9 -36 -22 -36 -42 V21 Z" fill="url(#${uid}sh)"/>
  <path d="M50 8 L86 21 v27 c0 20 -16 33 -36 42 -20 -9 -36 -22 -36 -42 V21 Z"
        fill="none" stroke="${p.accent}" stroke-width="3.2" stroke-linejoin="round"/>
  <path d="M35 49 L45 59 L67 37" fill="none" stroke="${p.accent}" stroke-width="5.2"
        stroke-linecap="round" stroke-linejoin="round"/>`;

/** Compounding curve — a small start bending sharply upward. */
const compoundCurve: ArtFn = ({ uid, palette: p }) => `
  <defs>${linearFade(`${uid}cc`, acc(p, 0.36), acc(p, 0))}</defs>
  <path d="M8 86 C40 86 52 74 66 50 C76 32 82 20 92 12 L92 88 L8 88 Z" fill="url(#${uid}cc)"/>
  <path d="M8 86 C40 86 52 74 66 50 C76 32 82 20 92 12" fill="none"
        stroke="${p.accent}" stroke-width="3.6" stroke-linecap="round"/>
  ${[[24, 85, 3], [46, 79, 4.2], [66, 50, 5.4], [92, 12, 7]]
    .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${p.accent}" opacity="0.9"/>`).join('')}
  <path d="M8 88 H92" stroke="${acc(p, 0.35)}" stroke-width="1.6"/>`;

/** Piggy bank with a coin dropping in. */
const piggyBank: ArtFn = ({ uid, palette: p }) => `
  <defs>${linearFade(`${uid}pb`, acc(p, 0.9), acc(p, 0.45))}</defs>
  <ellipse cx="50" cy="60" rx="33" ry="26" fill="url(#${uid}pb)"/>
  <path d="M24 76 v9 h9 v-7 M67 76 v9 h9 v-8" fill="${acc(p, 0.75)}"/>
  <path d="M78 46 q10 4 8 14" fill="none" stroke="${p.accent}" stroke-width="3" stroke-linecap="round"/>
  <circle cx="34" cy="53" r="3.4" fill="${p.bgFrom}"/>
  <rect x="42" y="33" width="17" height="4.5" rx="2.2" fill="${p.bgFrom}" opacity="0.85"/>
  <circle cx="50" cy="16" r="9" fill="${p.accent}"/>
  <circle cx="50" cy="16" r="5" fill="${acc(p, 0.4)}"/>`;

/** Calendar grid with marked dates — SIP, habits, monthly discipline. */
const calendarPlan: ArtFn = ({ uid, palette: p }) => {
  const cells: string[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      const marked = (r * 5 + c) % 4 === 1;
      cells.push(`<rect x="${16 + c * 14}" y="${44 + r * 14}" width="10" height="10" rx="3"
        fill="${marked ? p.accent : acc(p, 0.16)}"/>`);
    }
  }
  return `
    <rect x="10" y="22" width="80" height="68" rx="10" fill="${acc(p, 0.1)}"
          stroke="${acc(p, 0.45)}" stroke-width="2.4"/>
    <rect x="10" y="22" width="80" height="16" rx="10" fill="${acc(p, 0.42)}"/>
    <rect x="26" y="14" width="5" height="14" rx="2.5" fill="${p.accent}"/>
    <rect x="69" y="14" width="5" height="14" rx="2.5" fill="${p.accent}"/>
    ${cells.join('')}
    <g opacity="0" id="${uid}cal"/>`;
};

/** Target with an arrow in the centre — goals, planning, aim. */
const targetGoal: ArtFn = ({ uid, palette: p }) => `
  <circle cx="46" cy="54" r="34" fill="none" stroke="${acc(p, 0.22)}" stroke-width="7"/>
  <circle cx="46" cy="54" r="22" fill="none" stroke="${acc(p, 0.48)}" stroke-width="7"/>
  <circle cx="46" cy="54" r="9" fill="${p.accent}"/>
  <path d="M46 54 L88 14" stroke="${p.heading}" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M88 14 l-11 1.5 M88 14 l-1.5 11" stroke="${p.heading}" stroke-width="3.4" stroke-linecap="round"/>
  <path d="M74 10 l6 -6 4 10 10 4 -6 6" fill="${acc(p, 0.55)}"/>
  <g opacity="0" id="${uid}tg"/>`;

/** Seedling rising out of a coin — long-term investing, patience. */
const seedlingGrowth: ArtFn = ({ uid, palette: p }) => `
  <defs>${linearFade(`${uid}sg`, acc(p, 0.85), acc(p, 0.4))}</defs>
  <ellipse cx="50" cy="82" rx="30" ry="8" fill="${acc(p, 0.2)}"/>
  <rect x="26" y="66" width="48" height="14" rx="7" fill="url(#${uid}sg)"/>
  <path d="M50 66 V34" stroke="${p.accent}" stroke-width="3.6" stroke-linecap="round"/>
  <path d="M50 46 C36 46 28 38 28 26 C42 26 50 34 50 46 Z" fill="${acc(p, 0.72)}"/>
  <path d="M50 40 C64 40 72 32 72 20 C58 20 50 28 50 40 Z" fill="${p.accent}"/>
  <circle cx="50" cy="14" r="5" fill="${acc(p, 0.5)}"/>`;

/** Scales in balance — risk vs return, trade-offs, allocation. */
const balanceScales: ArtFn = ({ uid, palette: p }) => `
  <path d="M50 16 V80" stroke="${p.accent}" stroke-width="3.6" stroke-linecap="round"/>
  <path d="M18 30 H82" stroke="${p.accent}" stroke-width="3.6" stroke-linecap="round"/>
  <circle cx="50" cy="16" r="5.5" fill="${p.accent}"/>
  <rect x="34" y="80" width="32" height="7" rx="3.5" fill="${p.accent}"/>
  <path d="M18 30 L8 54 h20 Z" fill="${acc(p, 0.62)}"/>
  <path d="M82 30 L72 54 h20 Z" fill="${acc(p, 0.34)}"/>
  <path d="M8 54 a10 10 0 0 0 20 0" fill="none" stroke="${p.accent}" stroke-width="2.4"/>
  <path d="M72 54 a10 10 0 0 0 20 0" fill="none" stroke="${p.accent}" stroke-width="2.4"/>
  <g opacity="0" id="${uid}bs"/>`;

/** Umbrella over droplets — cover, protection, rainy-day money. */
const umbrellaCover: ArtFn = ({ uid, palette: p }) => `
  <defs>${linearFade(`${uid}u`, p.accent, acc(p, 0.45), false)}</defs>
  <path d="M12 50 a38 38 0 0 1 76 0 Z" fill="url(#${uid}u)"/>
  <path d="M12 50 a38 38 0 0 1 76 0" fill="none" stroke="${p.accent}" stroke-width="2.6"/>
  <path d="M12 50 q13 12 25 0 q13 12 26 0 q13 12 25 0" fill="none"
        stroke="${p.bgFrom}" stroke-width="2.4" opacity="0.55"/>
  <path d="M50 50 V78 a8 8 0 0 1 -16 0" fill="none" stroke="${p.accent}"
        stroke-width="3.4" stroke-linecap="round"/>
  ${[[22, 68], [74, 64], [62, 80]].map(([x, y]) =>
    `<path d="M${x} ${y} q4 6 0 8 q-4 -2 0 -8" fill="${acc(p, 0.6)}"/>`).join('')}
  <g opacity="0" id="${uid}uc"/>`;

/** Question mark inside a rounded frame — myths, FAQs, quizzes. */
const questionCard: ArtFn = ({ uid, palette: p }) => `
  <defs>${linearFade(`${uid}q`, acc(p, 0.28), acc(p, 0.05))}</defs>
  <rect x="14" y="12" width="72" height="72" rx="20" fill="url(#${uid}q)"
        stroke="${acc(p, 0.5)}" stroke-width="2.8"/>
  <path d="M38 40 a12 12 0 1 1 15 11.5 c-3.4 1.2 -3.4 4.4 -3.4 7"
        fill="none" stroke="${p.accent}" stroke-width="6" stroke-linecap="round"/>
  <circle cx="49.6" cy="70" r="4.4" fill="${p.accent}"/>`;

// --- registry --------------------------------------------------------------

export const FINANCE_ART: Record<string, ArtFn> = {
  growthChart, coinStack, donutSplit, barTrio, shieldGuard, compoundCurve,
  piggyBank, calendarPlan, targetGoal, seedlingGrowth, balanceScales,
  umbrellaCover, questionCard,
};

export type ArtKey = keyof typeof FINANCE_ART;

/**
 * Category → the compositions that suit it.
 *
 * Several per category on purpose: picking deterministically from a set keeps a
 * given poster stable across re-renders while stopping every "Savings" post in
 * the feed from looking identical.
 */
const CATEGORY_ART: Record<string, ArtKey[]> = {
  'Personal Finance':            ['coinStack', 'growthChart', 'piggyBank'],
  'Money Management':            ['calendarPlan', 'barTrio', 'coinStack'],
  'Financial Literacy':          ['questionCard', 'growthChart', 'balanceScales'],
  'Savings':                     ['piggyBank', 'coinStack', 'calendarPlan'],
  'Budgeting':                   ['calendarPlan', 'donutSplit', 'barTrio'],
  'Investment Basics':           ['growthChart', 'seedlingGrowth', 'barTrio'],
  'Mutual Fund Concepts':        ['donutSplit', 'growthChart', 'barTrio'],
  'Stock Market Education':      ['barTrio', 'growthChart', 'balanceScales'],
  'Investor Psychology':         ['balanceScales', 'questionCard', 'targetGoal'],
  'Financial Planning':          ['targetGoal', 'calendarPlan', 'growthChart'],
  'Goal Based Investing':        ['targetGoal', 'seedlingGrowth', 'growthChart'],
  'Emergency Fund':              ['shieldGuard', 'umbrellaCover', 'piggyBank'],
  'Retirement Planning':         ['seedlingGrowth', 'compoundCurve', 'calendarPlan'],
  'Children Education Planning': ['seedlingGrowth', 'targetGoal', 'piggyBank'],
  'Power of Compounding':        ['compoundCurve', 'seedlingGrowth', 'growthChart'],
  'Inflation':                   ['balanceScales', 'compoundCurve', 'coinStack'],
  'Risk vs Return':              ['balanceScales', 'barTrio', 'shieldGuard'],
  'Asset Allocation':            ['donutSplit', 'balanceScales', 'barTrio'],
  'Diversification':             ['donutSplit', 'barTrio', 'shieldGuard'],
  'Wealth Building':             ['compoundCurve', 'coinStack', 'seedlingGrowth'],
  'Money Habits':                ['calendarPlan', 'piggyBank', 'targetGoal'],
  'Behavioural Finance':         ['balanceScales', 'questionCard', 'targetGoal'],
  'Tax Awareness':               ['calendarPlan', 'donutSplit', 'questionCard'],
  'Financial Myths':             ['questionCard', 'balanceScales', 'shieldGuard'],
  'Financial Mistakes':          ['questionCard', 'shieldGuard', 'balanceScales'],
  'SIP Concepts':                ['calendarPlan', 'compoundCurve', 'growthChart'],
  'Long Term Investing':         ['compoundCurve', 'seedlingGrowth', 'growthChart'],
  'Financial Independence':      ['targetGoal', 'compoundCurve', 'seedlingGrowth'],
  'Insurance Awareness':         ['umbrellaCover', 'shieldGuard', 'balanceScales'],
  'Did You Know':                ['questionCard', 'growthChart', 'coinStack'],
  'Finance Quiz':                ['questionCard', 'targetGoal', 'balanceScales'],
};

const FALLBACK_ART: ArtKey[] = ['growthChart', 'coinStack', 'donutSplit', 'barTrio', 'compoundCurve'];

/** Stable per-content hash, so a poster keeps its art across re-renders. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function artForCategory(category: string, seed = ''): ArtFn {
  const options = CATEGORY_ART[category]?.length ? CATEGORY_ART[category] : FALLBACK_ART;
  const key = options[hash(category + seed) % options.length];
  return FINANCE_ART[key] ?? FINANCE_ART.growthChart;
}

/**
 * Render a composition at a position and size.
 *
 * `uid` must be unique per call — the gradients inside are referenced by id,
 * and two compositions sharing one would make the second silently adopt the
 * first's colours.
 */
export function art(
  fn: ArtFn, x: number, y: number, size: number, palette: Palette, uid: string, opacity = 1,
): string {
  const s = size / 100;
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${s.toFixed(4)})"
             opacity="${opacity}">${fn({ uid, palette })}</g>`;
}
