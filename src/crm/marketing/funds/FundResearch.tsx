// Marketing Tools -> Mutual Funds.
//
// The same curated catalog the client portal shows, surfaced for employees so
// they can look a fund up before talking to a client, and export a factsheet
// image to send them.
//
// Read-only by design. The portal's version of this screen carries ordering
// (SIP, lump sum, redeem, switch); none of that belongs here — an employee
// cannot transact on a client's behalf from a research screen, and rendering
// buttons that look like they might is worse than not having them.
//
// Data comes from MfCatalogService, the same source the portal reads, so a
// client is never quoted numbers their own portal disagrees with.

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Download, ImageDown, Search, TrendingUp, TrendingDown, Minus, Info,
} from 'lucide-react';
import { MfCatalogService } from '../../../portal/services/MfCatalogService';
import type { CatalogFund } from '../../../portal/types/funds';
import { EmptyState, GhostButton, PrimaryButton, inputClass, inputStyle } from '../components/shared';
import {
  MARKET_RISK_LINE, PAST_PERFORMANCE_LINE, downloadFactsheet, renderFactsheet,
  type RenderedFactsheet,
} from './fundFactsheet';

type SortKey = 'return_3y' | 'return_1y' | 'return_5y' | 'name';

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'return_3y', label: '3Y return' },
  { id: 'return_1y', label: '1Y return' },
  { id: 'return_5y', label: '5Y return' },
  { id: 'name', label: 'Name' },
];

function pctTone(v: number | null): { colour: string; Icon: typeof TrendingUp } {
  if (v === null || Number.isNaN(v)) return { colour: 'var(--text-faint)', Icon: Minus };
  if (v < 0) return { colour: 'var(--danger)', Icon: TrendingDown };
  return { colour: 'var(--success, #1a7f5a)', Icon: TrendingUp };
}

const pct = (v: number | null) =>
  v === null || Number.isNaN(v) ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;

export default function FundResearch() {
  const [funds, setFunds] = useState<CatalogFund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [house, setHouse] = useState('all');
  const [sort, setSort] = useState<SortKey>('return_3y');
  const [selected, setSelected] = useState<CatalogFund | null>(null);

  useEffect(() => {
    let alive = true;
    MfCatalogService.list()
      .then(rows => { if (alive) { setFunds(rows); setLoading(false); } })
      .catch(err => {
        if (alive) {
          setError(err instanceof Error ? err.message : 'Could not load the fund catalog.');
          setLoading(false);
        }
      });
    return () => { alive = false; };
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(funds.map(f => f.category).filter(Boolean))).sort(),
    [funds],
  );
  const houses = useMemo(
    () => Array.from(new Set(funds.map(f => f.amc).filter(Boolean))).sort(),
    [funds],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = funds.filter(f => {
      if (category !== 'all' && f.category !== category) return false;
      if (house !== 'all' && f.amc !== house) return false;
      if (!q) return true;
      return `${f.name} ${f.amc} ${f.subCategory}`.toLowerCase().includes(q);
    });
    const num = (v: number | null) => (v === null || Number.isNaN(v) ? -Infinity : v);
    return [...rows].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      const key = sort === 'return_1y' ? '1Y' : sort === 'return_5y' ? '5Y' : '3Y';
      return num(b.returns[key]) - num(a.returns[key]);
    });
  }, [funds, query, category, house, sort]);

  if (selected) {
    return <FundDetail fund={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
          Marketing Tools
        </p>
        <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>Mutual Funds</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Research funds and download a factsheet to share with a client. Same catalog
          the client portal shows, so the numbers always agree.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input className={`${inputClass} pl-9`} style={inputStyle}
            placeholder="Search fund or house…" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <select className={inputClass} style={{ ...inputStyle, maxWidth: 190 }}
          value={category} onChange={e => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={inputClass} style={{ ...inputStyle, maxWidth: 220 }}
          value={house} onChange={e => setHouse(e.target.value)}>
          <option value="all">All fund houses</option>
          {houses.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <select className={inputClass} style={{ ...inputStyle, maxWidth: 170 }}
          value={sort} onChange={e => setSort(e.target.value as SortKey)}>
          {SORTS.map(s => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading catalog…</p>
      ) : error ? (
        <div className="rounded-xl p-4 text-sm"
          style={{ background: 'rgba(var(--danger-rgb,180,52,42),0.1)', color: 'var(--danger)' }}>
          {error}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={Search} title="No funds match"
          message="Try a different search, category or fund house." />
      ) : (
        <>
          <p className="text-xs mb-3" style={{ color: 'var(--text-faint)' }}>
            {visible.length} of {funds.length} funds
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {visible.map(f => <FundRow key={f.amfiCode} fund={f} onOpen={() => setSelected(f)} />)}
          </div>
        </>
      )}

      <Disclaimer />
    </div>
  );
}

function FundRow({ fund, onOpen }: { fund: CatalogFund; onOpen: () => void }) {
  const tone = pctTone(fund.returns['3Y']);
  return (
    <button onClick={onOpen}
      className="text-left rounded-2xl p-4 transition-colors hover:bg-[var(--hover-bg)]"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <p className="text-sm font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
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
  );
}

function FundDetail({ fund, onBack }: { fund: CatalogFund; onBack: () => void }) {
  const [sheet, setSheet] = useState<RenderedFactsheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The object URL is owned by this screen; release it when the sheet is
  // replaced or the screen closes, or each preview leaks a blob.
  useEffect(() => () => { if (sheet) URL.revokeObjectURL(sheet.previewUrl); }, [sheet]);

  const build = async () => {
    setBusy(true);
    setErr(null);
    try {
      const next = await renderFactsheet(fund);
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

/**
 * On screen as well as on the exported image. An employee reading returns here
 * is forming the advice they will give; the caveat belongs where they read the
 * number, not only on the artefact they send.
 */
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
