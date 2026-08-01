import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { CatalogFund } from '../../../types/funds';
import { FundTable } from './FundTable';
import { fundsIn, type FundCollection, type ReturnKey } from './collections';

interface Props {
  collection: FundCollection;
  funds: CatalogFund[];
  onBack: () => void;
  onOpenFund: (amfiCode: string) => void;
}

/** One collection, listed. Sorting is the only control — the set is the point. */
export function CollectionPage({ collection, funds, onBack, onOpenFund }: Props) {
  const [sortBy, setSortBy] = useState<ReturnKey>('3Y');
  const rows = fundsIn(collection, funds);
  const Icon = collection.icon;

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" /> Explore
      </button>

      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-token-lg bg-accent/10">
          <Icon className="h-5 w-5 text-accent" />
        </span>
        <div>
          <h2 className="font-display text-xl font-bold text-text-primary">{collection.label}</h2>
          <p className="mt-0.5 text-xs text-text-secondary">{collection.blurb}</p>
        </div>
      </div>

      <FundTable funds={rows} sortBy={sortBy} onSort={setSortBy} onOpen={onOpenFund} />
    </div>
  );
}
