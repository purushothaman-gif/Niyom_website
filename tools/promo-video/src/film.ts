/**
 * A film: what is said, what happens on screen, and how to get into the product
 * that is being filmed. Everything downstream — narration, capture, assembly,
 * the script document — is parameterised by one of these.
 */
import type { Page } from 'playwright';
import type { Act } from './stage.js';

export type CutKey = 'landscape' | 'vertical';
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
  cuts: CutKey[];
  /**
   * Run before the recorder attaches — navigation, scrolling into position,
   * anything that should not appear in the shot.
   */
  setup?: (page: Page) => Promise<void>;
}

export interface Film {
  key: string;
  /** Output basename: niyom-<slug>-16x9-1080p.mp4 */
  slug: string;
  /** Eyebrow on the title card. */
  eyebrow: string;
  /** Where the film starts, signed out. */
  loginPath: string;
  /** Demo credentials. */
  pan: string;
  password: string;
  /** Text that proves we are inside the product, for the unrecorded sign-in. */
  signedInMarker: string;
  /** Sign in without filming it, for cuts that skip the login scene. */
  signIn: (page: Page) => Promise<void>;
  scenes: Scene[];
  acts: Record<string, Act>;
}

export const BOTH: CutKey[] = ['landscape', 'vertical'];
export const LONG: CutKey[] = ['landscape'];

export function scenesFor(film: Film, cut: CutKey): Scene[] {
  return film.scenes.filter((s) => s.cuts.includes(cut));
}
