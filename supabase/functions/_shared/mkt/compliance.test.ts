import { describe, expect, it } from 'vitest';
import { BANNED, entityLeakageFlags, lint, structuralFlags } from './compliance.ts';
import { tagOverlap } from './history.ts';

/** A draft that passes every gate, so each test can break exactly one thing. */
const clean = () => ({
  title: 'How compounding actually works',
  headline: 'Time does more of the work than the amount does',
  body: 'Start early and each instalment carries less of the load.',
  caption: 'Learning where to begin? Start here: {{REF_LINK}}',
  cta: 'Learn how compounding works',
  hashtags: ['compounding', 'personalfinance', 'moneybasics', 'investing101',
    'financialliteracy', 'savings', 'sip', 'wealthbuilding'],
  seo_keywords: ['compounding', 'personal finance', 'savings', 'investing basics', 'financial literacy'],
  slides: null,
  video_script: null,
});

describe('lint', () => {
  it('passes clean educational copy', () => {
    expect(lint(clean())).toEqual([]);
  });

  it.each([
    ['headline', 'The best fund for beginners', 'recommendation'],
    ['body', 'This gives guaranteed returns every year.', 'return promise'],
    ['cta', 'Buy now before it closes', 'purchase prompt'],
    ['caption', 'Hurry, this is a limited offer {{REF_LINK}}', 'urgency / selling'],
    ['title', 'You should invest in this today', 'advice'],
  ])('flags %s containing a %s violation', (field, value, label) => {
    const flags = lint({ ...clean(), [field]: value });
    expect(flags.some(f => f.field === field && f.label === label)).toBe(true);
  });

  it('scans inside slides and video scripts, not just top-level fields', () => {
    expect(lint({ ...clean(), slides: [{ heading: 'Safe', body: 'A risk-free way to grow money.' }] }))
      .toEqual([expect.objectContaining({ field: 'slides', label: 'return promise' })]);

    expect(lint({ ...clean(), video_script: [{ text: 'This is a multibagger' }] }))
      .toEqual([expect.objectContaining({ field: 'video_script', label: 'recommendation' })]);
  });

  it('scans hashtags and keywords, where violations are easy to overlook', () => {
    expect(lint({ ...clean(), hashtags: [...clean().hashtags, 'sureshot'] }))
      .toEqual([expect.objectContaining({ field: 'hashtags' })]);
  });

  it('every banned pattern is case-insensitive', () => {
    // The lint runs on model output, which capitalises headlines. A pattern
    // without /i would pass "Guaranteed Returns" straight through.
    for (const { re } of BANNED) expect(re.flags).toContain('i');
  });
});

describe('structuralFlags', () => {
  it('accepts exactly one referral placeholder', () => {
    expect(structuralFlags(clean())).toEqual([]);
  });

  it.each([
    ['no caption placeholder', 'Learning where to begin?', '(missing referral link placeholder)'],
    ['two caption placeholders', 'Here: {{REF_LINK}} and {{REF_LINK}}', '(duplicate referral link placeholder)'],
  ])('rejects %s', (_name, caption, phrase) => {
    // The studio's copy button substitutes the reading employee's own link into
    // the placeholder, so the wrong count produces a broken post rather than a
    // non-compliant one — which is why this is structural, not compliance.
    expect(structuralFlags({ ...clean(), caption }))
      .toEqual([expect.objectContaining({ field: 'caption', phrase, label: 'structure' })]);
  });

  it('flags hashtag and keyword counts outside the requested range', () => {
    expect(structuralFlags({ ...clean(), hashtags: ['one', 'two'] }))
      .toEqual([expect.objectContaining({ field: 'hashtags', phrase: '(2 hashtags, expected 8-20)' })]);

    expect(structuralFlags({ ...clean(), seo_keywords: ['a', 'b'] }))
      .toEqual([expect.objectContaining({ field: 'seo_keywords', phrase: '(2 keywords, expected 5-10)' })]);
  });
});

describe('entityLeakageFlags', () => {
  const news = ['Markets rally as HDFC Mutual Fund reports record inflows'];

  it('is inert when no trends were used', () => {
    expect(entityLeakageFlags(clean(), [])).toEqual([]);
  });

  it('passes copy that took the theme without taking the names', () => {
    expect(entityLeakageFlags(clean(), news)).toEqual([]);
  });

  it('catches a fund house name repeated from the news into the copy', () => {
    // The realistic failure is not a dramatic jailbreak — it is the model being
    // helpful and naming the issuer that was in its context, which is a
    // compliance breach under an AMFI registration.
    const flags = entityLeakageFlags({ ...clean(), headline: 'What HDFC Mutual Fund inflows tell us' }, news);
    expect(flags).toEqual([
      expect.objectContaining({ field: 'headline', phrase: 'HDFC Mutual Fund', label: 'entity leaked from news source' }),
    ]);
  });

  it('ignores sentence-initial capitalisation rather than flagging every headline', () => {
    expect(entityLeakageFlags({ ...clean(), body: 'Retail investors are patient.' }, ['Retail Investors Are Patient, Data Shows']))
      .toEqual([]);
  });
});

describe('tagOverlap', () => {
  it('is 1 for identical sets and 0 when either side is empty', () => {
    expect(tagOverlap(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(tagOverlap([], ['a'])).toBe(0);
  });

  it('ignores a leading # and letter case', () => {
    expect(tagOverlap(['#SIP', 'Savings'], ['sip', 'savings'])).toBe(1);
  });

  it('is the Jaccard index, so partial overlap lands below the 0.8 threshold', () => {
    expect(tagOverlap(['a', 'b', 'c'], ['a', 'b', 'd'])).toBeCloseTo(0.5);
  });
});
