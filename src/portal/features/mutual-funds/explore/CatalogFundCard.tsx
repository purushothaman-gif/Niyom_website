import type { CatalogFund } from '../../../types/funds';
import { Card } from '../../../components/Card';
import { AmcAvatar } from '../components/AmcAvatar';
import { fmtRet, retColor, CatalogRiskBadge } from './catalogBits';
import { ret, type ReturnKey } from './collections';

interface Props {
  fund: CatalogFund;
  /** Which period the headline figure shows. */
  period?: ReturnKey;
  /** Staff note, when the card sits on the recommendations shelf. */
  headline?: string | null;
  rationale?: string | null;
  onOpen: () => void;
}

/** Shelf card — one fund, one headline return, tap to research. */
export function CatalogFundCard({ fund, period = '3Y', headline, rationale, onOpen }: Props) {
  const value = ret(fund, period);

  return (
    <Card interactive padding="md" className="h-full">
      <button type="button" onClick={onOpen} className="flex h-full w-full flex-col text-left">
        <div className="flex items-start justify-between gap-2">
          <AmcAvatar amc={fund.amc} size={36} />
          {headline && (
            <span className="rounded-token-sm bg-accent/10 px-2 py-0.5 text-[10px] font-bold text-accent">
              {headline}
            </span>
          )}
        </div>

        <p className="mt-3 line-clamp-2 text-sm font-bold text-text-primary">{fund.name}</p>
        <p className="mt-1 truncate text-[11px] text-text-secondary">
          {fund.category}
          {fund.subCategory ? ` · ${fund.subCategory}` : ''}
        </p>

        {rationale && (
          <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-text-secondary">
            {rationale}
          </p>
        )}

        <div className="mt-auto flex items-end justify-between pt-4">
          <div>
            <p className="font-display text-lg font-bold" style={{ color: retColor(value) }}>
              {fmtRet(value)}
            </p>
            <p className="text-[10px] uppercase tracking-wide text-text-faint">{period} returns</p>
          </div>
          <CatalogRiskBadge risk={fund.risk} />
        </div>
      </button>
    </Card>
  );
}
