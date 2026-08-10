// Marketing Tools -> Mutual Funds.
//
// The same curated catalog the client portal shows, surfaced for employees so
// they can look a fund up before talking to a client, compare a shortlist, and
// export a factsheet image to send.
//
// Structured like the portal's Explore rather than as one flat list: a client
// asks "what kind of fund", not "show me all 36". Top performers, collections
// and fund houses are the same entry points they will see in their own portal,
// so an employee and a client are navigating the same shape.
//
// Read-only by design. The portal's version carries SIP, lump sum, redeem and
// switch; none of that belongs here — an employee cannot transact on a client's
// behalf from a research screen, and rendering controls that look like they
// might is worse than not having them.
//
// Reads mutual_funds through the CRM's own supabase client (see
// crmFundCatalog) — same table and mapping the portal uses, so a client is
// never quoted numbers their own portal disagrees with, but without dragging
// the portal's auth client into this bundle. The collections module is pure
// derivation over the catalog (icons and a type import only), so it is shared
// with the portal directly rather than duplicated.

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Check, Download, ImageDown, Info, Layers, Minus, Search,
  TrendingDown, TrendingUp, X, GitCompareArrows,
} from 'lucide-react';
import type { CatalogFund, CatalogNavPoint } from '../../../portal/types/funds';
import {
  FUND_COLLECTIONS, byReturn, collectionById, fundsIn, searchFunds,
} from '../../../portal/features/mutual-funds/explore/collections';
import { fetchNavHistory, listCatalogFunds } from './crmFundCatalog';
import {
  COMPARE_COLOURS, NAV_RANGES, buildNavSeries, navChartSvg, navCompareSvg, type NavRange,
} from './navChart';
import { EmptyState, GhostButton, PrimaryButton, inputClass, inputStyle } from '../components/shared';
import {
  MARKET_RISK_LINE, PAST_PERFORMANCE_LINE, downloadFactsheet, renderComparison,
  renderFactsheet, type RenderedFactsheet,
} from './fundFactsheet';

/** At most three: a fourth column stops being readable on a laptop. */
const MAX_COMPARE = 3;

function pctTone(v: number | null): { colour: string; Icon: typeof TrendingUp } {
  if (v === null || Number.isNaN(v)) return { colour: 'var(--text-faint)', Icon: Minus };
  if (v < 0) return { colour: 'var(--danger)', Icon: TrendingDown };
  return { colour: 'var(--success, #1a7f5a)', Icon: TrendingUp };
}

const pct = (v: number | null) =>
  v === null || Number.isNaN(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

type View =
  | { name: 'explore' }
  | { name: 'collection'; id: string }
  | { name: 'house'; amc: string }
  | { name: 'detail'; fund: CatalogFund }
  | { name: 'compare' };

export default function FundResearch() {
  const [funds, setFunds] = useState<CatalogFund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: 'explore' });
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    listCatalogFunds()
      .then(rows => { if (alive) { setFunds(rows); setLoading(false); } })
      .catch(err => {
        if (alive) {
          setError(err instanceof Error ? err.message : 'Could not load the fund catalog.');
          setLoading(false);
        }
      });
    return () => { alive = false; };
  }, []);

  const toggle = (code: string) =>
    setPicked(prev =>
      prev.includes(code)
        ? prev.filter(c => c !== code)
        : prev.length >= MAX_COMPARE ? prev : [...prev, code]);

  const pickedFunds = useMemo(
    () => picked.map(c => funds.find(f => f.amfiCode === c)).filter((f): f is CatalogFund => !!f),
    [picked, funds],
  );

  if (loading) return <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading catalog…</p>;
  if (error) {
    return (
      <div className="rounded-xl p-4 text-sm"
        style={{ background: 'rgba(var(--danger-rgb,180,52,42),0.1)', color: 'var(--danger)' }}>
        {error}
      </div>
    );
  }

  const shared = { picked, toggle, onOpen: (f: CatalogFund) => setView({ name: 'detail', fund: f }) };

  return (
    <div className="pb-24">
      {view.name === 'detail' ? (
        <FundDetail fund={view.fund} onBack={() => setView({ name: 'explore' })} />
      ) : view.name === 'compare' ? (
        <CompareView funds={pickedFunds} onBack={() => setView({ name: 'explore' })}
          onRemove={toggle} />
      ) : view.name === 'collection' ? (
        <ListView
          title={collectionById(view.id)?.label ?? 'Funds'}
          blurb={collectionById(view.id)?.blurb}
          rows={(() => {
            const c = collectionById(view.id);
            return c ? fundsIn(c, funds) : [];
          })()}
          onBack={() => setView({ name: 'explore' })} {...shared} />
      ) : view.name === 'house' ? (
        <ListView
          title={view.amc}
          blurb={`Every fund from ${view.amc} in the NIYOM catalog.`}
          rows={funds.filter(f => f.amc === view.amc).sort(byReturn('3Y'))}
          onBack={() => setView({ name: 'explore' })} {...shared} />
      ) : (
        <ExploreHome funds={funds}
          onOpenCollection={id => setView({ name: 'collection', id })}
          onOpenHouse={amc => setView({ name: 'house', amc })}
          {...shared} />
      )}

      {view.name !== 'compare' && picked.length > 0 && (
        <CompareBar funds={pickedFunds} onClear={() => setPicked([])}
          onRemove={toggle} onCompare={() => setView({ name: 'compare' })} />
      )}
    </div>
  );
}

/* ------------------------------- Explore --------------------------------- */

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between mb-2.5">
      <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      {hint && <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{hint}</span>}
    </div>
  );
}

function ExploreHome({ funds, picked, toggle, onOpen, onOpenCollection, onOpenHouse }: {
  funds: CatalogFund[];
  picked: string[];
  toggle: (code: string) => void;
  onOpen: (f: CatalogFund) => void;
  onOpenCollection: (id: string) => void;
  onOpenHouse: (amc: string) => void;
}) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => (query.trim() ? searchFunds(funds, query) : null), [funds, query]);

  const topPerformers = useMemo(() => [...funds].sort(byReturn('3Y')).slice(0, 6), [funds]);

  // Only collections that actually contain something — the grid tracks the
  // catalog rather than advertising categories NIYOM does not cover yet.
  const collections = useMemo(
    () => FUND_COLLECTIONS.map(c => ({ c, rows: fundsIn(c, funds) })).filter(x => x.rows.length),
    [funds],
  );

  const houses = useMemo(() => {
    const by = new Map<string, number>();
    funds.forEach(f => by.set(f.amc, (by.get(f.amc) ?? 0) + 1));
    return [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [funds]);

  return (
    <div>
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
          Marketing Tools
        </p>
        <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>Mutual Funds</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Research funds, compare a shortlist, and download a factsheet to share with a client.
        </p>
      </div>

      <div className="relative mb-6">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
        <input className={`${inputClass} pl-9`} style={inputStyle}
          placeholder="Search any fund or fund house…" value={query}
          onChange={e => setQuery(e.target.value)} />
      </div>

      {results ? (
        results.length === 0 ? (
          <EmptyState icon={Search} title="No fund matches that."
            message="Try the fund house, or a category like small cap." />
        ) : (
          <>
            <SectionHeader title={`${results.length} result${results.length === 1 ? '' : 's'}`} />
            <FundGrid rows={results} picked={picked} toggle={toggle} onOpen={onOpen} />
          </>
        )
      ) : (
        <div className="space-y-7">
          <section>
            <SectionHeader title="Top performers" hint="By 3-year return" />
            <FundGrid rows={topPerformers} picked={picked} toggle={toggle} onOpen={onOpen} />
          </section>

          <section>
            <SectionHeader title="Collections" />
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {collections.map(({ c, rows }) => (
                <button key={c.id} onClick={() => onOpenCollection(c.id)}
                  className="text-left rounded-2xl p-4 transition-colors hover:bg-[var(--hover-bg)]"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <c.icon className="w-5 h-5 mb-2" style={{ color: 'var(--accent-soft)' }} />
                  <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{c.label}</p>
                  <p className="text-xs mt-0.5 leading-snug" style={{ color: 'var(--text-faint)' }}>{c.blurb}</p>
                  <p className="text-xs mt-1.5 font-semibold" style={{ color: 'var(--accent-soft)' }}>
                    {rows.length} fund{rows.length === 1 ? '' : 's'}
                  </p>
                </button>
              ))}
            </div>
          </section>

          <section>
            <SectionHeader title="Fund houses" />
            <div className="flex flex-wrap gap-2">
              {houses.map(([amc, count]) => (
                <button key={amc} onClick={() => onOpenHouse(amc)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold transition-colors hover:bg-[var(--hover-bg)]"
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                  {amc}
                  <span className="ml-1.5" style={{ color: 'var(--text-faint)' }}>{count}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      <Disclaimer />
    </div>
  );
}

function ListView({ title, blurb, rows, onBack, picked, toggle, onOpen }: {
  title: string;
  blurb?: string;
  rows: CatalogFund[];
  onBack: () => void;
  picked: string[];
  toggle: (code: string) => void;
  onOpen: (f: CatalogFund) => void;
}) {
  return (
    <div>
      <button onClick={onBack} className="text-xs mb-3 flex items-center gap-1"
        style={{ color: 'var(--text-faint)' }}>
        <ArrowLeft className="w-3.5 h-3.5" /> Back to explore
      </button>
      <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h1>
      {blurb && <p className="text-sm mt-1 mb-5" style={{ color: 'var(--text-muted)' }}>{blurb}</p>}
      {rows.length === 0
        ? <EmptyState icon={Layers} title="Nothing here yet" message="No fund in the catalog matches." />
        : <FundGrid rows={rows} picked={picked} toggle={toggle} onOpen={onOpen} />}
      <Disclaimer />
    </div>
  );
}

function FundGrid({ rows, picked, toggle, onOpen }: {
  rows: CatalogFund[];
  picked: string[];
  toggle: (code: string) => void;
  onOpen: (f: CatalogFund) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {rows.map(f => (
        <FundRow key={f.amfiCode} fund={f} onOpen={() => onOpen(f)}
          selected={picked.includes(f.amfiCode)}
          disabled={!picked.includes(f.amfiCode) && picked.length >= MAX_COMPARE}
          onToggle={() => toggle(f.amfiCode)} />
      ))}
    </div>
  );
}

function FundRow({ fund, onOpen, selected, disabled, onToggle }: {
  fund: CatalogFund;
  onOpen: () => void;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const tone = pctTone(fund.returns['3Y']);
  return (
    <div className="rounded-2xl p-4 relative transition-colors"
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${selected ? 'var(--accent-soft)' : 'var(--border)'}`,
      }}>
      {/* Compare toggle is its own control, not part of the open target —
          clicking the card should read the fund, not silently shortlist it. */}
      <button onClick={onToggle} disabled={disabled}
        title={disabled ? `Compare up to ${MAX_COMPARE} funds` : selected ? 'Remove from comparison' : 'Add to comparison'}
        className="absolute top-3 right-3 w-6 h-6 rounded-md flex items-center justify-center transition-colors"
        style={{
          background: selected ? 'var(--accent-soft)' : 'transparent',
          border: `1px solid ${selected ? 'var(--accent-soft)' : 'var(--border)'}`,
          color: selected ? 'var(--text-on-accent)' : 'var(--text-faint)',
          opacity: disabled ? 0.35 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}>
        {selected ? <Check className="w-3.5 h-3.5" /> : <GitCompareArrows className="w-3.5 h-3.5" />}
      </button>

      <button onClick={onOpen} className="text-left w-full">
        <p className="text-sm font-bold leading-snug pr-8" style={{ color: 'var(--text-primary)' }}>
          {fund.name}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
          {fund.amc}{fund.subCategory ? ` · ${fund.subCategory}` : ''}
        </p>
        <div className="flex items-end justify-between mt-3">
          <div>
            <p className="text-lg font-bold flex items-center gap-1" style={{ color: tone.colour }}>
              <tone.Icon className="w-4 h-4" /> {pct(fund.returns['3Y'])}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>3Y annualised</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {fund.nav === null ? '—' : `₹${fund.nav.toFixed(2)}`}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>NAV</p>
          </div>
        </div>
      </button>
    </div>
  );
}

function CompareBar({ funds, onClear, onRemove, onCompare }: {
  funds: CatalogFund[];
  onClear: () => void;
  onRemove: (code: string) => void;
  onCompare: () => void;
}) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-2xl px-3 py-2.5 flex items-center gap-2 shadow-2xl max-w-[95vw]"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--accent-soft)' }}>
      <div className="flex items-center gap-1.5 overflow-x-auto">
        {funds.map((f, i) => (
          <span key={f.amfiCode}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
            style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
            <span className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: COMPARE_COLOURS[i % COMPARE_COLOURS.length] }} />
            {f.name.length > 26 ? `${f.name.slice(0, 26)}…` : f.name}
            <button onClick={() => onRemove(f.amfiCode)} style={{ color: 'var(--text-faint)' }}>
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <GhostButton onClick={onClear} className="text-xs flex-shrink-0">Clear</GhostButton>
      <PrimaryButton onClick={onCompare} disabled={funds.length < 2}
        className="text-xs flex-shrink-0 flex items-center gap-1.5">
        <GitCompareArrows className="w-3.5 h-3.5" />
        {funds.length < 2 ? 'Pick 2 to compare' : `Compare ${funds.length}`}
      </PrimaryButton>
    </div>
  );
}

/* ------------------------------- Compare --------------------------------- */

function CompareView({ funds, onBack, onRemove }: {
  funds: CatalogFund[];
  onBack: () => void;
  onRemove: (code: string) => void;
}) {
  const [range, setRange] = useState<NavRange>('3Y');
  const [histories, setHistories] = useState<Record<string, CatalogNavPoint[]>>({});
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<RenderedFactsheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheetErr, setSheetErr] = useState<string | null>(null);

  // Revoke the previous object URL whenever it is replaced or the view closes,
  // or each rebuild leaks a blob.
  useEffect(() => () => { if (sheet) URL.revokeObjectURL(sheet.previewUrl); }, [sheet]);

  // Changing the range or the shortlist invalidates a built sheet — better to
  // drop it than leave a download button that hands over a stale image.
  useEffect(() => {
    setSheet(prev => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, [range, funds]);

  const buildSheet = async () => {
    setBusy(true);
    setSheetErr(null);
    try {
      // Exactly what is on screen: same funds, same range, same colours.
      const next = await renderComparison(funds, histories, range, COMPARE_COLOURS);
      setSheet(prev => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return next;
      });
    } catch (e) {
      setSheetErr(e instanceof Error ? e.message : 'Could not build the comparison image.');
    } finally {
      setBusy(false);
    }
  };

  // One request per fund, in parallel. A fund whose history fails is simply
  // absent from the chart — the comparison table still stands on catalog data.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all(
      funds.map(f =>
        fetchNavHistory(f.amfiCode)
          .then(r => [f.amfiCode, r.navHistory] as const)
          .catch(() => [f.amfiCode, [] as CatalogNavPoint[]] as const)),
    ).then(pairs => {
      if (!alive) return;
      setHistories(Object.fromEntries(pairs));
      setLoading(false);
    });
    return () => { alive = false; };
  }, [funds]);

  const chartSeries = useMemo(
    () => funds.map((f, i) => ({
      label: f.name,
      colour: COMPARE_COLOURS[i % COMPARE_COLOURS.length],
      series: buildNavSeries(histories[f.amfiCode] ?? [], range),
    })),
    [funds, histories, range],
  );

  const periods: { key: keyof CatalogFund['returns']; label: string }[] = [
    { key: '6M', label: '6 months' }, { key: '1Y', label: '1 year' },
    { key: '3Y', label: '3 years' }, { key: '5Y', label: '5 years' },
    { key: 'SI', label: 'Since launch' },
  ];

  /** Highest value in a row, so the leader can be marked. Ties mark neither. */
  const bestOf = (key: keyof CatalogFund['returns']): string | null => {
    const vals = funds
      .map(f => ({ code: f.amfiCode, v: f.returns[key] }))
      .filter((x): x is { code: string; v: number } => x.v !== null && !Number.isNaN(x.v));
    if (vals.length < 2) return null;
    const max = Math.max(...vals.map(v => v.v));
    const leaders = vals.filter(v => v.v === max);
    return leaders.length === 1 ? leaders[0].code : null;
  };

  if (funds.length < 2) {
    return (
      <div>
        <button onClick={onBack} className="text-xs mb-3 flex items-center gap-1"
          style={{ color: 'var(--text-faint)' }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Back to explore
        </button>
        <EmptyState icon={GitCompareArrows} title="Pick at least two funds"
          message="Use the compare button on a fund card to build a shortlist." />
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="text-xs mb-3 flex items-center gap-1"
        style={{ color: 'var(--text-faint)' }}>
        <ArrowLeft className="w-3.5 h-3.5" /> Back to explore
      </button>
      <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
        Comparing {funds.length} funds
      </h1>
      <p className="text-sm mt-1 mb-5" style={{ color: 'var(--text-muted)' }}>
        Growth of ₹100 invested at the start of the period, and the figures side by side.
      </p>

      <div className="rounded-2xl p-4 mb-4"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-faint)' }}>Growth of ₹100</p>
          <div className="flex gap-1">
            {NAV_RANGES.map(r => (
              <button key={r.id} onClick={() => setRange(r.id)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors"
                style={range === r.id
                  ? { background: 'var(--accent-soft)', color: 'var(--text-on-accent)' }
                  : { background: 'transparent', color: 'var(--text-faint)' }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-sm py-12 text-center" style={{ color: 'var(--text-muted)' }}>
            Loading NAV history…
          </p>
        ) : (
          <>
            {/* Same renderer as the single-fund chart; every value in the markup
                is a number this module formatted, never API or user text. */}
            <svg viewBox="0 0 900 320" width="100%" height="280"
              dangerouslySetInnerHTML={{
                __html: navCompareSvg(chartSeries, {
                  width: 900, height: 320, uid: 'cmp',
                  axis: 'var(--border)', label: 'var(--text-faint)',
                  fontFamily: 'inherit',
                }),
              }} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
              {chartSeries.map(s => (
                <span key={s.label} className="flex items-center gap-1.5 text-xs"
                  style={{ color: 'var(--text-muted)' }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.colour }} />
                  {s.label}
                </span>
              ))}
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
              Each line is rebased to 100 at the start of the window so the schemes are
              comparable — the axis is index points, not rupees. NAV levels differ by
              scheme age and issue price, not by quality.
            </p>
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <table className="w-full text-sm" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th className="text-left p-3 font-semibold text-xs"
                style={{ color: 'var(--text-faint)' }}>&nbsp;</th>
              {funds.map((f, i) => (
                <th key={f.amfiCode} className="text-left p-3 align-top"
                  style={{ borderLeft: '1px solid var(--border-subtle)' }}>
                  <span className="flex items-start gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0"
                      style={{ background: COMPARE_COLOURS[i % COMPARE_COLOURS.length] }} />
                    <span>
                      <span className="block text-xs font-bold leading-snug"
                        style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                      <span className="block text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
                        {f.amc}
                      </span>
                    </span>
                    <button onClick={() => onRemove(f.amfiCode)} className="ml-auto flex-shrink-0"
                      style={{ color: 'var(--text-faint)' }} title="Remove from comparison">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map(p => {
              const best = bestOf(p.key);
              return (
                <tr key={p.key} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>{p.label}</td>
                  {funds.map(f => {
                    const v = f.returns[p.key];
                    return (
                      <td key={f.amfiCode} className="p-3 font-bold"
                        style={{ borderLeft: '1px solid var(--border-subtle)', color: pctTone(v).colour }}>
                        {pct(v)}
                        {best === f.amfiCode && (
                          <span className="ml-1.5 text-xs font-semibold"
                            style={{ color: 'var(--text-faint)' }}>best</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {([
              ['NAV', (f: CatalogFund) => (f.nav === null ? '—' : `₹${f.nav.toFixed(2)}`)],
              ['Category', (f: CatalogFund) => f.subCategory || f.category],
              ['Risk', (f: CatalogFund) => f.risk ?? '—'],
              ['Minimum', (f: CatalogFund) =>
                f.minInvestment === null ? '—' : `₹${f.minInvestment.toLocaleString('en-IN')}`],
            ] as const).map(([label, get]) => (
              <tr key={label} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>{label}</td>
                {funds.map(f => (
                  <td key={f.amfiCode} className="p-3 font-semibold"
                    style={{ borderLeft: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
                    {get(f)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs mt-2" style={{ color: 'var(--text-faint)' }}>
        &ldquo;Best&rdquo; marks only the highest figure in that row. It is a fact about past
        performance over one period, not a view on which fund suits a client.
      </p>

      <div className="flex flex-wrap items-center gap-2 mt-5">
        <PrimaryButton onClick={buildSheet} disabled={busy || loading}
          className="flex items-center gap-2">
          <ImageDown className="w-4 h-4" />
          {busy ? 'Building…' : sheet ? 'Rebuild image' : 'Create comparison image'}
        </PrimaryButton>
        {sheet && (
          <GhostButton onClick={() => downloadFactsheet(sheet)} className="flex items-center gap-2">
            <Download className="w-4 h-4" /> Download PNG
          </GhostButton>
        )}
      </div>

      {sheetErr && <p className="text-sm mt-3" style={{ color: 'var(--danger)' }}>{sheetErr}</p>}

      {sheet && (
        <div className="mt-4">
          <p className="text-xs mb-2" style={{ color: 'var(--text-faint)' }}>
            Preview — share this with the client as-is.
          </p>
          <img src={sheet.previewUrl} alt="Fund comparison"
            className="rounded-xl max-w-[380px] w-full"
            style={{ border: '1px solid var(--border)' }} />
        </div>
      )}

      <Disclaimer />
    </div>
  );
}

function FundDetail({ fund, onBack }: { fund: CatalogFund; onBack: () => void }) {
  const [sheet, setSheet] = useState<RenderedFactsheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [history, setHistory] = useState<CatalogNavPoint[]>([]);
  const [range, setRange] = useState<NavRange>('5Y');
  const [navLoading, setNavLoading] = useState(true);
  const [navError, setNavError] = useState<string | null>(null);

  // History is fetched once per fund; switching range re-slices in memory
  // rather than re-hitting the function.
  useEffect(() => {
    let alive = true;
    setNavLoading(true);
    setNavError(null);
    fetchNavHistory(fund.amfiCode)
      .then(r => { if (alive) { setHistory(r.navHistory); setNavLoading(false); } })
      .catch(e => {
        if (alive) {
          setNavError(e instanceof Error ? e.message : 'NAV history unavailable.');
          setNavLoading(false);
        }
      });
    return () => { alive = false; };
  }, [fund.amfiCode]);

  const series = useMemo(() => buildNavSeries(history, range), [history, range]);

  // The object URL is owned by this screen; release it when the sheet is
  // replaced or the screen closes, or each preview leaks a blob.
  useEffect(() => () => { if (sheet) URL.revokeObjectURL(sheet.previewUrl); }, [sheet]);

  const build = async () => {
    setBusy(true);
    setErr(null);
    try {
      const next = await renderFactsheet(fund, history, range);
      setSheet(prev => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return next;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not build the factsheet.');
    } finally {
      setBusy(false);
    }
  };

  const periods: { key: keyof CatalogFund['returns']; label: string }[] = [
    { key: '6M', label: '6M' }, { key: '1Y', label: '1Y' },
    { key: '3Y', label: '3Y' }, { key: '5Y', label: '5Y' }, { key: 'SI', label: 'Since launch' },
  ];

  return (
    <div>
      <button onClick={onBack} className="text-xs mb-3 flex items-center gap-1"
        style={{ color: 'var(--text-faint)' }}>
        <ArrowLeft className="w-3.5 h-3.5" /> Back to funds
      </button>

      <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{fund.name}</h1>
      <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
        {fund.amc}{fund.subCategory ? ` · ${fund.subCategory}` : ''}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-5">
        {periods.map(p => {
          const v = fund.returns[p.key];
          return (
            <div key={p.key} className="rounded-xl p-3"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <p className="text-lg font-bold" style={{ color: pctTone(v).colour }}>{pct(v)}</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{p.label}</p>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl mt-4 p-4"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-faint)' }}>NAV movement</p>
          <div className="flex gap-1">
            {NAV_RANGES.map(r => (
              <button key={r.id} onClick={() => setRange(r.id)}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors"
                style={range === r.id
                  ? { background: 'var(--accent-soft)', color: 'var(--text-on-accent)' }
                  : { background: 'transparent', color: 'var(--text-faint)' }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {navLoading ? (
          <p className="text-sm py-10 text-center" style={{ color: 'var(--text-muted)' }}>
            Loading NAV history…
          </p>
        ) : navError || series.points.length < 2 ? (
          <p className="text-sm py-10 text-center" style={{ color: 'var(--text-faint)' }}>
            {navError ?? 'NAV history is not available for this scheme.'}
          </p>
        ) : (
          <>
            {/*
              Same renderer the factsheet uses, so the chart an employee shows a
              client on screen and the one in the image they send cannot differ.
              dangerouslySetInnerHTML is safe here: every value in the markup is
              a number formatted by navChart, never user or API text.
            */}
            <svg viewBox="0 0 900 300" width="100%" height="260"
              dangerouslySetInnerHTML={{
                __html: navChartSvg(series, {
                  width: 900, height: 300, uid: 'ui',
                  line: 'var(--accent-soft)', fillFrom: 'var(--accent-soft)',
                  axis: 'var(--border)', label: 'var(--text-faint)',
                  fontFamily: 'inherit',
                }),
              }} />
            {series.changePct !== null && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
                {series.changePct >= 0 ? 'Up' : 'Down'}{' '}
                {Math.abs(series.changePct).toFixed(1)}% over the period shown.
                Not annualised — see trailing returns above.
              </p>
            )}
          </>
        )}
      </div>

      <div className="rounded-2xl mt-4 overflow-hidden"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        {[
          ['NAV', fund.nav === null ? '—' : `₹${fund.nav.toFixed(2)}`],
          ['NAV date', fund.navDate ?? '—'],
          ['Category', `${fund.category}${fund.subCategory ? ` · ${fund.subCategory}` : ''}`],
          ['Risk', fund.risk ?? 'See scheme documents'],
          ['Minimum investment', fund.minInvestment === null ? '—' : `₹${fund.minInvestment.toLocaleString('en-IN')}`],
          ['Launched', fund.launchDate ?? '—'],
        ].map(([k, v], i) => (
          <div key={k} className="flex items-center justify-between px-4 py-3"
            style={{ borderTop: i ? '1px solid var(--border-subtle)' : undefined }}>
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{k}</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{v}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-5">
        <PrimaryButton onClick={build} disabled={busy} className="flex items-center gap-2">
          <ImageDown className="w-4 h-4" />
          {busy ? 'Building…' : sheet ? 'Rebuild factsheet' : 'Create factsheet image'}
        </PrimaryButton>
        {sheet && (
          <GhostButton onClick={() => downloadFactsheet(sheet)} className="flex items-center gap-2">
            <Download className="w-4 h-4" /> Download PNG
          </GhostButton>
        )}
      </div>

      {err && <p className="text-sm mt-3" style={{ color: 'var(--danger)' }}>{err}</p>}

      {sheet && (
        <div className="mt-4">
          <p className="text-xs mb-2" style={{ color: 'var(--text-faint)' }}>
            Preview — share this with the client as-is.
          </p>
          <img src={sheet.previewUrl} alt={`${fund.name} factsheet`}
            className="rounded-xl max-w-[380px] w-full"
            style={{ border: '1px solid var(--border)' }} />
        </div>
      )}

      <Disclaimer />
    </div>
  );
}

function Disclaimer() {
  return (
    <div className="rounded-xl p-3 mt-6 flex items-start gap-2"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
      <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--text-faint)' }} />
      <div className="text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        <p>{MARKET_RISK_LINE}</p>
        <p className="mt-1">{PAST_PERFORMANCE_LINE}</p>
      </div>
    </div>
  );
}
