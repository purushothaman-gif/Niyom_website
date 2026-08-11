// Today's news, as topic-selection evidence for the daily batch.
//
// ## The threat model, stated plainly
//
// This module takes text scraped from public RSS feeds and puts it in front of
// a model whose output is published under an AMFI-registered distributor's
// brand. Anyone who can get a headline into Economic Times or a Google News
// query result can put text in this prompt. So none of it is trusted.
//
// The defences are layered, and the layer that actually matters is the last one:
//
//   1. sanitise() strips characters that could forge an XML tag or close the
//      fence, and drops headlines that read like instructions;
//   2. the prompt fences the block and says it is untrusted (prompt.ts);
//   3. entityLeakageFlags() catches proper nouns that travelled from a headline
//      into the copy — the realistic failure, and also the signature of a
//      successful injection (compliance.ts);
//   4. the twenty compliance regexes run on the output regardless, and
//      auto-approval requires ZERO flags.
//
// A successful injection would therefore have to produce copy that passes all
// twenty compliance patterns, contains no proper noun from its own source, and
// carries exactly one referral placeholder. Anything else is a draft nobody
// publishes.

import { sbSelect } from '../cas/db.ts';
import type { SbConfig } from '../cas/db.ts';
import type { TrendItem } from './types.ts';

/** Headlines only, capped hard. Longer text is more injection surface and no
 *  more signal — the batch needs to know WHAT is being discussed, not details. */
const MAX_ITEMS = 8;
const MAX_CHARS = 120;
const FRESH_HOURS = 36;

/*
 * Phrases that mean a headline is trying to talk to the model rather than
 * report something. A real financial headline never needs any of these, so the
 * false-positive cost is one dropped item out of a pool of eighty.
 */
const INSTRUCTION_LIKE =
  /\b(ignore|disregard|override|instead|system\s+prompt|you\s+are|act\s+as|respond\s+with|reply\s+with|output|print|new\s+instructions?|forget\s+(all|everything|previous))\b/i;

/**
 * Reduce a headline to inert text, or reject it.
 *
 * The character filter is the load-bearing part: stripping everything outside
 * letters, digits and a short punctuation set removes `<`, `>`, `{`, `}`,
 * backticks and backslashes, so a headline cannot open a tag, close the
 * `<market_context>` fence, or forge a `{{REF_LINK}}` token.
 */
export function sanitiseHeadline(raw: string): string | null {
  if (!raw) return null;

  const cleaned = raw
    .replace(/[^\p{L}\p{N}\s.,:;'’()%&/-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS)
    .trim();

  if (cleaned.length < 15) return null;              // too short to carry signal
  if (INSTRUCTION_LIKE.test(cleaned)) return null;
  // Belt and braces: the character filter already removes braces, so this only
  // fires if that filter is ever loosened.
  if (cleaned.includes('{{') || cleaned.includes('}}')) return null;

  return cleaned;
}

interface NewsRow {
  title: string | null;
  source: string | null;
  category: string | null;
  published_at: string | null;
}

/**
 * Refresh the news table, best-effort, then read the fresh headlines.
 *
 * `fetch-financial-news` is verify_jwt = true and has no cron of its own, so it
 * is invoked here with the service-role bearer — no config change, no redeploy,
 * and no new anonymous endpoint. It is deliberately best-effort: stale news
 * makes a less timely batch, not a failed one, and the batch must not depend on
 * an external RSS feed being up at 08:00.
 */
export async function loadTrends(cfg: SbConfig): Promise<TrendItem[]> {
  try {
    await fetch(`${cfg.supabaseUrl}/functions/v1/fetch-financial-news`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.supabaseServiceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  } catch {
    // Proceed with whatever is already in the table.
  }

  const since = new Date(Date.now() - FRESH_HOURS * 3_600_000).toISOString();
  let rows: NewsRow[] = [];
  try {
    rows = await sbSelect<NewsRow>(
      cfg,
      `news?select=title,source,category,published_at&published_at=gte.${since}` +
      `&order=published_at.desc&limit=60`,
    );
  } catch {
    return [];
  }

  // Spread across categories rather than taking the eight most recent, which on
  // a busy market day would all be the same story from the same feed.
  const perCategory = new Map<string, TrendItem[]>();
  for (const r of rows) {
    const title = sanitiseHeadline(r.title ?? '');
    if (!title) continue;
    const key = r.category ?? 'general';
    const list = perCategory.get(key) ?? [];
    if (list.length < 3) list.push({ title, source: r.source ?? '' });
    perCategory.set(key, list);
  }

  const out: TrendItem[] = [];
  let depth = 0;
  while (out.length < MAX_ITEMS && depth < 3) {
    for (const list of perCategory.values()) {
      if (list[depth] && out.length < MAX_ITEMS) out.push(list[depth]);
    }
    depth++;
  }
  return out;
}
