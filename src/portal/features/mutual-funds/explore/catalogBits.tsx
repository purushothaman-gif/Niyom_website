/**
 * Small shared pieces for the Explore screens, so a return renders identically
 * on a card, in a table and on the fund page. Nothing here has state.
 */
import type { CatalogFund } from '../../../types/funds';
import { AmcAvatar } from '../components/AmcAvatar';

/** A return, or an em dash when the fund has no history for that period. */
export const fmtRet = (v: number | null): string =>
  v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

export const retColor = (v: number | null): string =>
  v === null ? 'var(--text-faint)' : v > 0 ? 'var(--success)' : v < 0 ? 'var(--danger)' : 'var(--text-muted)';

export const fmtNav = (v: number | null): string =>
  v === null ? '—' : `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** House risk view from the curated table — three levels, not the SEBI six. */
export function CatalogRiskBadge({ risk }: { risk: string | null }) {
  if (!risk) return null;
  const tone =
    risk === 'Low' ? 'var(--success)' : risk === 'High' ? 'var(--danger)' : 'var(--warning)';
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}
    >
      {risk} risk
    </span>
  );
}

/** Category chips as they appear under a fund name. */
export function FundTags({ fund }: { fund: CatalogFund }) {
  const tags = [fund.category, fund.subCategory].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span
          key={t}
          className="rounded-token-sm border border-border bg-bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary"
        >
          {t}
        </span>
      ))}
      <CatalogRiskBadge risk={fund.risk} />
    </div>
  );
}

/** Avatar + name + category line — the fund's identity block in lists. */
export function FundIdentity({ fund, compact = false }: { fund: CatalogFund; compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AmcAvatar amc={fund.amc} size={compact ? 32 : 40} />
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-text-primary">{fund.name}</p>
        <p className="mt-0.5 truncate text-[11px] text-text-secondary">
          {fund.category}
          {fund.subCategory ? ` · ${fund.subCategory}` : ''}
        </p>
      </div>
    </div>
  );
}

/**
 * The provenance line that has to sit under any performance we show.
 *
 * The catalog is built from the REGULAR plan of each scheme — the plan a client
 * actually buys through an ARN distributor — so these figures are the ones they
 * could have earned, not the flattering Direct-plan numbers we used to show.
 */
export const RETURNS_FOOTNOTE =
  'Returns are annualised for periods over a year and computed from AMFI NAV history for the Regular plan of each scheme. Past performance does not indicate future results.';
