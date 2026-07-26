import { useEffect, useMemo, useRef, useState } from 'react';
import { LogoLoader } from '../components/LogoLoader';
import { BarChart3, RefreshCw, Search, ArrowUpDown, AlertCircle, Plus, Check, GitCompare, Building2, X, Wallet } from 'lucide-react';
import { PublicPageChrome } from './shared/PublicPageChrome';
import { mfSource, type MutualFund, type MfSortKey, type MfSchemeHit } from './shared/mfSource';
import { fmtPct, returnColor, fmtNav, RiskBadge } from './shared/mfFormat';
import { FundDetailModal, type FundSeed } from './shared/FundDetailModal';
import { CompareModal } from './shared/CompareModal';

/**
 * Public mutual-fund research page. Curated funds come from `mfSource.list()`;
 * search/filter/sort run in memory. The search box also queries the FULL AMFI
 * universe via `mfSource.search()` so any fund can be opened in the detail view,
 * even when it is not in the curated table. Funds can be pinned (max 3) and
 * compared side by side.
 */

const SORTS: { key: MfSortKey; label: string }[] = [
  { key: 'return_1y', label: '1Y Return' },
  { key: 'return_3y', label: '3Y Return' },
  { key: 'return_5y', label: '5Y Return' },
  { key: 'return_ytd', label: 'YTD Return' },
  { key: 'return_si', label: 'Since inception' },
];

const MAX_COMPARE = 3;

interface MFResearchProps {
  onBack: () => void;
}

export default function MFResearch({ onBack }: MFResearchProps) {
  const [funds, setFunds] = useState<MutualFund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState('all');
  const [amc, setAmc] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<MfSortKey>('return_1y');

  // Universe (all-AMFI) search.
  const [universeHits, setUniverseHits] = useState<MfSchemeHit[]>([]);
  const [universeLoading, setUniverseLoading] = useState(false);

  // Fund detail + compare.
  const [detailSeed, setDetailSeed] = useState<FundSeed | null>(null);
  const [pinned, setPinned] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setFunds(await mfSource.list());
    } catch {
      setError('Unable to load fund data right now. Please try again shortly.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Debounced universe search — fires alongside the in-memory curated filter.
  const searchRef = useRef(search);
  searchRef.current = search;
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setUniverseHits([]);
      setUniverseLoading(false);
      return;
    }
    setUniverseLoading(true);
    const t = setTimeout(async () => {
      try {
        const hits = await mfSource.search(q);
        if (searchRef.current.trim() === q) setUniverseHits(hits);
      } catch {
        setUniverseHits([]);
      } finally {
        if (searchRef.current.trim() === q) setUniverseLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fund houses present in the curated set, for the AMC filter.
  const amcs = useMemo(() => {
    const set = new Set<string>();
    funds.forEach((f) => f.fund_house && set.add(f.fund_house));
    return ['all', ...[...set].sort()];
  }, [funds]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return funds
      .filter((f) => (category === 'all' ? true : f.category === category))
      .filter((f) => (amc === 'all' ? true : f.fund_house === amc))
      .filter((f) =>
        q === ''
          ? true
          : `${f.fund_name} ${f.sub_category ?? ''} ${f.fund_house ?? ''}`.toLowerCase().includes(q),
      )
      .sort((a, b) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0));
  }, [funds, category, amc, search, sortBy]);

  // Universe hits not already represented in the curated table (by scheme code).
  const curatedCodes = useMemo(() => new Set(funds.map((f) => f.fund_code)), [funds]);
  const extraHits = useMemo(
    () => universeHits.filter((h) => !curatedCodes.has(h.scheme_code)),
    [universeHits, curatedCodes],
  );

  const pinnedFunds = useMemo(
    () => pinned.map((id) => funds.find((f) => f.id === id)).filter((f): f is MutualFund => !!f),
    [pinned, funds],
  );

  const togglePin = (id: string) =>
    setPinned((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_COMPARE ? prev : [...prev, id],
    );

  const openCurated = (f: MutualFund) =>
    f.fund_code &&
    setDetailSeed({
      scheme_code: f.fund_code,
      fund_name: f.fund_name,
      category: f.category,
      sub_category: f.sub_category,
      fund_house: f.fund_house,
      risk_level: f.risk_level,
      min_investment: f.min_investment,
    });

  return (
    <PublicPageChrome
      onBack={onBack}
      eyebrow="MF Research"
      icon={BarChart3}
      title="Research mutual funds, side by side"
      subtitle="Search every AMFI scheme, drill into NAV history and returns, and compare curated equity, debt and hybrid funds."
      documentTitle="Mutual Fund Research — Niyom Wealth"
      actions={
        <button
          onClick={() => window.open('/onboarding', '_blank')}
          className="lift press inline-flex items-center gap-2 bg-accent-soft hover:bg-accent-soft-deep text-black font-semibold px-5 py-2.5 rounded-xl shadow-md"
        >
          <Wallet size={16} /> Invest now
        </button>
      }
    >
      {/* Controls */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search any mutual fund by name…"
            aria-label="Search funds"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm text-text-primary focus:outline-none focus-visible:ring-2"
            style={{
              background: 'var(--input-bg)',
              border: '1px solid var(--border)',
              // @ts-expect-error CSS custom prop for the focus ring color
              '--tw-ring-color': 'var(--focus-ring)',
            }}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {mfSource.categories.map((cat) => {
            const selected = cat === category;
            return (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className="press text-sm font-medium px-3 py-2 rounded-lg transition-colors"
                style={
                  selected
                    ? { background: 'rgb(var(--accent-soft-rgb))', color: 'var(--text-on-accent)' }
                    : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }
                }
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Secondary controls: AMC + sort */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-text-muted" />
          <select
            value={amc}
            onChange={(e) => setAmc(e.target.value)}
            aria-label="Filter by fund house"
            className="text-sm font-medium px-3 py-2 rounded-lg focus:outline-none focus-visible:ring-2"
            style={{
              background: 'var(--input-bg)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              // @ts-expect-error CSS custom prop for the focus ring color
              '--tw-ring-color': 'var(--focus-ring)',
            }}
          >
            {amcs.map((a) => (
              <option key={a} value={a}>{a === 'all' ? 'All fund houses' : a}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <ArrowUpDown size={16} className="text-text-muted" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as MfSortKey)}
            aria-label="Sort funds by"
            className="text-sm font-medium px-3 py-2 rounded-lg focus:outline-none focus-visible:ring-2"
            style={{
              background: 'var(--input-bg)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              // @ts-expect-error CSS custom prop for the focus ring color
              '--tw-ring-color': 'var(--focus-ring)',
            }}
          >
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(var(--danger-soft-rgb),0.12)', color: 'rgb(var(--danger-soft-rgb))', border: '1px solid rgba(var(--danger-soft-rgb),0.3)' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Universe search results (funds beyond the curated table) */}
      {search.trim().length >= 2 && (extraHits.length > 0 || universeLoading) && (
        <div className="mb-6 rounded-2xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2 mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            <Search size={13} /> All AMFI funds
            {universeLoading && <RefreshCw size={12} className="animate-spin" />}
          </div>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {extraHits.map((h) => (
              <button
                key={h.scheme_code}
                onClick={() => setDetailSeed({ scheme_code: h.scheme_code, fund_name: h.scheme_name, fund_house: h.fund_house })}
                className="press text-left rounded-lg px-3 py-2 transition-colors hover:bg-hover"
                style={{ border: '1px solid var(--border-subtle)' }}
              >
                <div className="text-sm font-medium text-text-primary leading-snug">{h.scheme_name}</div>
                {h.fund_house && <div className="text-[11px] text-text-muted mt-0.5">{h.fund_house}</div>}
              </button>
            ))}
          </div>
          {!universeLoading && extraHits.length === 0 && (
            <p className="text-sm text-text-muted">No additional funds found.</p>
          )}
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl p-10" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <LogoLoader size={44} label="Loading funds…" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl p-16 text-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <BarChart3 className="w-12 h-12 mx-auto text-text-faint mb-4" />
          <p className="text-text-secondary font-medium">No curated funds match your filters.</p>
          {search.trim().length >= 2 && <p className="text-sm text-text-muted mt-1">Try the “All AMFI funds” results above.</p>}
        </div>
      ) : (
        <>
          <p className="text-sm text-text-muted mb-3">{visible.length} curated fund{visible.length === 1 ? '' : 's'} · tap a fund for NAV history & full returns</p>

          {/* Desktop: comparison table */}
          <div className="hidden lg:block rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <th className="px-5 py-3 font-semibold">Fund</th>
                    <th className="px-4 py-3 font-semibold text-right">NAV</th>
                    <th className="px-4 py-3 font-semibold text-right">YTD</th>
                    <th className="px-4 py-3 font-semibold text-right">1Y</th>
                    <th className="px-4 py-3 font-semibold text-right">3Y</th>
                    <th className="px-4 py-3 font-semibold text-right">5Y</th>
                    <th className="px-4 py-3 font-semibold">Risk</th>
                    <th className="px-4 py-3 font-semibold text-center">Compare</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((f) => {
                    const isPinned = pinned.includes(f.id);
                    return (
                      <tr
                        key={f.id}
                        className="transition-colors hover:bg-hover cursor-pointer"
                        style={{ borderBottom: '1px solid var(--border-subtle)' }}
                        onClick={() => openCurated(f)}
                      >
                        <td className="px-5 py-3">
                          <div className="font-semibold text-text-primary">{f.fund_name}</div>
                          <div className="text-xs text-text-muted">{f.category}{f.sub_category ? ` · ${f.sub_category}` : ''}{f.fund_house ? ` · ${f.fund_house}` : ''}</div>
                        </td>
                        <td className="px-4 py-3 text-right text-text-secondary">{fmtNav(f.current_nav)}</td>
                        <td className="px-4 py-3 text-right font-semibold" style={{ color: returnColor(f.return_ytd) }}>{fmtPct(f.return_ytd)}</td>
                        <td className="px-4 py-3 text-right font-semibold" style={{ color: returnColor(f.return_1y) }}>{fmtPct(f.return_1y)}</td>
                        <td className="px-4 py-3 text-right font-semibold" style={{ color: returnColor(f.return_3y) }}>{fmtPct(f.return_3y)}</td>
                        <td className="px-4 py-3 text-right font-semibold" style={{ color: returnColor(f.return_5y) }}>{fmtPct(f.return_5y)}</td>
                        <td className="px-4 py-3"><RiskBadge level={f.risk_level} /></td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); togglePin(f.id); }}
                            aria-label={isPinned ? `Remove ${f.fund_name} from comparison` : `Add ${f.fund_name} to comparison`}
                            aria-pressed={isPinned}
                            disabled={!isPinned && pinned.length >= MAX_COMPARE}
                            className="press inline-flex items-center justify-center w-7 h-7 rounded-lg transition-colors disabled:opacity-40"
                            style={isPinned
                              ? { background: 'rgb(var(--accent-soft-rgb))', color: 'var(--text-on-accent)' }
                              : { background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
                          >
                            {isPinned ? <Check size={15} /> : <Plus size={15} />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile / tablet: cards */}
          <div className="grid sm:grid-cols-2 gap-4 lg:hidden">
            {visible.map((f) => {
              const isPinned = pinned.includes(f.id);
              return (
                <div
                  key={f.id}
                  className="rounded-2xl p-5 cursor-pointer"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}
                  onClick={() => openCurated(f)}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <h3 className="font-bold text-text-primary leading-snug" style={{ fontFamily: 'var(--font-display)' }}>{f.fund_name}</h3>
                      <p className="text-xs text-text-muted mt-0.5">{f.category}{f.sub_category ? ` · ${f.sub_category}` : ''}</p>
                    </div>
                    <RiskBadge level={f.risk_level} />
                  </div>
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    {([['YTD', 'return_ytd'], ['1Y', 'return_1y'], ['3Y', 'return_3y'], ['5Y', 'return_5y']] as const).map(([lbl, k]) => (
                      <div key={k} className="rounded-lg px-2 py-2 text-center" style={{ background: 'var(--bg-raised)' }}>
                        <div className="text-[10px] text-text-muted uppercase">{lbl}</div>
                        <div className="text-sm font-bold" style={{ color: returnColor(f[k]) }}>{fmtPct(f[k])}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-text-muted">NAV {fmtNav(f.current_nav)}</div>
                    <button
                      onClick={(e) => { e.stopPropagation(); togglePin(f.id); }}
                      aria-label={isPinned ? `Remove ${f.fund_name} from comparison` : `Add ${f.fund_name} to comparison`}
                      aria-pressed={isPinned}
                      disabled={!isPinned && pinned.length >= MAX_COMPARE}
                      className="press inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg disabled:opacity-40"
                      style={isPinned
                        ? { background: 'rgb(var(--accent-soft-rgb))', color: 'var(--text-on-accent)' }
                        : { background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
                    >
                      {isPinned ? <Check size={13} /> : <Plus size={13} />} Compare
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="mt-6 mb-24 text-xs text-text-faint leading-relaxed max-w-3xl">
        Fund data shown here is for research and educational purposes only and may be delayed. Returns
        over one year are annualised (CAGR). Past performance is not indicative of future returns.
        Please read all scheme related documents and consult a qualified advisor before investing.
      </p>

      {/* Compare tray */}
      {pinned.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 pointer-events-none">
          <div
            className="pointer-events-auto max-w-3xl mx-auto flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <GitCompare size={16} className="text-accent-soft flex-shrink-0" />
              <span className="text-sm font-medium text-text-primary truncate">
                {pinned.length} fund{pinned.length === 1 ? '' : 's'} selected
                <span className="text-text-muted"> · up to {MAX_COMPARE}</span>
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setPinned([])}
                className="press inline-flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-lg"
                style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
              >
                <X size={14} /> Clear
              </button>
              <button
                onClick={() => setShowCompare(true)}
                disabled={pinned.length < 2}
                className="press inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-1.5 rounded-lg disabled:opacity-40"
                style={{ background: 'rgb(var(--accent-soft-rgb))', color: 'var(--text-on-accent)' }}
              >
                <GitCompare size={14} /> Compare
              </button>
            </div>
          </div>
        </div>
      )}

      {detailSeed && <FundDetailModal seed={detailSeed} onClose={() => setDetailSeed(null)} />}
      {showCompare && pinnedFunds.length >= 2 && (
        <CompareModal
          funds={pinnedFunds}
          onClose={() => setShowCompare(false)}
          onRemove={(id) => {
            const next = pinned.filter((x) => x !== id);
            setPinned(next);
            if (next.length < 2) setShowCompare(false);
          }}
        />
      )}
    </PublicPageChrome>
  );
}
