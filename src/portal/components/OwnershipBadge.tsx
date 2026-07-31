import { CheckCircle2, Circle, HelpCircle } from 'lucide-react';
import { StatusPill } from './StatusPill';
import {
  MF_OWNERSHIP,
  MF_OWNERSHIP_PRESENTATION,
  type MfOwnership,
} from '../types/ownership';

const ICON = {
  [MF_OWNERSHIP.heldWithNiyom]: CheckCircle2,
  [MF_OWNERSHIP.heldAway]: Circle,
  [MF_OWNERSHIP.unknown]: HelpCircle,
} as const;

/**
 * Whether a mutual fund holding is advised by us.
 *
 * Purely informational. "Held away" is styled exactly as neutrally as any other
 * metadata on the row, because it is a fact about where a folio sits and not a
 * problem the client needs to act on — a client opening their portfolio to
 * check their money should not find a warning colour waiting for them.
 *
 * All wording comes from MF_OWNERSHIP_PRESENTATION so it is changed in one
 * place; this component only decides how it looks.
 */
export function OwnershipBadge({
  ownership,
  className = '',
}: {
  ownership?: MfOwnership;
  className?: string;
}) {
  // Everything except a statement-sourced mutual fund: no badge at all rather
  // than an empty or speculative one.
  if (!ownership) return null;

  const { label, tone, hint } = MF_OWNERSHIP_PRESENTATION[ownership];
  const Icon = ICON[ownership];

  return (
    <span title={hint} className={className}>
      <StatusPill tone={tone}>
        <Icon className="h-3 w-3" />
        {label}
      </StatusPill>
    </span>
  );
}
