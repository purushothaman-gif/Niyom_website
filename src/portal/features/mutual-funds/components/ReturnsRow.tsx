import type { FundReturns } from '../../../types/funds';

const PERIODS: Array<keyof FundReturns> = ['1M', '6M', '1Y', '3Y', '5Y'];

function color(v: number | null): string {
  if (v === null) return 'var(--text-faint)';
  return v >= 0 ? 'var(--success)' : 'var(--danger)';
}

/** Trailing-returns strip. `only` restricts to a subset (e.g. cards show 1Y/3Y). */
export function ReturnsRow({
  returns,
  only,
  size = 'md',
}: {
  returns: FundReturns;
  only?: Array<keyof FundReturns>;
  size?: 'sm' | 'md';
}) {
  const periods = only ?? PERIODS;
  const valueCls = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div className="flex gap-4">
      {periods.map((p) => (
        <div key={p}>
          <p className="text-[10px] uppercase tracking-wide text-text-faint">{p}</p>
          <p className={`font-semibold ${valueCls}`} style={{ color: color(returns[p]) }}>
            {returns[p] === null
              ? '—'
              : `${returns[p]! >= 0 ? '+' : ''}${returns[p]!.toFixed(1)}%`}
          </p>
        </div>
      ))}
    </div>
  );
}
