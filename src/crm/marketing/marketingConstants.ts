// Marketing Tool — Content Creation constants.
// Single source of truth for the taxonomy the studio offers, the platform
// geometry the renderer targets, and the compliance rules the generated copy is
// linted against.

// ---------------------------------------------------------------------------
// Topic taxonomy — education only. Deliberately contains no product, fund,
// scheme or issuer names: this module never promotes anything NIYOM sells.
// ---------------------------------------------------------------------------
export const CONTENT_CATEGORIES = [
  'Personal Finance',
  'Money Management',
  'Financial Literacy',
  'Savings',
  'Budgeting',
  'Investment Basics',
  'Mutual Fund Concepts',
  'Stock Market Education',
  'Investor Psychology',
  'Financial Planning',
  'Goal Based Investing',
  'Emergency Fund',
  'Retirement Planning',
  'Children Education Planning',
  'Power of Compounding',
  'Inflation',
  'Risk vs Return',
  'Asset Allocation',
  'Diversification',
  'Wealth Building',
  'Money Habits',
  'Behavioural Finance',
  'Tax Awareness',
  'Financial Myths',
  'Financial Mistakes',
  'Economic Awareness',
  'Market Awareness',
  'Investment Terminologies',
  'Investment Journey',
  'Financial Independence',
  'Long Term Investing',
  'SIP Concepts',
  'Passive Income Education',
  'Business Finance Basics',
  'Family Financial Planning',
  'Insurance Awareness',
  'Market History',
  'Interesting Financial Facts',
  'Comparison Infographics',
  'Weekly Finance Facts',
  'Finance Quiz',
  'Did You Know',
  'Finance Quotes',
  'Investor Awareness',
  'Financial Checklists',
  'Budget Templates',
  'Money Challenges',
  'Finance FAQs',
  'Beginner Finance Guides',
] as const;

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------
export const CONTENT_TYPES = [
  { id: 'poster',          label: 'Poster',                kind: 'image', slides: false, video: false },
  { id: 'carousel',        label: 'Carousel',              kind: 'image', slides: true,  video: false },
  { id: 'story',           label: 'Instagram Story',       kind: 'image', slides: false, video: false },
  { id: 'facebook_post',   label: 'Facebook Post',         kind: 'image', slides: false, video: false },
  { id: 'linkedin_post',   label: 'LinkedIn Post',         kind: 'image', slides: false, video: false },
  { id: 'infographic',     label: 'Finance Infographic',   kind: 'image', slides: true,  video: false },
  { id: 'animated_poster', label: 'Animated Poster',       kind: 'video', slides: false, video: true  },
  { id: 'motion_graphic',  label: 'Motion Graphic',        kind: 'video', slides: false, video: true  },
  { id: 'short_video',     label: 'Short Video',           kind: 'video', slides: false, video: true  },
] as const;

export const VIDEO_DURATIONS = [15, 30, 45, 60] as const;

export const PLATFORMS = [
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook',  label: 'Facebook' },
  { id: 'linkedin',  label: 'LinkedIn' },
] as const;

// ---------------------------------------------------------------------------
// Platform geometry. Rendered at full export resolution — these are the exact
// pixel sizes the PNG/video encoders target.
// ---------------------------------------------------------------------------
export const ASPECT_VARIANTS = {
  square:    { label: 'Square (1:1)',     width: 1080, height: 1080 },
  portrait:  { label: 'Portrait (4:5)',   width: 1080, height: 1350 },
  story:     { label: 'Story (9:16)',     width: 1080, height: 1920 },
  landscape: { label: 'Landscape (1.91:1)', width: 1200, height: 628 },
} as const;

// Which ratios each content type exports by default.
export const VARIANTS_FOR_TYPE: Record<string, (keyof typeof ASPECT_VARIANTS)[]> = {
  poster:          ['square', 'portrait', 'story', 'landscape'],
  carousel:        ['portrait'],
  story:           ['story'],
  facebook_post:   ['square', 'landscape'],
  linkedin_post:   ['square', 'landscape'],
  infographic:     ['portrait', 'square'],
  animated_poster: ['square'],
  motion_graphic:  ['square'],
  short_video:     ['story'],
};

export const DEFAULT_SLIDE_COUNT = 5;
export const MAX_SLIDE_COUNT = 10;

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------

// Replaced with the *reading* employee's personal onboarding URL at copy time.
export const REF_LINK_PLACEHOLDER = '{{REF_LINK}}';

export const PUBLIC_SITE_ORIGIN = 'https://www.niyomwealth.com';

/**
 * Phrases that must never appear in generated copy. NIYOM is a distributor, so
 * anything that reads as a recommendation, a return promise or a purchase
 * prompt is a compliance problem, not just an editorial one.
 *
 * Mirrored server-side in the mkt-generate-content edge function — the server
 * copy is authoritative. This copy powers the live badge in the studio so an
 * admin editing by hand gets the same feedback before saving.
 */
export const BANNED_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bbuy\s+(now|today|this|these)\b/i,                 label: 'purchase prompt' },
  { pattern: /\binvest\s+(now|today|in\s+this)\b/i,               label: 'purchase prompt' },
  { pattern: /\b(guaranteed|assured|fixed)\s+returns?\b/i,        label: 'return promise' },
  { pattern: /\brisk[\s-]?free\b/i,                               label: 'return promise' },
  { pattern: /\bdouble\s+your\s+money\b/i,                        label: 'return promise' },
  { pattern: /\b\d+\s*%\s*(guaranteed|assured|fixed|sure)\b/i,    label: 'return promise' },
  { pattern: /\bsure\s?shot\b/i,                                  label: 'return promise' },
  { pattern: /\bhighest\s+returns?\b/i,                           label: 'return promise' },
  { pattern: /\bbest\s+(stock|fund|scheme|bond|investment)s?\b/i, label: 'recommendation' },
  { pattern: /\b(recommend|recommended|recommendation)\b/i,       label: 'recommendation' },
  { pattern: /\bmust[\s-]?buy\b/i,                                label: 'recommendation' },
  { pattern: /\bmultibagger\b/i,                                  label: 'recommendation' },
  { pattern: /\bhot\s+(stock|pick|tip)s?\b/i,                     label: 'recommendation' },
  { pattern: /\b(limited|last)\s+(time\s+)?offer\b/i,             label: 'urgency / selling' },
  { pattern: /\bhurry\b/i,                                        label: 'urgency / selling' },
  { pattern: /\bdon'?t\s+miss\s+out\b/i,                          label: 'urgency / selling' },
  { pattern: /\bdm\s+(me|us)\s+to\s+invest\b/i,                   label: 'urgency / selling' },
  { pattern: /\bapply\s+now\b/i,                                  label: 'urgency / selling' },
  { pattern: /\bbook\s+your\s+(profit|gain)s?\b/i,                label: 'advice' },
  { pattern: /\byou\s+should\s+(buy|invest|sell)\b/i,             label: 'advice' },
];

/** Education-first CTAs the studio offers as one-click replacements. */
export const SAFE_CTA_SUGGESTIONS = [
  'Learn more about financial planning.',
  'Start your financial journey.',
  'Improve your financial knowledge.',
  'Take the first step towards organised finances.',
  'Save this for when you plan your month.',
  'Share this with someone starting out.',
  'Follow for more money basics.',
];

/** Rendered on every asset — this content is educational, never advice. */
export const DISCLAIMER_TEXT = 'Educational content only. Not investment advice.';

export interface LintFinding {
  field: string;
  phrase: string;
  label: string;
}

/** Scan generated/edited copy for banned phrasing. Server logic mirrors this. */
export function lintContent(fields: Record<string, string | string[] | undefined>): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue;
    const text = Array.isArray(value) ? value.join(' ') : value;
    for (const { pattern, label } of BANNED_PATTERNS) {
      const match = text.match(pattern);
      if (match) findings.push({ field, phrase: match[0], label });
    }
  }
  return findings;
}

/** Build an employee's personal onboarding URL. */
export function buildReferralUrl(refCode: string, contentNo?: string, platform?: string): string {
  const params = new URLSearchParams({ ref: refCode });
  if (contentNo) params.set('cnt', contentNo);
  if (platform) params.set('pl', platform);
  return `${PUBLIC_SITE_ORIGIN}/onboarding?${params.toString()}`;
}

/**
 * The company's onboarding URL — deliberately bare.
 *
 * NIYOM posts this from its own accounts, where a tracking parameter looks
 * like a campaign link rather than the company's address. It needs no code:
 * a visit arriving without one is resolved to the company link server-side,
 * so clicks and signups still land on the company channel.
 */
export function buildCompanyUrl(): string {
  return `${PUBLIC_SITE_ORIGIN}/onboarding`;
}

/** Swap the placeholder for the reading employee's own link. */
export function applyReferralLink(
  caption: string,
  refCode: string,
  contentNo?: string,
  platform?: string,
): string {
  const url = buildReferralUrl(refCode, contentNo, platform);
  return caption.split(REF_LINK_PLACEHOLDER).join(url);
}

/** Caption + hashtags as one clipboard payload, link already substituted. */
export function buildCopyText(
  caption: string,
  hashtags: string[],
  refCode: string,
  contentNo?: string,
  platform?: string,
): string {
  const body = applyReferralLink(caption, refCode, contentNo, platform);
  const tags = hashtags.length ? `\n\n${formatHashtags(hashtags)}` : '';
  return `${body}${tags}`;
}

export function formatHashtags(hashtags: string[]): string {
  return hashtags.map(h => (h.startsWith('#') ? h : `#${h}`)).join(' ');
}
