/**
 * Compare 2-3 funds side by side.
 *
 * The same comparison RMs use in the CRM, made available to clients directly.
 * It reads the curated catalog rows already loaded by the module and pulls NAV
 * history per fund from MfCatalogService, so nothing new is fetched until a
 * client actually opens a comparison.
 *
 * COMPLIANCE — this is a client-facing surface showing past performance.
 *
 * The chart is REBASED TO 100, never plotted in rupees. Absolute NAV is not
 * comparable across schemes: a fund at ₹641 is not better than one at ₹118, it
 * is older or was issued at a different price, and a rupee axis would state
 * that falsely and persuasively to someone deciding where to put money. The
 * caption and axis both say the units are index points.
 *
 * "Best" marks only the single highest figure in one row and says so in words.
 * Ties mark neither, so the screen cannot manufacture a winner. Nothing here
 * ranks funds overall or suggests which suits the reader — a distributor may
 * inform, not advise.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { Card } from '../../../components/Card';
import { Segmented } from '../../../components/Segmented';
import { MfCatalogService } from '../../../services/MfCatalogService';
import type { CatalogFund, CatalogNavPoint } from '../../../types/funds';
import {
  COMPARE_COLOURS, NAV_RANGES, buildNavSeries, navCompareSvg, type NavRange,
} from '../../../../lib/funds/navChart';

interface Props {
  funds: CatalogFund[];
  onBack: () => void;
  onRemove: (amfiCode: string) => void;
  onOpenFund: (amfiCode: string) => void;
}

const pct = (v: number | null) =>
  v === null || Number.isNaN(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

const toneClass = (v: number | null) =>
  v === null || Number.isNaN(v) ? 'text-text-secondary' : v < 0 ? 'text-danger' : 'text-success';

export function FundComparePage({ funds, onBack, onRemove, onOpenFund }: Props) {
  const [range, setRange] = useState<NavRange>('3Y');
  const [histories, setHistories] = useState<Record<string, CatalogNavPoint[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all(
      funds.map((f) =>
        MfCatalogService.detail(f.amfiCode)
          .then((d) => [f.amfiCode, d.navHistory] as const)
          // One fund's history failing must not blank the whole comparison —
          // the table still stands on catalog data.
          .catch(() => [f.amfiCode, [] as CatalogNavPoint[]] as const),
      ),
    ).then((pairs) => {
      if (!alive) return;
      setHistories(Object.fromEntries(pairs));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [funds]);

  const chartSeries = useMemo(
    () =>
      funds.map((f, i) => ({
        label: f.name,
        colour: COMPARE_COLOURS[i % COMPARE_COLOURS.length],
        series: buildNavSeries(histories[f.amfiCode] ?? [], range),
      })),
    [funds, histories, range],
  );

  const periods: { key: keyof CatalogFund['returns']; label: string }[] = [
    { key: '6M', label: '6 months' },
    { key: '1Y', label: '1 year' },
    { key: '3Y', label: '3 years' },
    { key: '5Y', label: '5 years' },
    { key: 'SI', label: 'Since launch' },
  ];

  /** Highest figure in the row, or null when two or more tie. */
  const bestOf = (key: keyof CatalogFund['returns']): string | null => {
    const vals = funds
      .map((f) => ({ code: f.amfiCode, v: f.returns[key] }))
      .filter((x): x is { code: string; v: number } => x.v !== null && !Number.isNaN(x.v));
    if (vals.length < 2) return null;
    const max = Math.max(...vals.map((v) => v.v));
    const leaders = vals.filter((v) => v.v === max);
    return leaders.length === 1 ? leaders[0].code : null;
  };

  const facts: { label: string; get: (f: CatalogFund) => string }[] = [
    { label: 'NAV', get: (f) => (f.nav === null ? '—' : `₹${f.nav.toFixed(2)}`) },
    { label: 'Category', get: (f) => f.subCategory || f.category },
    { label: 'Risk', get: (f) => f.risk ?? '—' },
    {
      label: 'Minimum',
      get: (f) => (f.minInvestment === null ? '—' : `₹${f.minInvestment.toLocaleString('en-IN')}`),
    },
  ];

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div>
        <h1 className="text-xl font-bold text-text-primary">Comparing {funds.length} funds</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Growth of ₹100 invested at the start of the period, and the figures side by side.
        </p>
      </div>

      <Card padding="md">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold uppercase tracking-wider text-text-secondary">
            Growth of ₹100
          </p>
          <Segmented<NavRange>
            options={NAV_RANGES.map((r) => ({ value: r.id, label: r.label }))}
            value={range}
            onChange={setRange}
            size="sm"
          />
        </div>

        {loading ? (
          <p className="py-12 text-center text-sm text-text-secondary">Loading NAV history…</p>
        ) : (
          <>
            {/* Same renderer the CRM uses. Every value in the markup is a number
                this module formatted — never API or user text. */}
            <svg
              viewBox="0 0 900 320"
              width="100%"
              height="270"
              dangerouslySetInnerHTML={{
                __html: navCompareSvg(chartSeries, {
                  width: 900,
                  height: 320,
                  uid: 'pcmp',
                  axis: 'currentColor',
                  label: 'currentColor',
                  fontFamily: 'inherit',
                }),
              }}
              className="text-border"
            />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {chartSeries.map((s) => (
                <span key={s.label} className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.colour }} />
                  {s.label}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-text-secondary">
              Each line is rebased to 100 at the start of the window so the schemes are
              comparable — the axis is index points, not rupees. NAV levels differ by how
              long a scheme has run and what it was issued at, not by quality.
            </p>
          </>
        )}
      </Card>

      <Card padding="none" className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th className="p-3 text-left text-xs font-semibold text-text-secondary">&nbsp;</th>
              {funds.map((f, i) => (
                <th key={f.amfiCode} className="border-l border-border p-3 text-left align-top">
                  <span className="flex items-start gap-1.5">
                    <span
                      className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ background: COMPARE_COLOURS[i % COMPARE_COLOURS.length] }}
                    />
                    <button
                      type="button"
                      onClick={() => onOpenFund(f.amfiCode)}
                      className="text-left"
                    >
                      <span className="block text-xs font-bold leading-snug text-text-primary">
                        {f.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-text-secondary">{f.amc}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(f.amfiCode)}
                      aria-label={`Remove ${f.name} from comparison`}
                      className="ml-auto flex-shrink-0 text-text-secondary hover:text-text-primary"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const best = bestOf(p.key);
              return (
                <tr key={p.key} className="border-t border-border">
                  <td className="p-3 text-xs text-text-secondary">{p.label}</td>
                  {funds.map((f) => (
                    <td
                      key={f.amfiCode}
                      className={`border-l border-border p-3 font-bold ${toneClass(f.returns[p.key])}`}
                    >
                      {pct(f.returns[p.key])}
                      {best === f.amfiCode && (
                        <span className="ml-1.5 text-xs font-semibold text-text-secondary">best</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {facts.map((r) => (
              <tr key={r.label} className="border-t border-border">
                <td className="p-3 text-xs text-text-secondary">{r.label}</td>
                {funds.map((f) => (
                  <td
                    key={f.amfiCode}
                    className="border-l border-border p-3 font-semibold text-text-primary"
                  >
                    {r.get(f)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-text-secondary">
        “Best” marks only the highest figure in that row over that one period. It is not a
        view on which fund suits you. Mutual Fund investments are subject to market risks;
        read all scheme related documents carefully. Past performance is not indicative of
        future returns.
      </p>
    </div>
  );
}
