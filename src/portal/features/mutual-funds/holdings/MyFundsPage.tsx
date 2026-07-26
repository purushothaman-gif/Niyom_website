import { Compass, Wallet } from 'lucide-react';
import { fmt } from '../../../../crm/utils';
import { Card } from '../../../components/Card';
import { LogoLoader } from '../../../../components/LogoLoader';
import { EmptyState } from '../../../components/EmptyState';
import type { MfHolding } from '../mappers';
import { HoldingFundCard } from './HoldingFundCard';

interface Props {
  holdings: MfHolding[];
  loading: boolean;
  onRedeem: (id: string) => void;
  onSwitch: (id: string) => void;
  onExplore: () => void;
}

export function MyFundsPage({ holdings, loading, onRedeem, onSwitch, onExplore }: Props) {
  if (loading && holdings.length === 0) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LogoLoader size={48} />
      </div>
    );
  }

  if (holdings.length === 0) {
    return (
      <Card>
        <EmptyState icon={Wallet} title="No mutual fund holdings yet." hint="Explore funds to start your first investment." />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onExplore}
            className="mt-4 inline-flex items-center gap-2 rounded-token-md px-4 py-2 text-sm font-bold text-on-accent"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
          >
            <Compass className="h-4 w-4" /> Explore Funds
          </button>
        </div>
      </Card>
    );
  }

  const value = holdings.reduce((s, h) => s + h.value, 0);
  const invested = holdings.reduce((s, h) => s + h.invested, 0);
  const gain = value - invested;
  const gainUp = gain >= 0;

  return (
    <div className="space-y-5">
      <Card padding="md">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-text-secondary">Value</p>
            <p className="mt-0.5 font-display text-lg font-bold text-text-primary">{fmt(value)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-text-secondary">Invested</p>
            <p className="mt-0.5 font-display text-lg font-bold text-text-primary">{fmt(invested)}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-text-secondary">Returns</p>
            <p className="mt-0.5 font-display text-lg font-bold" style={{ color: gainUp ? 'var(--success)' : 'var(--danger)' }}>
              {gainUp ? '+' : ''}{invested > 0 ? ((gain / invested) * 100).toFixed(1) : '0.0'}%
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {holdings.map((h) => (
          <HoldingFundCard
            key={h.id}
            holding={h}
            onRedeem={() => onRedeem(h.id)}
            onSwitch={() => onSwitch(h.id)}
          />
        ))}
      </div>
    </div>
  );
}
