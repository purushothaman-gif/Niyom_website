import { useMemo, type ReactNode } from 'react';
import { Wallet } from 'lucide-react';
import type { PortalHolding } from '../types/cas';
import { fromClientHoldings, type AssetKey } from '../../../shared/portal/investments/model';
import { InvestmentsBoard } from '../features/investments/InvestmentsBoard';
import { useInvestmentRows } from '../features/investments/useInvestmentRows';

/**
 * The one sub-navigation every product uses (Explore · Holdings · Orders …),
 * underline-style as on Groww, so learning one product teaches them all.
 */
export function ProductTabs<T extends string>({
  tabs,
  value,
  onChange,
  action,
}: {
  tabs: Array<{ key: T; label: string; count?: number }>;
  value: T;
  onChange: (key: T) => void;
  /** Right-aligned content, e.g. an Invest button. */
  action?: ReactNode;
}) {
  return (
    <div className="-mt-1 flex items-center justify-between gap-3 border-b border-border">
      <nav className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const on = t.key === value;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange(t.key)}
              className={`relative shrink-0 px-4 pb-3 pt-1 text-[15px] font-semibold transition-colors ${
                on ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t.label}
              {t.count ? <span className="ml-1.5 text-xs font-medium text-text-faint">{t.count}</span> : null}
              {on && <span className="absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-accent" />}
            </button>
          );
        })}
      </nav>
      {action && <div className="hidden shrink-0 pb-2 sm:block">{action}</div>}
    </div>
  );
}

/** A product's Holdings tab: the portfolio board locked to that asset. */
export function ProductHoldings({
  holdings,
  asset,
  title,
  onExplore,
}: {
  holdings: PortalHolding[];
  asset: AssetKey;
  title: string;
  onExplore: () => void;
}) {
  const base = useMemo(() => fromClientHoldings(holdings).filter((r) => r.asset === asset), [holdings, asset]);
  const { rows, enriching } = useInvestmentRows('client', base);
  return (
    <InvestmentsBoard
      rows={rows}
      enriching={enriching}
      title={title}
      lockedAsset={asset}
      emptyState={
        <div className="px-6 py-14 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
            <Wallet className="h-7 w-7 text-accent" />
          </span>
          <p className="mt-4 font-display text-base font-bold text-text-primary">No {title.toLowerCase()} yet</p>
          <p className="mt-1 text-sm text-text-secondary">What you buy here appears in this tab once it settles.</p>
          <button
            type="button"
            onClick={onExplore}
            className="mt-5 rounded-token-md bg-accent px-5 py-2.5 text-sm font-bold text-on-accent hover:bg-accent-strong"
          >
            Explore
          </button>
        </div>
      }
    />
  );
}
