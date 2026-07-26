import { Landmark, ArrowRight } from 'lucide-react';
import type { NWClient } from '../../../../crm/types';
import { activatableProducts, ACTIVATABLE_PRODUCTS } from '../../onboarding/onboardingSteps';

interface Props {
  client: NWClient | null;
  onActivate: () => void;
}

/**
 * Dashboard prompt for an active client who hasn't enabled Bonds / Unlisted
 * Shares yet. Opens the activation modal (demat BO ID + CML). Hidden entirely
 * once both products are enabled.
 */
export function ActivateProductsCard({ client, onActivate }: Props) {
  const canAdd = activatableProducts(client);
  if (canAdd.length === 0) return null;
  const names = canAdd.map((v) => ACTIVATABLE_PRODUCTS.find((p) => p.value === v)?.label ?? v);

  return (
    <button
      onClick={onActivate}
      className="lift group flex w-full items-center gap-4 rounded-token-xl border border-accent/25 bg-accent/[0.06] p-4 text-left shadow-token-card transition-colors hover:border-accent/50"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-token-lg bg-accent/12">
        <Landmark className="h-5 w-5 text-accent" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-text-primary">
          Want to invest in {names.join(' & ')}?
        </span>
        <span className="mt-0.5 block text-xs text-text-muted">
          Enable {names.length > 1 ? 'them' : 'it'} in a minute — add your demat (BO ID) and upload a Demat proof (CML).
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-accent transition-transform duration-200 group-hover:translate-x-1" />
    </button>
  );
}
