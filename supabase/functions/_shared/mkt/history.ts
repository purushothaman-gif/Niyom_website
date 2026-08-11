// Uniqueness inputs: what has already been written, so the model can avoid it.
//
// Reads go through `sbSelect` from ../cas/db.ts — the repo's one PostgREST read
// helper. It lives under cas/ for historical reasons but is generic, and its
// config-as-a-parameter shape is exactly what is wanted here: no `Deno.env` at
// import time, so these modules load under vitest as readily as under Deno.
// Using the supabase-js client instead would make every module that touches
// history un-runnable in the Node test runner.

import { sbSelect } from '../cas/db.ts';
import { sbRpc } from './db.ts';
import type { SbConfig } from '../cas/db.ts';
import type { Flag } from './types.ts';

interface HistoryRow {
  title: string | null;
  headline: string | null;
  topic: string | null;
  hashtags: string[] | null;
}

const eq = (v: string) => `eq.${encodeURIComponent(v)}`;

/**
 * Recent titles/headlines/hashtags in one category, for the uniqueness contract.
 *
 * Reads both the live table and the slim history rows that survive expiry —
 * content is hard-deleted after its window closes, so `mkt_content` alone would
 * forget everything older than a couple of days and the model would happily
 * rewrite last week's post.
 */
export async function loadHistory(cfg: SbConfig, category: string): Promise<string> {
  const cols = 'select=title,headline,topic,hashtags';
  const [hist, live] = await Promise.all([
    sbSelect<HistoryRow>(cfg, `mkt_content_history?${cols}&category=${eq(category)}&order=deleted_at.desc&limit=100`),
    sbSelect<HistoryRow>(cfg, `mkt_content?${cols}&category=${eq(category)}&order=created_at.desc&limit=100`),
  ]);

  const lines = [...live, ...hist].map(row => {
    const tags = Array.isArray(row.hashtags) ? row.hashtags.slice(0, 8).join(' ') : '';
    return `- "${row.title}" | ${row.headline} | topic: ${row.topic} | ${tags}`;
  });
  return lines.slice(0, 100).join('\n');
}

/** Jaccard overlap between two hashtag sets. */
export function tagOverlap(a: string[], b: string[]): number {
  const norm = (t: string) => t.replace(/^#/, '').toLowerCase();
  const A = new Set(a.map(norm));
  const B = new Set(b.map(norm));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / new Set([...A, ...B]).size;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/**
 * Soft duplicate check against live content in the same category.
 *
 * Stops at the first row that matches on either signal — one "this already
 * exists" flag is as actionable as twenty, and the admin only needs to be told
 * once. The automated path treats these as hard blocks on auto-approval; the
 * manual studio treats them as flags, because the admin is right there and can
 * judge whether a near-match actually matters.
 */
export async function duplicateFlags(
  cfg: SbConfig,
  draft: Record<string, unknown>,
  category: string,
): Promise<Flag[]> {
  const recent = await sbSelect<HistoryRow>(
    cfg,
    `mkt_content?select=title,headline,hashtags&category=${eq(category)}&limit=100`,
  );

  for (const row of recent) {
    if (norm(row.title) === norm(draft.title) || norm(row.headline) === norm(draft.headline)) {
      return [{ field: 'title', phrase: String(draft.title), label: 'duplicate of existing content' }];
    }
    if (tagOverlap((draft.hashtags as string[]) ?? [], row.hashtags ?? []) > 0.8) {
      return [{ field: 'hashtags', phrase: '(near-identical hashtag set)', label: 'duplicate of existing content' }];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Stricter uniqueness, for the automated path
//
// The category-scoped loader above is nearly useless on a daily cadence: a
// category recurs only every ~16 run days, so yesterday's three posts are
// invisible to today's prompt. Meanwhile the failure that actually happens is
// cross-category — the same compounding lesson under six different category
// names — and it is invisible to a same-category check by construction.
// ---------------------------------------------------------------------------

/** Recent work in every category, as a second fenced block for the prompt. */
export async function loadRecentAcrossCategories(
  cfg: SbConfig,
  days = 45,
  limit = 120,
): Promise<string> {
  const rows = await sbRpc<{ category: string; title: string; headline: string; topic: string }[]>(
    cfg, 'mkt_auto_recent_across_categories', { p_days: days, p_limit: limit },
  );
  return rows
    .map(r => `- [${r.category}] "${r.title}" | ${r.headline}${r.topic ? ` | topic: ${r.topic}` : ''}`)
    .join('\n');
}

/**
 * Every topic ever used in one category, uncapped.
 *
 * The brief allows a category to recur only "with a different topic". The model
 * can only honour that if it is shown the complete list, and with a ~16-run-day
 * cycle the list stays at a couple of dozen entries a year — small enough to
 * send in full.
 */
export async function loadCategoryTopics(cfg: SbConfig, category: string): Promise<string[]> {
  return await sbRpc<string[]>(cfg, 'mkt_auto_category_topics', { p_category: category });
}

/** How close the nearest existing headline is, and which one. */
export async function nearestHeadline(
  cfg: SbConfig,
  headline: string,
): Promise<{ content_no: string; headline: string; similarity: number } | null> {
  if (!headline.trim()) return null;
  const rows = await sbRpc<{ content_no: string; headline: string; similarity: number }[]>(
    cfg, 'mkt_auto_similar_headlines', { p_headline: headline, p_limit: 1 },
  );
  return rows[0] ?? null;
}

/**
 * The automated path's duplicate gate.
 *
 * Adds trigram similarity to the exact-match and hashtag checks, because the
 * common near-duplicate is neither: "The magic of compounding explained" and
 * "Compounding, explained simply" share no exact string and few hashtags but
 * are the same post. 0.5 was chosen to sit above the level at which two posts
 * about the same category merely use the same vocabulary.
 *
 * These are HARD blocks on auto-approval, unlike the manual studio's soft flags
 * — there is no admin standing by at 08:00 to judge a near-match, and a
 * duplicate under the firm's brand is worse than a missing post.
 */
export async function hardDuplicateFlags(
  cfg: SbConfig,
  draft: Record<string, unknown>,
  category: string,
): Promise<Flag[]> {
  const flags = await duplicateFlags(cfg, draft, category);

  const near = await nearestHeadline(cfg, String(draft.headline ?? ''));
  if (near && near.similarity > 0.5) {
    flags.push({
      field: 'headline',
      phrase: `${Math.round(near.similarity * 100)}% similar to ${near.content_no}`,
      label: 'near-duplicate of existing content',
    });
  }
  return flags;
}
