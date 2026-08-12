/**
 * Advisory ownership of a mutual fund holding — "is this advised by us?"
 *
 * The single source of truth for these states AND their wording. Nothing else
 * in the app should spell out "Held with Niyom" or "Held away": a label change
 * (or a translation) has to be a one-line edit here, not a search across
 * components.
 *
 * ## Why there are three states and not two
 *
 * A CAS attributes each holding to an ARN or RIA code, and `cas_schemes.is_ours`
 * is true when that code is ours. But `is_ours` is a plain boolean, and false
 * means two very different things:
 *
 *   the statement names someone else's ARN   -> genuinely held away
 *   the statement names no ARN at all        -> we simply do not know
 *
 * A **Summary** CAS carries no advisor code for any holding, so collapsing this
 * to a boolean would label a client's entire portfolio "Held away" on no
 * evidence whatsoever — and a future migration wizard would then offer to move
 * folios that may already be ours. `unknown` keeps that claim unmade.
 */

export const MF_OWNERSHIP = {
  /** The statement attributes this holding to our ARN. */
  heldWithNiyom: 'held_with_niyom',
  /** The statement attributes it to a different ARN or RIA. */
  heldAway: 'held_away',
  /** No advisor code was stated — a summary CAS, or a manually held record. */
  unknown: 'unknown',
} as const;

export type MfOwnership = (typeof MF_OWNERSHIP)[keyof typeof MF_OWNERSHIP];

export interface OwnershipPresentation {
  label: string;
  /** Maps to StatusPill's tones. Held away is NEUTRAL on purpose — see below. */
  tone: 'success' | 'muted';
  /** Longer explanation, surfaced as a title attribute. */
  hint: string;
}

/**
 * How each state is shown.
 *
 * Held away is deliberately styled as neutral information, never as a warning.
 * It is normal and unremarkable for an investor to hold funds bought elsewhere,
 * and colouring it as a problem would turn a factual badge into a sales prompt
 * on a screen the client opens to check their own money.
 */
export const MF_OWNERSHIP_PRESENTATION: Record<MfOwnership, OwnershipPresentation> = {
  [MF_OWNERSHIP.heldWithNiyom]: {
    label: 'Held with Niyom',
    tone: 'success',
    hint: 'Your statement lists this holding under our ARN, so we advise on it.',
  },
  [MF_OWNERSHIP.heldAway]: {
    label: 'Held away',
    tone: 'muted',
    hint: 'Your statement lists this holding under a different distributor. You still see it here in full.',
  },
  [MF_OWNERSHIP.unknown]: {
    label: 'Advisor not stated',
    tone: 'muted',
    hint: 'A summary statement does not name the advisor. Import a detailed CAS to confirm who this holding sits with.',
  },
};

/**
 * Decide ownership from what the statement actually said.
 *
 * `advisorCode` absent is the "we do not know" case and must not fall through
 * to held-away — see the note at the top of this file.
 */
export function ownershipOf(
  advisorCode: string | null | undefined,
  isOurs: boolean | null | undefined,
): MfOwnership {
  if (!advisorCode || !advisorCode.trim()) return MF_OWNERSHIP.unknown;
  return isOurs ? MF_OWNERSHIP.heldWithNiyom : MF_OWNERSHIP.heldAway;
}
