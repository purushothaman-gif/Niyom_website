import { useEffect, useMemo, useState } from 'react';
import { BarChart3, RefreshCw, Search, ArrowUpDown, AlertCircle } from 'lucide-react';
import { PublicPageChrome } from './shared/PublicPageChrome';
import { mfSource, type MutualFund, type MfSortKey } from './shared/mfSource';

/**
 * Public mutual-fund research page. All data access goes through `mfSource`
 * (see shared/mfSource.ts); search, filtering and sorting are applied in memory
 * so the source stays a thin, swappable data provider.
 */

const SORTS: { key: MfSortKey; label: string }[] = [
  { key: 'return_1y', label: '1Y Return' },
  { key: 'return_3y', label: '3Y Return' },
  { key: 'return_5y', label: '5Y Return' },
  { key: 'aum', label: 'AUM' },
];

const fmtPct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
const fmtAum = (cr: number) =>
  cr >= 1000 ? `₹${(cr / 1000).toFixed(2)}k Cr` : `₹${cr.toLocaleString('en-IN')} Cr`;
const returnColor = (n: number) =>
  n > 0 ? 'rgb(var(--success-soft-rgb))' : n < 0 ? 'rgb(var(--danger-soft-rgb))' : 'var(--text-muted)';

function RiskBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const map: Record<string, string> = { Low: 'success-soft', Moderate: 'warning-soft', High: 'danger-soft' };
  const token = map[level] ?? 'info-soft';
  return (
    <span
      className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: `rgba(var(--${token}-rgb),0.14)`, color: `rgb(var(--${token}-rgb))` }}
    >
      {level}
    </span>
  );
}

interface MFResearchProps {
  onBack: () => void;
}

export default function MFResearch({ onBack }: MFResearchProps) {
  const [funds, setFunds] = useState<MutualFund[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<MfSortKey>('return_1y');

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

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await mfSource.refresh();
      await load();
    } catch {
      setError('Refresh failed. Please try again shortly.');
    } finally {
      setRefreshing(false);
    }
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return funds
      .filter((f) => (category === 'all' ? true : f.category === category))
      .filter((f) =>
        q === ''
          ? true
          : `${f.fund_name} ${f.fund_manager ?? ''} ${f.sub_category ?? ''}`.toLowerCase().includes(q),
      )
      .sort((a, b) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0));
  }, [funds, category, search, sortBy]);

  return (
    <PublicPageChrome
      onBack={onBack}
      eyebrow="MF Research"
      icon={BarChart3}
      title="Research mutual funds, side by side"
      subtitle="Compare returns, AUM, expense ratios and risk across curated equity, debt and hybrid funds."
      documentTitle="Mutual Fund Research — Niyom Wealth"
      actions={
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="lift press inline-flex items-center gap-2 bg-accent-soft hover:bg-accent-soft-deep text-black font-semibold px-5 py-2.5 rounded-xl shadow-md disabled:opacity-60"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Updating…' : 'Update data'}
        </button>
      }
    >
      {/* Controls */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by fund, manager or category…"
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
        <div className="flex items-center gap-2">
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

      {loading ? (
        <div className="rounded-2xl p-10 text-center text-text-muted" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <RefreshCw className="w-6 h-6 mx-auto mb-3 animate-spin text-accent-soft" /> Loading funds…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl p-16 text-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <BarChart3 className="w-12 h-12 mx-auto text-text-faint mb-4" />
          <p className="text-text-secondary font-medium">No funds match your filters.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-text-muted mb-3">{visible.length} fund{visible.length === 1 ? '' : 's'}</p>

          {/* Desktop: comparison table */}
          <div className="hidden lg:block rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <th className="px-5 py-3 font-semibold">Fund</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold text-right">1Y</th>
                    <th className="px-4 py-3 font-semibold text-right">3Y</th>
                    <th className="px-4 py-3 font-semibold text-right">5Y</th>
                    <th className="px-4 py-3 font-semibold text-right">AUM</th>
                    <th className="px-4 py-3 font-semibold text-right">Expense</th>
                    <th className="px-4 py-3 font-semibold">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((f) => (
                    <tr key={f.id} className="transition-colors hover:bg-hover" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="px-5 py-3">
                        <div className="font-semibold text-text-primary">{f.fund_name}</div>
                        <div className="text-xs text-text-muted">{f.sub_category}{f.fund_manager ? ` · ${f.fund_manager}` : ''}</div>
                      </td>
                      <td className="px-4 py-3 text-text-secondary">{f.category}</td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: returnColor(f.return_1y) }}>{fmtPct(f.return_1y)}</td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: returnColor(f.return_3y) }}>{fmtPct(f.return_3y)}</td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: returnColor(f.return_5y) }}>{fmtPct(f.return_5y)}</td>
                      <td className="px-4 py-3 text-right text-text-secondary">{fmtAum(f.aum)}</td>
                      <td className="px-4 py-3 text-right text-text-secondary">{f.expense_ratio.toFixed(2)}%</td>
                      <td className="px-4 py-3"><RiskBadge level={f.risk_level} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile / tablet: cards */}
          <div className="grid sm:grid-cols-2 gap-4 lg:hidden">
            {visible.map((f) => (
              <div key={f.id} className="rounded-2xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <h3 className="font-bold text-text-primary leading-snug" style={{ fontFamily: 'var(--font-display)' }}>{f.fund_name}</h3>
                    <p className="text-xs text-text-muted mt-0.5">{f.category} · {f.sub_category}</p>
                  </div>
                  <RiskBadge level={f.risk_level} />
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {(['return_1y', 'return_3y', 'return_5y'] as const).map((k, i) => (
                    <div key={k} className="rounded-lg px-2 py-2 text-center" style={{ background: 'var(--bg-raised)' }}>
                      <div className="text-[10px] text-text-muted uppercase">{['1Y', '3Y', '5Y'][i]}</div>
                      <div className="text-sm font-bold" style={{ color: returnColor(f[k]) }}>{fmtPct(f[k])}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between text-xs text-text-muted">
                  <span>AUM {fmtAum(f.aum)}</span>
                  <span>Expense {f.expense_ratio.toFixed(2)}%</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="mt-6 text-xs text-text-faint leading-relaxed max-w-3xl">
        Fund data shown here is for research and educational purposes only and may be delayed. Past
        performance is not indicative of future returns. Please read all scheme related documents and
        consult a qualified advisor before investing.
      </p>
    </PublicPageChrome>
  );
}
