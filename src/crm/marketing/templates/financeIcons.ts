// Inline finance iconography for generated assets.
//
// Inline paths, not linked files: an SVG rasterised through an <img> cannot
// fetch external resources, and any remote reference would taint the canvas and
// break toBlob(). Each icon is authored on a 24x24 grid and drawn as strokes so
// it inherits the palette accent at any scale.

export interface IconDef {
  /** Path data on a 24x24 viewBox. */
  d: string;
  /** Extra paths drawn as filled dots/accents. */
  dots?: { cx: number; cy: number; r: number }[];
}

export const FINANCE_ICONS: Record<string, IconDef> = {
  growth:     { d: 'M3 17 L9 11 L13 15 L21 7 M21 7 L15 7 M21 7 L21 13' },
  savings:    { d: 'M4 10 h16 v9 a2 2 0 0 1 -2 2 H6 a2 2 0 0 1 -2 -2 Z M8 10 V7 a4 4 0 0 1 8 0 v3', dots: [{ cx: 12, cy: 15, r: 1.6 }] },
  shield:     { d: 'M12 3 L20 6 v6 c0 4 -3.5 7 -8 9 -4.5 -2 -8 -5 -8 -9 V6 Z M9 12 l2 2 4 -4' },
  compound:   { d: 'M4 19 C8 19 8 5 12 5 C16 5 16 19 20 19' },
  budget:     { d: 'M4 6 h16 v12 H4 Z M4 10 h16 M9 10 v8' },
  goal:       { d: 'M12 3 v18 M5 5 h10 l-2 3 2 3 H5 Z' },
  clock:      { d: 'M12 21 a9 9 0 1 0 0 -18 a9 9 0 0 0 0 18 M12 7 v5 l3 2' },
  inflation:  { d: 'M4 18 L10 12 L14 15 L20 6 M6 6 h4 M6 6 v4' },
  balance:    { d: 'M12 4 v16 M5 8 h14 M5 8 l-2 6 h4 Z M19 8 l-2 6 h4 Z' },
  education:  { d: 'M3 9 L12 5 L21 9 L12 13 Z M7 11 v5 c0 1.5 2.2 2.5 5 2.5 s5 -1 5 -2.5 v-5' },
  wallet:     { d: 'M4 7 h13 a3 3 0 0 1 3 3 v7 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2 -2 V7 Z M4 7 a2 2 0 0 1 2 -2 h9', dots: [{ cx: 16.5, cy: 13.5, r: 1.3 }] },
  chart:      { d: 'M4 20 V4 M4 20 h16 M8 17 v-5 M12 17 v-9 M16 17 v-6' },
  idea:       { d: 'M9 18 h6 M10 21 h4 M12 3 a6 6 0 0 0 -3.5 10.9 V16 h7 v-2.1 A6 6 0 0 0 12 3 Z' },
  question:   { d: 'M12 21 a9 9 0 1 0 0 -18 a9 9 0 0 0 0 18 M9.5 9.5 a2.5 2.5 0 1 1 3.2 2.4 c-0.7 0.3 -0.7 1 -0.7 1.6', dots: [{ cx: 12, cy: 16.5, r: 1 }] },
  checklist:  { d: 'M4 6 l2 2 3 -3 M4 13 l2 2 3 -3 M4 20 l2 2 3 -3 M12 6 h8 M12 13 h8 M12 20 h8' },
  family:     { d: 'M7 20 v-3 a3 3 0 0 1 3 -3 h1 M17 20 v-4 a3 3 0 0 0 -3 -3', dots: [{ cx: 9, cy: 8, r: 2.4 }, { cx: 16, cy: 9, r: 2 }] },
};

/** Category → icon, so a poster always carries a relevant mark. */
export const CATEGORY_ICONS: Record<string, string> = {
  'Savings': 'savings', 'Budgeting': 'budget', 'Emergency Fund': 'shield',
  'Power of Compounding': 'compound', 'Inflation': 'inflation',
  'Risk vs Return': 'balance', 'Asset Allocation': 'balance', 'Diversification': 'balance',
  'Retirement Planning': 'clock', 'Long Term Investing': 'clock',
  'Children Education Planning': 'education', 'Financial Literacy': 'education',
  'Goal Based Investing': 'goal', 'Financial Planning': 'goal',
  'Investment Basics': 'growth', 'Wealth Building': 'growth', 'SIP Concepts': 'growth',
  'Stock Market Education': 'chart', 'Market Awareness': 'chart', 'Market History': 'chart',
  'Mutual Fund Concepts': 'chart', 'Comparison Infographics': 'chart',
  'Money Management': 'wallet', 'Personal Finance': 'wallet', 'Money Habits': 'wallet',
  'Finance Quiz': 'question', 'Finance FAQs': 'question', 'Did You Know': 'idea',
  'Interesting Financial Facts': 'idea', 'Financial Myths': 'idea', 'Finance Quotes': 'idea',
  'Financial Checklists': 'checklist', 'Budget Templates': 'checklist',
  'Family Financial Planning': 'family', 'Insurance Awareness': 'shield',
  'Investor Psychology': 'idea', 'Behavioural Finance': 'idea',
};

export function iconForCategory(category: string): IconDef {
  return FINANCE_ICONS[CATEGORY_ICONS[category] ?? 'growth'] ?? FINANCE_ICONS.growth;
}

/** Render an icon at (x, y) scaled from its 24x24 grid. */
export function iconSvg(icon: IconDef, x: number, y: number, size: number, color: string, strokeWidth = 1.7): string {
  const scale = size / 24;
  const dots = (icon.dots ?? [])
    .map(d => `<circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="${color}"/>`)
    .join('');
  return `<g transform="translate(${x},${y}) scale(${scale.toFixed(4)})"
             fill="none" stroke="${color}" stroke-width="${strokeWidth}"
             stroke-linecap="round" stroke-linejoin="round">
            <path d="${icon.d}"/>${dots}
          </g>`;
}
