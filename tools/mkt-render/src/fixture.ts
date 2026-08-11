// A hand-written draft standing in for generator output.
//
// Written to exercise the parts of the templates that actually break: a
// headline long enough to need wrapping and shrink-to-fit, an en-dash and a
// rupee figure with Indian digit grouping (the glyphs most likely to be missing
// from a fallback font), and slide bodies that push the checklist template's
// vertical rhythm. Bland copy would prove nothing.

import type { ContentSlide, ContentType, VideoScene } from '../../../src/crm/marketing/marketingTypes';

export interface Fixture {
  name: string;
  contentId: string;
  contentType: ContentType;
  category: string;
  templateId: string;
  paletteId: string;
  headline: string;
  body: string;
  cta: string;
  slides: ContentSlide[] | null;
  videoScript: VideoScene[] | null;
}

const HEADLINE = 'Starting ten years earlier can matter more than doubling what you invest';
const BODY = 'Time in the market does the heavy lifting — the earlier the start, the less each instalment has to carry.';
const CTA = 'Learn how compounding works';

export const FIXTURES: Fixture[] = [
  {
    name: 'poster-stat-midnight',
    contentId: 'spike-poster',
    contentType: 'poster',
    category: 'Power of Compounding',
    templateId: 'stat_highlight',
    paletteId: 'midnightGold',
    headline: HEADLINE,
    body: BODY,
    cta: CTA,
    slides: null,
    videoScript: null,
  },
  {
    // The serif template, because Georgia is the one family in the brand stack
    // that cannot be redistributed and therefore the one most likely to be
    // silently substituted on a Linux runner.
    name: 'poster-quote-porcelain',
    contentId: 'spike-quote',
    contentType: 'linkedin_post',
    category: 'Finance Quotes',
    templateId: 'editorial_quote',
    paletteId: 'porcelainInk',
    headline: 'Risk comes from not knowing what you are doing — not from the market moving',
    body: 'Understanding an asset before owning it is the whole of risk management.',
    cta: 'Read the investor basics series',
    slides: null,
    videoScript: null,
  },
  {
    name: 'carousel-checklist-teal',
    contentId: 'spike-carousel',
    contentType: 'carousel',
    category: 'Financial Checklists',
    templateId: 'checklist',
    paletteId: 'tealDeep',
    headline: 'Five things to settle before your first investment',
    body: 'A short checklist to work through in order.',
    cta: 'Start with step one',
    slides: [
      { heading: 'Clear expensive debt', body: 'Anything above roughly 12% a year costs more than most portfolios reliably earn.' },
      { heading: 'Build an emergency fund', body: 'Six months of essential expenses, held somewhere you can reach the same day.' },
      { heading: 'Insure the earner', body: 'Term cover and health cover come before any growth asset, not after.' },
      { heading: 'Name the goal and the date', body: 'A goal without a date cannot be matched to an asset class.' },
      { heading: 'Write down the plan', body: 'The plan you can re-read in a falling market is the one you will actually follow.' },
    ],
    videoScript: null,
  },
  {
    name: 'video-short-indigo',
    contentId: 'spike-video',
    contentType: 'short_video',
    category: 'SIP Concepts',
    templateId: 'bold_statement',
    paletteId: 'indigoNight',
    headline: 'A monthly habit beats a lucky entry',
    body: 'Regular instalments spread your cost across every kind of market.',
    cta: 'Understand how an SIP works',
    slides: null,
    videoScript: [
      { scene: 'hook', text: 'Waiting for the right moment costs more than starting at the wrong one.', duration_seconds: 4 },
      { scene: 'point', text: 'A fixed monthly amount buys more units when prices fall.', duration_seconds: 5 },
      { scene: 'point', text: 'Over years that averages your cost without any timing at all.', duration_seconds: 5 },
      { scene: 'close', text: 'The habit is the strategy.', duration_seconds: 3 },
    ],
  },
];
