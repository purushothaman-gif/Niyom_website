/**
 * Statement-sourced holding metadata.
 *
 * ## Why this rides alongside NWHolding rather than inside it
 *
 * `NWHolding` is the CRM's row shape, shared with staff screens that know
 * nothing about statements. Widening it with CAS columns would push a portal
 * concern into the console's type and force every consumer to reason about
 * fields that are null for four of the five asset classes.
 *
 * So `PortalHolding` extends it with one optional block. Everything that
 * already consumed `NWHolding` keeps working untouched — the extension is
 * additive and the block's absence means "not from a statement".
 *
 * ## What it is for
 *
 * Two things beyond display. The `ownership` state drives the held-with-us /
 * held-away badge, and the rest is the handle a future ARN migration wizard
 * needs: enough to identify a folio, name its current distributor and act on
 * it WITHOUT re-parsing the client's CAS. `schemeId` is the stable key —
 * cas_schemes.id — so a migration record can point at an exact row rather than
 * trying to re-match on scheme name, which changes when a fund is renamed or
 * merged.
 */
import type { NWHolding } from '../../crm/types';
import type { MfOwnership } from './ownership';

export interface CasHoldingMeta {
  /** Where this came from. Only 'cas' today; named so a second source can join. */
  source: 'cas';
  /** cas_imports.id — which statement stated this. */
  importId: string;
  /** When we read that statement in. */
  importedAt: string;
  /** The date the statement was drawn up to; these figures are as of then. */
  statementTo: string | null;

  /** cas_schemes.id — the stable handle for a migration record. */
  schemeId: string;
  isin: string | null;
  /** Registrar scheme code, e.g. "K144D". */
  rtaCode: string | null;
  schemeName: string;
  amc: string | null;
  folioNumber: string;
  /** CAMS | KFINTECH */
  registrar: string | null;

  units: number;
  value: number;
  cost: number;
  navDate: string | null;

  /** The ARN/RIA code the statement attributes this holding to, verbatim. */
  advisorCode: string | null;
  /** cas_schemes.is_ours — the generated ARN-362707 match. */
  isOurs: boolean;
  /** Derived from the two above; see types/ownership.ts for why it is 3-valued. */
  ownership: MfOwnership;
}

/** An NWHolding that may carry the statement it came from. */
export interface PortalHolding extends NWHolding {
  cas?: CasHoldingMeta;
}

/**
 * How current the imported mutual fund picture is.
 *
 * `none`    no reconciled statement — nothing to date or warn about.
 * `current` nothing has happened with us since the statement was drawn up.
 * `stale`   we have recorded mutual fund activity AFTER the statement date, so
 *           the imported holdings are known to be behind.
 */
export type CasFreshnessState = 'none' | 'current' | 'stale';

export interface CasFreshness {
  state: CasFreshnessState;
  statementTo: string | null;
  /** The most recent mutual fund transaction WE recorded, if any. */
  latestOwnMfTxnDate: string | null;
}

/**
 * Freshness wording, kept here rather than in the component for the same reason
 * as the ownership labels: one place to change the copy.
 *
 * `current` takes the statement date; the others are fixed.
 */
export const CAS_FRESHNESS_COPY = {
  current: (statementDate: string) => `Portfolio updated as of ${statementDate}`,
  stale:
    'Your portfolio contains transactions after this CAS statement. Import a newer CAS to view the latest mutual fund holdings.',
  /** Shown after the client dismisses the warning — the date, without the nag. */
  staleDismissed: (statementDate: string) => `Mutual funds as per your statement of ${statementDate}`,
} as const;
