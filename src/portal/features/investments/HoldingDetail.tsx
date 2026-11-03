import type { ReactNode } from 'react';
import { MousePointerClick, X } from 'lucide-react';
import { inr } from '../../../lib/money';
import { ASSET_META, type InvestmentRow } from '../../../../shared/portal/investments/model';
import { price, shortDay, signedInr, signedPct, toneOf, units } from './format';

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-right text-sm font-semibold tabular-nums text-text-primary">{children}</span>
    </div>
  );
}

/** Groww-style right pane: the selected holding, or a prompt to pick one. */
export function HoldingDetail({
  row,
  onClose,
  action,
}: {
  row: InvestmentRow | null;
  onClose?: () => void;
  /** e.g. "Invest more" for mutual funds, rendered under the figures. */
  action?: ReactNode;
}) {
  if (!row) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="relative mb-5 w-36">
          <div className="h-7 rounded-token-md border border-border bg-bg-surface" />
          <div className="my-2 h-8 rounded-token-md border border-accent/40 bg-accent/15" />
          <div className="h-7 rounded-token-md border border-border bg-bg-surface" />
          <MousePointerClick className="absolute -right-3 top-9 h-5 w-5 text-accent" />
        </div>
        <p className="text-sm font-semibold text-text-primary">Select a holding to view its details</p>
        <p className="mt-1 text-xs text-text-faint">Units, prices, returns and key dates</p>
      </div>
    );
  }

  const meta = ASSET_META[row.asset];
  const returnsUnknown = row.invested == null;

  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ background: `${meta.color}22`, color: meta.color }}
          >
            {meta.label}
          </span>
          <h3 className="mt-2 font-display text-base font-bold leading-snug text-text-primary">{row.name}</h3>
          {row.sub && <p className="mt-0.5 text-xs text-text-secondary">{row.sub}</p>}
          {row.category && <p className="mt-0.5 text-xs text-text-faint">{row.category}</p>}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-token-md p-1 text-text-secondary hover:bg-hover hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="mt-5 rounded-token-lg bg-bg-surface p-4">
        <p className="text-[11px] text-text-secondary">Current value</p>
        <p className="mt-0.5 font-display text-2xl font-bold tabular-nums text-text-primary">{inr(row.value)}</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-text-secondary">Invested</p>
            <p className="text-sm font-semibold tabular-nums text-text-primary">
              {returnsUnknown ? '—' : inr(row.invested ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-text-secondary">Total returns</p>
            <p className={`text-sm font-semibold tabular-nums ${toneOf(row.gain)}`}>
              {returnsUnknown ? '—' : `${signedInr(row.gain ?? 0)} (${signedPct(row.gainPct)})`}
            </p>
          </div>
        </div>
        {row.dayChange != null && (
          <p className="mt-3 border-t border-border-subtle pt-3 text-xs text-text-secondary">
            1D change{' '}
            <span className={`font-semibold tabular-nums ${toneOf(row.dayChange)}`}>
              {signedInr(row.dayChange)} ({signedPct(row.dayChangePct)})
            </span>
          </p>
        )}
      </div>

      <div className="mt-4 divide-y divide-border-subtle">
        {row.asset === 'mutual_fund' && (
          <>
            <Line label="Units">{units(row.units)}</Line>
            <Line label={row.navDate ? `NAV · ${shortDay(row.navDate)}` : 'NAV'}>{price(row.price)}</Line>
            {row.avgPrice != null && <Line label="Avg. NAV">{price(row.avgPrice)}</Line>}
            {row.fundReturn1y != null && (
              <Line label="Fund return · 1Y">
                <span className={toneOf(row.fundReturn1y)}>{signedPct(row.fundReturn1y, 1)}</span>
              </Line>
            )}
            {row.fundReturn3y != null && (
              <Line label="Fund return · 3Y (p.a.)">
                <span className={toneOf(row.fundReturn3y)}>{signedPct(row.fundReturn3y, 1)}</span>
              </Line>
            )}
            {row.folio && <Line label="Folio">{row.folio}</Line>}
            {row.amc && <Line label="AMC">{row.amc}</Line>}
          </>
        )}
        {row.asset === 'bond' && (
          <>
            {row.coupon != null && <Line label="Coupon">{row.coupon}% p.a.</Line>}
            {row.payoutFrequency && <Line label="Interest payout">{row.payoutFrequency}</Line>}
            {row.nextPayout && <Line label="Next payout">{shortDay(row.nextPayout)}</Line>}
            {row.maturity && <Line label="Maturity">{shortDay(row.maturity)}</Line>}
            <Line label="Units">{units(row.units)}</Line>
            {row.avgPrice != null && <Line label="Avg. price">{price(row.avgPrice)}</Line>}
            {row.faceValue != null && row.faceValue > 0 && <Line label="Face value">{price(row.faceValue)}</Line>}
            {row.isin && <Line label="ISIN">{row.isin}</Line>}
          </>
        )}
        {row.asset === 'unlisted_share' && (
          <>
            <Line label="Quantity">{units(row.units)}</Line>
            {row.avgPrice != null && <Line label="Avg. buy price">{price(row.avgPrice)}</Line>}
            <Line label="Current price">{price(row.price)}</Line>
          </>
        )}
        {row.asset === 'other' && (
          <>
            {row.units != null && <Line label="Units">{units(row.units)}</Line>}
            {row.issuer && <Line label="Issuer">{row.issuer}</Line>}
            {row.maturity && <Line label="Maturity">{shortDay(row.maturity)}</Line>}
          </>
        )}
      </div>

      {returnsUnknown && (
        <p className="mt-4 rounded-token-md border border-border-subtle bg-bg-surface px-3 py-2.5 text-[11px] leading-relaxed text-text-secondary">
          Value and units come straight from the registrar (CAMS/KFintech), updated daily. The registrar
          does not report purchase cost, so returns will appear once your purchase history is on file.
        </p>
      )}

      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
