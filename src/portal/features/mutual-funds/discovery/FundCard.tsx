import { fmt } from '../../../../crm/utils';
import { Card } from '../../../components/Card';
import type { FundScheme } from '../../../types/funds';
import { AmcAvatar } from '../components/AmcAvatar';
import { RatingStars } from '../components/RatingStars';
import { RiskBadge } from '../components/RiskBadge';
import { ReturnsRow } from '../components/ReturnsRow';

interface FundCardProps {
  scheme: FundScheme;
  onOpen: () => void;
  onInvest: () => void;
}

/** Discovery card — click the body to research, or invest straight away. */
export function FundCard({ scheme, onOpen, onInvest }: FundCardProps) {
  return (
    <Card interactive padding="md" className="flex flex-col">
      <button type="button" onClick={onOpen} className="flex-1 text-left">
        <div className="flex items-start gap-3">
          <AmcAvatar amc={scheme.amc} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-text-primary">{scheme.name}</p>
            <p className="mt-0.5 truncate text-[11px] text-text-secondary">
              {scheme.category} · {scheme.subCategory}
            </p>
            {scheme.rating > 0 && (
              <div className="mt-1">
                <RatingStars rating={scheme.rating} />
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-end justify-between">
          <ReturnsRow returns={scheme.returns} only={['1Y', '3Y', '5Y']} size="sm" />
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-text-faint">NAV</p>
            <p className="text-sm font-bold text-text-primary">
              {scheme.nav > 0 ? `₹${scheme.nav.toFixed(2)}` : '—'}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
          <RiskBadge risk={scheme.riskLevel} />
          {scheme.aum > 0 && (
            <p className="text-[11px] text-text-secondary">
              AUM <span className="font-semibold text-text-primary">{fmt(scheme.aum * 1e7)}</span>
            </p>
          )}
        </div>
      </button>

      <button
        type="button"
        onClick={onInvest}
        className="mt-4 w-full rounded-token-md py-2.5 text-sm font-bold text-on-accent transition-opacity hover:opacity-90"
        style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
      >
        Invest
      </button>
    </Card>
  );
}
