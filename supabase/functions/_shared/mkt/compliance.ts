// Compliance lint for generated marketing copy.
//
// NIYOM is an AMFI-registered mutual fund distributor, so published copy cannot
// recommend, promise a return, or push a purchase. The model is instructed at
// length about this, but instructions are guidance — THIS regex pass is the
// gate. It is mirrored client-side in `src/crm/marketing/marketingConstants.ts`
// for live badges in the studio; this copy is authoritative.
//
// Extracted from mkt-generate-content/index.ts unchanged so the automated daily
// batch and the manual studio are judged by exactly one implementation. A
// second copy would drift, and the drift would only ever be discovered by
// something non-compliant reaching a client's feed.

import type { Draft, Flag } from './types.ts';

export const REF_PLACEHOLDER = '{{REF_LINK}}';

export const BANNED: { re: RegExp; label: string }[] = [
  { re: /\bbuy\s+(now|today|this|these)\b/i, label: 'purchase prompt' },
  { re: /\binvest\s+(now|today|in\s+this)\b/i, label: 'purchase prompt' },
  { re: /\b(guaranteed|assured|fixed)\s+returns?\b/i, label: 'return promise' },
  { re: /\brisk[\s-]?free\b/i, label: 'return promise' },
  { re: /\bdouble\s+your\s+money\b/i, label: 'return promise' },
  { re: /\b\d+\s*%\s*(guaranteed|assured|fixed|sure)\b/i, label: 'return promise' },
  { re: /\bsure\s?shot\b/i, label: 'return promise' },
  { re: /\bhighest\s+returns?\b/i, label: 'return promise' },
  { re: /\bbest\s+(stock|fund|scheme|bond|investment)s?\b/i, label: 'recommendation' },
  { re: /\b(recommend|recommended|recommendation)\b/i, label: 'recommendation' },
  { re: /\bmust[\s-]?buy\b/i, label: 'recommendation' },
  { re: /\bmultibagger\b/i, label: 'recommendation' },
  { re: /\bhot\s+(stock|pick|tip)s?\b/i, label: 'recommendation' },
  { re: /\b(limited|last)\s+(time\s+)?offer\b/i, label: 'urgency / selling' },
  { re: /\bhurry\b/i, label: 'urgency / selling' },
  { re: /\bdon'?t\s+miss\s+out\b/i, label: 'urgency / selling' },
  { re: /\bdm\s+(me|us)\s+to\s+invest\b/i, label: 'urgency / selling' },
  { re: /\bapply\s+now\b/i, label: 'urgency / selling' },
  { re: /\bbook\s+your\s+(profit|gain)s?\b/i, label: 'advice' },
  { re: /\byou\s+should\s+(buy|invest|sell)\b/i, label: 'advice' },
];

/** Scan every publishable field of a draft against the banned patterns. */
export function lint(draft: Record<string, unknown>): Flag[] {
  const flags: Flag[] = [];
  const scan = (field: string, value: unknown) => {
    if (!value) return;
    const text = Array.isArray(value) ? value.join(' ') : String(value);
    for (const { re, label } of BANNED) {
      const m = text.match(re);
      if (m) flags.push({ field, phrase: m[0], label });
    }
  };

  for (const f of ['title', 'headline', 'body', 'caption', 'cta']) scan(f, draft[f]);
  scan('hashtags', draft.hashtags);
  scan('seo_keywords', draft.seo_keywords);

  for (const s of (draft.slides as { heading?: string; body?: string }[] | null) ?? []) {
    scan('slides', `${s?.heading ?? ''} ${s?.body ?? ''}`);
  }
  for (const s of (draft.video_script as { text?: string }[] | null) ?? []) {
    scan('video_script', s?.text ?? '');
  }
  return flags;
}

/**
 * Checks that are about shape rather than wording.
 *
 * The referral placeholder is structural — the studio's copy button substitutes
 * the reading employee's own link into it, so a caption with zero or two
 * placeholders produces a broken post rather than a non-compliant one.
 *
 * Array counts are requested in the schema descriptions rather than enforced by
 * minItems/maxItems, which structured outputs does not support (an unsupported
 * keyword is a 400 from the API, not a silent no-op), so they are checked here.
 * Out-of-range counts are a flag rather than a hard failure — an admin can add
 * or trim tags by hand.
 */
export function structuralFlags(draft: Record<string, unknown>): Flag[] {
  const flags: Flag[] = [];

  const captionText = String(draft.caption ?? '');
  const placeholderCount = captionText.split(REF_PLACEHOLDER).length - 1;
  if (placeholderCount !== 1) {
    flags.push({
      field: 'caption',
      phrase: placeholderCount === 0
        ? '(missing referral link placeholder)'
        : '(duplicate referral link placeholder)',
      label: 'structure',
    });
  }

  const hashtagCount = Array.isArray(draft.hashtags) ? draft.hashtags.length : 0;
  if (hashtagCount < 8 || hashtagCount > 20) {
    flags.push({ field: 'hashtags', phrase: `(${hashtagCount} hashtags, expected 8-20)`, label: 'structure' });
  }

  const keywordCount = Array.isArray(draft.seo_keywords) ? draft.seo_keywords.length : 0;
  if (keywordCount < 5 || keywordCount > 10) {
    flags.push({ field: 'seo_keywords', phrase: `(${keywordCount} keywords, expected 5-10)`, label: 'structure' });
  }

  return flags;
}

/**
 * Proper nouns that travelled from a news headline into the draft.
 *
 * The daily batch seeds generation with sanitised news headlines so the copy
 * stays topical. Those headlines are untrusted third-party text, and the
 * realistic failure is not a dramatic jailbreak — it is the model helpfully
 * repeating "Sensex" or a fund house's name into copy that then gets published
 * under an AMFI-registered distributor's brand. That is simultaneously a
 * compliance breach and the signature of a successful injection, so it is
 * caught on the way out rather than only guarded on the way in.
 *
 * Capitalised runs of two or more words are the signal; single capitalised
 * words are too noisy (every sentence starts with one).
 */
export function entityLeakageFlags(draft: Record<string, unknown>, headlines: string[]): Flag[] {
  const entities = new Set<string>();
  for (const h of headlines) {
    for (const m of h.matchAll(/\b[A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*)+/g)) {
      const phrase = m[0].trim();
      // Two-word runs at the very start of a headline are usually just
      // sentence case, not a name. Require the run to sit inside the line.
      if (phrase.length >= 6 && m.index !== 0) entities.add(phrase);
    }
  }
  if (!entities.size) return [];

  const fields: [string, string][] = [
    ['title', String(draft.title ?? '')],
    ['headline', String(draft.headline ?? '')],
    ['body', String(draft.body ?? '')],
    ['caption', String(draft.caption ?? '')],
    ['cta', String(draft.cta ?? '')],
    ['slides', ((draft.slides as { heading?: string; body?: string }[] | null) ?? [])
      .map(s => `${s?.heading ?? ''} ${s?.body ?? ''}`).join(' ')],
    ['video_script', ((draft.video_script as { text?: string }[] | null) ?? [])
      .map(s => s?.text ?? '').join(' ')],
  ];

  const flags: Flag[] = [];
  for (const [field, text] of fields) {
    if (!text) continue;
    for (const phrase of entities) {
      if (text.includes(phrase)) {
        flags.push({ field, phrase, label: 'entity leaked from news source' });
      }
    }
  }
  return flags;
}

/** Convenience for callers that want every gate at once. */
export function allFlags(draft: Draft | Record<string, unknown>, headlines: string[] = []): Flag[] {
  const d = draft as Record<string, unknown>;
  return [...lint(d), ...structuralFlags(d), ...entityLeakageFlags(d, headlines)];
}
