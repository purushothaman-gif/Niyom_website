/**
 * The script. Single source of truth for what is said, what is captioned, and
 * which scenes appear in which cut.
 *
 * Durations are NOT set here — each scene runs for as long as its narration
 * takes (plus a small tail), measured from the generated audio. Writing timings
 * by hand is how picture and voice drift apart.
 */

export type SceneKind = 'motion' | 'ui';

export interface Scene {
  id: string;
  kind: SceneKind;
  /** Spoken. Punctuation matters — `say` honours commas and full stops. */
  vo: string;
  /** Burned into the picture. Kept short; it is read, not studied. */
  caption: string;
  /** Motion scenes only: the big type on the card. */
  title?: string;
  subtitle?: string;
  /** Frames showing money carry the illustrative notice. */
  illustrative?: boolean;
  /** Seconds of picture held after the narration ends, so cuts do not clip. */
  tail?: number;
  /** Which cuts include this scene. */
  cuts: Array<'landscape' | 'vertical'>;
}

const BOTH: Array<'landscape' | 'vertical'> = ['landscape', 'vertical'];
const LONG: Array<'landscape' | 'vertical'> = ['landscape'];

export const SCENES: Scene[] = [
  {
    id: 'title',
    kind: 'motion',
    title: 'Partner Portal',
    subtitle: 'Your clients, your products, your payouts',
    vo: 'This is the Niyom Wealth Partner Portal. Your clients, your products, and your payouts, in one place.',
    caption: 'Niyom Wealth — Partner Portal',
    tail: 0.6,
    cuts: BOTH,
  },
  {
    id: 'login',
    kind: 'ui',
    vo: 'Sign in with your PAN number. Set a four digit PIN once, and you are straight in every time after that.',
    caption: 'Sign in with your PAN',
    tail: 0.5,
    cuts: LONG,
  },
  {
    id: 'dashboard',
    kind: 'ui',
    vo: 'Your dashboard opens on the numbers that matter. What you have raised this financial year, what has been paid, what is still due, and the clients you have brought in.',
    caption: 'Everything you have earned, at a glance',
    illustrative: true,
    tail: 0.8,
    cuts: BOTH,
  },
  {
    id: 'onboard',
    kind: 'ui',
    vo: 'Onboard a client yourself. Verify their PAN, add their details, and they are mapped under you and your relationship manager in seconds. The PAN check runs live, and your relationship manager completes the K Y C from there.',
    caption: 'Onboard your own clients',
    tail: 0.8,
    cuts: LONG,
  },
  {
    id: 'clients',
    kind: 'ui',
    vo: 'Open any client to see the portfolio you built. Every holding, every transaction, valued as of today.',
    caption: 'See every client portfolio you built',
    illustrative: true,
    tail: 0.6,
    cuts: LONG,
  },
  {
    id: 'bonds',
    kind: 'ui',
    vo: 'The bond desk is priced for you. Set your own markup, up to five percent. Your cost is never shown to your client.',
    caption: 'Set your own markup — up to 5%',
    tail: 0.6,
    cuts: BOTH,
  },
  {
    id: 'bond-actions',
    kind: 'ui',
    vo: 'Order for a client, share a private link, or download a marketing image, with your name and number on it, and Niyom branding switched off if you prefer, so it goes out entirely under your own brand.',
    caption: 'Order · Share · Market — under your own name',
    tail: 0.8,
    cuts: BOTH,
  },
  {
    id: 'payouts',
    kind: 'ui',
    vo: 'Every payout statement, with gross, T D S and net payable, ready to download. Nothing to chase, nothing to reconcile.',
    caption: 'Payout statements, always available',
    illustrative: true,
    tail: 0.7,
    cuts: BOTH,
  },
  {
    id: 'referral',
    kind: 'ui',
    vo: 'Share your referral link, and anyone who opens an account through it is recorded against you automatically.',
    caption: 'Your referral link, tracked automatically',
    tail: 0.6,
    cuts: LONG,
  },
  {
    id: 'cta',
    kind: 'motion',
    title: 'Become a partner',
    subtitle: 'niyomwealth.com/partner-onboarding',
    vo: 'Become a Niyom Wealth partner. Register today at niyom wealth dot com, slash partner onboarding.',
    caption: 'Register in a few minutes',
    tail: 1.2,
    cuts: BOTH,
  },
];

export function scenesFor(cut: 'landscape' | 'vertical'): Scene[] {
  return SCENES.filter((s) => s.cuts.includes(cut));
}
