import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTENT_CATEGORIES, CONTENT_TYPES, PLATFORMS } from './marketingConstants';
import { PALETTES } from './templates/brandTokens';
import { TEMPLATES } from './templates/templateSpecs';

/*
 * The automated content planner runs in SQL, so it needs the taxonomy in SQL.
 * The frontend and the database cannot import from one another, which leaves
 * exactly one honest option: duplicate the lists and make the duplication
 * checkable. That is what this file is.
 *
 * The failure it prevents is quiet, not loud. Add a category to
 * marketingConstants.ts and the studio offers it immediately while the daily
 * rotation never picks it — no error anywhere, just a category that silently
 * never ships. Same for a new template or palette: the planner would keep
 * choosing from a stale list and the new design would never appear.
 *
 * Both files are in the repo, so this is a pure static check with no database
 * and no network.
 */

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../../../supabase/migrations/20260812090000_mkt_auto_schedule.sql', import.meta.url)),
  'utf8',
);

/** Pull the VALUES block of a seeding INSERT out of the migration. */
function valuesBlock(table: string): string {
  const start = MIGRATION.indexOf(`INSERT INTO ${table} `);
  expect(start, `no seeding INSERT for ${table}`).toBeGreaterThan(-1);
  const end = MIGRATION.indexOf('ON CONFLICT', start);
  return MIGRATION.slice(start, end);
}

describe('mkt_auto_categories seed', () => {
  const seeded = [...valuesBlock('mkt_auto_categories').matchAll(/\('([^']+)'\)/g)].map(m => m[1]);

  it('matches CONTENT_CATEGORIES exactly, including order', () => {
    expect(seeded).toEqual([...CONTENT_CATEGORIES]);
  });

  it('has no duplicates', () => {
    expect(new Set(seeded).size).toBe(seeded.length);
  });

  it('is long enough that a full cycle outlasts a fortnight', () => {
    /*
     * Three categories a day means the cycle length in run days is
     * ceil(n / 3). The seam guard in mkt_auto_seed_cycle shuffles within blocks
     * of ceil(n / 4), which bounds a recurrence at n + 1 - block slots. Below
     * about 30 categories that bound drops under two working weeks and
     * repetition starts to be noticeable to anyone following the feed.
     */
    expect(seeded.length).toBeGreaterThanOrEqual(30);
  });
});

describe('mkt_auto_content_types seed', () => {
  const seeded = [...valuesBlock('mkt_auto_content_types')
    .matchAll(/\('(\w+)',\s*(true|false),\s*(true|false),\s*(NULL|'(\w+)'),\s*(NULL|'(\w+)')\)/g)]
    .map(m => ({
      content_type: m[1],
      is_video: m[2] === 'true',
      is_deck: m[3] === 'true',
      hard_platform: m[5] ?? null,
      soft_platform: m[7] ?? null,
    }));

  it('matches CONTENT_TYPES exactly, including the video and deck flags', () => {
    expect(seeded.map(s => ({ id: s.content_type, video: s.is_video, slides: s.is_deck })))
      .toEqual(CONTENT_TYPES.map(t => ({ id: t.id, video: t.video, slides: t.slides })));
  });

  it('has three video types and six image types', () => {
    // One video a day and two images, against a five- or six-day week: this
    // split is what makes "all nine types this week" reachable at all.
    expect(seeded.filter(s => s.is_video)).toHaveLength(3);
    expect(seeded.filter(s => !s.is_video)).toHaveLength(6);
  });

  it('pins the three single-network types to three different platforms', () => {
    /*
     * story is 9:16, facebook_post and linkedin_post carry their networks'
     * names and ratios. Because the three pin to three DIFFERENT platforms, a
     * one-per-platform matching always exists no matter which types a day
     * draws. If two of them ever pinned to the same platform, some days would
     * become unplannable — and would fail at 07:50 on the UNIQUE constraint.
     */
    const hard = seeded.filter(s => s.hard_platform).map(s => s.hard_platform);
    expect(hard).toHaveLength(3);
    expect(new Set(hard).size).toBe(3);
  });

  it('only names platforms that exist', () => {
    const ids = new Set(PLATFORMS.map(p => p.id as string));
    for (const s of seeded) {
      if (s.hard_platform) expect(ids).toContain(s.hard_platform);
      if (s.soft_platform) expect(ids).toContain(s.soft_platform);
    }
  });
});

describe('style lists embedded in the planner', () => {
  /* The planner picks from literal arrays rather than tables — they are small,
     they belong to the renderer, and a table would only be another thing to
     keep in sync. That makes checking them here the whole safety net. */

  it('knows every palette', () => {
    const inSql = [...MIGRATION.matchAll(/SELECT unnest\(ARRAY\['midnightGold'[^)]*\)/g)][0]?.[0] ?? '';
    const seeded = [...inSql.matchAll(/'(\w+)'/g)].map(m => m[1]);
    expect(seeded.sort()).toEqual(Object.keys(PALETTES).sort());
  });

  it('knows every template, and which of them support slides', () => {
    const all = [...MIGRATION.matchAll(/ELSE ARRAY\[([^\]]+)\]/g)][0]?.[1] ?? '';
    expect([...all.matchAll(/'(\w+)'/g)].map(m => m[1]).sort())
      .toEqual(TEMPLATES.map(t => t.id).sort());

    const decks = [...MIGRATION.matchAll(/WHEN v_is_deck\s+THEN ARRAY\[([^\]]+)\]/g)][0]?.[1] ?? '';
    expect([...decks.matchAll(/'(\w+)'/g)].map(m => m[1]).sort())
      .toEqual(TEMPLATES.filter(t => t.supportsSlides).map(t => t.id).sort());
  });
});
