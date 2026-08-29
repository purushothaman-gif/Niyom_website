// Bond Security Master — searchable list of every bond in the master.

import { useState } from 'react';
import { LogoLoader } from '../../components/LogoLoader';
import { useQueryClient } from '@tanstack/react-query';
import { Search, UploadCloud, Loader2, ShieldCheck, ShieldAlert, Clock, Landmark, Sparkles, SlidersHorizontal, X, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { useBonds, enrichPendingLoop } from './bondClient';
import { BondPublic } from './bondTypes';

// Sortable columns (order matches the table body cells).
type SortType = 'text' | 'num' | 'date';
const COLUMNS: { label: string; type: SortType; get: (b: BondPublic) => string | number | null }[] = [
  { label: 'Bond', type: 'text', get: b => b.bond_name || b.issuer_name || '' },
  { label: 'ISIN', type: 'text', get: b => b.isin || '' },
  { label: 'Coupon', type: 'num', get: b => b.coupon_rate },
  { label: 'Freq', type: 'text', get: b => b.coupon_frequency || '' },
  { label: 'Maturity', type: 'date', get: b => b.maturity_date },
  { label: 'Rating', type: 'text', get: b => b.rating || '' },
  { label: 'Category', type: 'text', get: b => b.security_type || '' },
  { label: 'Price', type: 'num', get: b => b.latest_price },
  { label: 'Quality', type: 'num', get: b => b.data_quality_score },
  { label: 'Status', type: 'text', get: b => b.verification_status || '' },
  { label: 'Updated', type: 'date', get: b => b.price_updated_at || b.updated_at },
];

interface Props { isAdmin: boolean; onUpload: () => void; onVerify: () => void; onOpen: (id: string) => void; }

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtPct(v: number | null): string { return v === null || v === undefined ? '—' : `${Number(v).toFixed(2)}%`; }
function fmtPrice(v: number | null): string { return v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`; }

// A bond's price is "stale" when it hasn't been refreshed in a few days — it
// wasn't in a recent price sheet (or the daily refresh skipped it). Surfaced so
// staff can spot which bonds need a fresh price, since prices are sheet-driven.
const STALE_DAYS = 4;
function daysSince(d: string | null | undefined): number | null {
  if (!d) return null;
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : Math.floor((Date.now() - dt.getTime()) / 86_400_000);
}
function isStalePrice(b: BondPublic): boolean {
  const n = daysSince(b.price_updated_at || b.updated_at);
  return n !== null && n > STALE_DAYS;
}

const VERIF: Record<string, { label: string; rgb: string; icon: typeof ShieldCheck }> = {
  verified:     { label: 'Verified',   rgb: '16,185,129',  icon: ShieldCheck },
  enriching:    { label: 'Enriching',  rgb: '59,130,246',  icon: Loader2 },
  needs_review: { label: 'Review',     rgb: '245,158,11',  icon: ShieldAlert },
  pending:      { label: 'Pending',    rgb: '148,163,184', icon: Clock },
  failed:       { label: 'Failed',     rgb: '239,68,68',   icon: ShieldAlert },
};

function VerifBadge({ status }: { status: string }) {
  const v = VERIF[status] ?? VERIF.pending;
  const Icon = v.icon;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg font-semibold"
      style={{ background: `rgba(${v.rgb},0.12)`, color: `rgb(${v.rgb})`, border: `1px solid rgba(${v.rgb},0.3)` }}>
      <Icon className={`w-3 h-3 ${status === 'enriching' ? 'animate-spin' : ''}`} /> {v.label}
    </span>
  );
}

function QualityBadge({ score }: { score: number }) {
  const rgb = score >= 90 ? '16,185,129' : score >= 60 ? '245,158,11' : '239,68,68';
  return (
    <span className="text-[11px] px-2 py-0.5 rounded-lg font-bold"
      style={{ background: `rgba(${rgb},0.12)`, color: `rgb(${rgb})` }}>{Math.round(score)}%</span>
  );
}

export default function BondMasterList({ isAdmin, onUpload, onVerify, onOpen }: Props) {
  const [search, setSearch] = useState('');
  const { data: bonds = [], isLoading, error } = useBonds(search);
  const qc = useQueryClient();
  const [mastering, setMastering] = useState<number | null>(null);
  const pending = bonds.filter(b => b.verification_status === 'pending' || b.verification_status === 'failed').length;
  const review = bonds.filter(b => b.verification_status === 'needs_review').length;

  // Column filters (client-side — the whole active list is already loaded).
  const EMPTY = { freq: '', status: '', cat: '', rating: '', couponMin: '', couponMax: '', priceMin: '', priceMax: '', minInvMin: '', minInvMax: '', qualityMin: '', matFrom: '', matTo: '', updFrom: '' };
  const categories = Array.from(new Set(bonds.map(b => b.security_type).filter(Boolean))).sort() as string[];
  const [filters, setFilters] = useState<Record<string, string>>(EMPTY);
  const [showFilters, setShowFilters] = useState(false);
  const setF = (k: string, v: string) => setFilters(f => ({ ...f, [k]: v }));
  const activeCount = Object.values(filters).filter(v => v !== '').length;

  const numOr = (v: string): number | null => (v === '' || Number.isNaN(parseFloat(v)) ? null : parseFloat(v));
  const inRange = (val: number | null, min: number | null, max: number | null): boolean => {
    if (min !== null && (val === null || val < min)) return false;
    if (max !== null && (val === null || val > max)) return false;
    return true;
  };
  const filtered = bonds.filter((b: BondPublic) => {
    if (filters.freq && b.coupon_frequency !== filters.freq) return false;
    if (filters.status && b.verification_status !== filters.status) return false;
    if (filters.cat && b.security_type !== filters.cat) return false;
    if (filters.rating && !(b.rating || '').toLowerCase().includes(filters.rating.toLowerCase())) return false;
    if (!inRange(b.coupon_rate, numOr(filters.couponMin), numOr(filters.couponMax))) return false;
    if (!inRange(b.latest_price, numOr(filters.priceMin), numOr(filters.priceMax))) return false;
    if (!inRange(b.min_investment, numOr(filters.minInvMin), numOr(filters.minInvMax))) return false;
    const qMin = numOr(filters.qualityMin);
    if (qMin !== null && (b.data_quality_score ?? 0) < qMin) return false;
    if (filters.matFrom && (!b.maturity_date || b.maturity_date < filters.matFrom)) return false;
    if (filters.matTo && (!b.maturity_date || b.maturity_date > filters.matTo)) return false;
    if (filters.updFrom) { const u = (b.price_updated_at || b.updated_at || '').slice(0, 10); if (!u || u < filters.updFrom) return false; }
    return true;
  });

  // Column sort — click a header to toggle asc/desc (numbers/dates default high→low, text A→Z).
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const clickSort = (col: typeof COLUMNS[number]) => setSort(s =>
    s && s.key === col.label
      ? { key: col.label, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key: col.label, dir: col.type === 'text' ? 'asc' : 'desc' });

  const sorted = [...filtered];
  if (sort) {
    const col = COLUMNS.find(c => c.label === sort.key)!;
    const dir = sort.dir === 'asc' ? 1 : -1;
    sorted.sort((a, b) => {
      const va = col.get(a), vb = col.get(b);
      const na = va === null || va === undefined || va === '';
      const nb = vb === null || vb === undefined || vb === '';
      if (na && nb) return 0;
      if (na) return 1;            // nulls always last
      if (nb) return -1;
      let cmp = 0;
      if (col.type === 'num') cmp = Number(va) - Number(vb);
      else if (col.type === 'date') cmp = new Date(va as string).getTime() - new Date(vb as string).getTime();
      else cmp = String(va).localeCompare(String(vb));
      return cmp * dir;
    });
  }

  const masterPending = async () => {
    setMastering(0);
    try { await enrichPendingLoop(done => setMastering(done)); }
    finally { setMastering(null); qc.invalidateQueries({ queryKey: ['bm_bonds'] }); }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Bond Security Master</p>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Bonds</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-faint)' }}>
            {filtered.length.toLocaleString('en-IN')}{filtered.length !== bonds.length ? ` of ${bonds.length.toLocaleString('en-IN')}` : ''} in current list
            {(() => { const n = bonds.filter(isStalePrice).length; return n > 0
              ? <span style={{ color: 'rgb(245,158,11)' }}> · {n.toLocaleString('en-IN')} price{n === 1 ? '' : 's'} &gt;{STALE_DAYS}d old</span>
              : null; })()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ISIN, name, issuer"
              className="pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none w-64"
              style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          </div>
          <button onClick={() => setShowFilters(s => !s)} className="px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2"
            style={{ background: showFilters || activeCount ? 'rgba(var(--accent-soft-rgb),0.12)' : 'var(--bg-surface)', border: `1px solid ${activeCount ? 'var(--accent)' : 'var(--border)'}`, color: activeCount ? 'var(--accent)' : 'var(--text-secondary)' }}>
            <SlidersHorizontal className="w-4 h-4" /> Filters{activeCount ? ` · ${activeCount}` : ''}
          </button>
          {isAdmin && review > 0 && (
            <button onClick={onVerify} className="px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2"
              style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)', color: 'rgb(180,120,10)' }}>
              <ShieldAlert className="w-4 h-4" /> Verify {review}
            </button>
          )}
          {isAdmin && pending > 0 && (
            <button onClick={masterPending} disabled={mastering !== null} className="px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60 flex items-center gap-2"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
              {mastering !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {mastering !== null ? `Mastering… ${mastering}` : `Master ${pending} pending`}
            </button>
          )}
          {isAdmin && (
            <button onClick={onUpload} className="px-4 py-2.5 rounded-xl text-sm font-bold text-on-accent flex items-center gap-2"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
              <UploadCloud className="w-4 h-4" /> Upload Prices
            </button>
          )}
        </div>
      </div>

      {showFilters && (
        <div className="rounded-2xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-faint)' }}>Frequency</label>
              <select value={filters.freq} onChange={e => setF('freq', e.target.value)} className="w-full px-2.5 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                <option value="">All</option>
                {['monthly', 'quarterly', 'half_yearly', 'annual', 'zero'].map(o => <option key={o} value={o}>{o.replace('_', '-')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-faint)' }}>Status</label>
              <select value={filters.status} onChange={e => setF('status', e.target.value)} className="w-full px-2.5 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                <option value="">All</option>
                {['verified', 'needs_review', 'pending', 'enriching', 'failed'].map(o => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-faint)' }}>Category</label>
              <select value={filters.cat} onChange={e => setF('cat', e.target.value)} className="w-full px-2.5 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                <option value="">All</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-faint)' }}>Rating contains</label>
              <input value={filters.rating} onChange={e => setF('rating', e.target.value)} placeholder="e.g. AAA, AA+" className="w-full px-2.5 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-faint)' }}>Min quality %</label>
              <input type="number" min={0} max={100} value={filters.qualityMin} onChange={e => setF('qualityMin', e.target.value)} placeholder="e.g. 60" className="w-full px-2.5 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-faint)' }}>Coupon %</label>
              <div className="flex items-center gap-1.5">
                <input type="number" step="0.01" value={filters.couponMin} onChange={e => setF('couponMin', e.target.value)} placeholder="min" className="w-full px-2 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                <span style={{ color: 'var(--text-faint)' }}>–</span>
                <input type="number" step="0.01" value={filters.couponMax} onChange={e => setF('couponMax', e.target.value)} placeholder="max" className="w-full px-2 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-faint)' }}>Price /100</label>
              <div className="flex items-center gap-1.5">
                <input type="number" step="0.01" value={filters.priceMin} onChange={e => setF('priceMin', e.target.value)} placeholder="min" className="w-full px-2 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                <span style={{ color: 'var(--text-faint)' }}>–</span>
                <input type="number" step="0.01" value={filters.priceMax} onChange={e => setF('priceMax', e.target.value)} placeholder="max" className="w-full px-2 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-faint)' }}>Min. Investment (₹)</label>
              <div className="flex items-center gap-1.5">
                <input type="number" step="1000" min={0} value={filters.minInvMin} onChange={e => setF('minInvMin', e.target.value)} placeholder="min" className="w-full px-2 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                <span style={{ color: 'var(--text-faint)' }}>–</span>
                <input type="number" step="1000" min={0} value={filters.minInvMax} onChange={e => setF('minInvMax', e.target.value)} placeholder="max" className="w-full px-2 py-2 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-faint)' }}>Maturity from – to</label>
              <div className="flex items-center gap-1.5">
                <input type="date" value={filters.matFrom} onChange={e => setF('matFrom', e.target.value)} className="w-full px-2 py-2 rounded-lg text-xs outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
                <input type="date" value={filters.matTo} onChange={e => setF('matTo', e.target.value)} className="w-full px-2 py-2 rounded-lg text-xs outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-faint)' }}>Updated on/after</label>
              <input type="date" value={filters.updFrom} onChange={e => setF('updFrom', e.target.value)} className="w-full px-2.5 py-2 rounded-lg text-xs outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
            </div>
          </div>
          {activeCount > 0 && (
            <div className="flex justify-end mt-3">
              <button onClick={() => setFilters(EMPTY)} className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                <X className="w-3.5 h-3.5" /> Clear all filters
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm" style={{ color: 'rgb(239,68,68)' }}>{(error as Error).message}</p>}

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><LogoLoader size={48} /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24 rounded-2xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <Landmark className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{search || activeCount ? 'No bonds match your search or filters.' : 'No bonds yet.'}</p>
          {(search || activeCount) ? <button onClick={() => { setSearch(''); setFilters(EMPTY); }} className="mt-3 text-sm font-semibold" style={{ color: 'var(--accent)' }}>Clear search &amp; filters</button>
            : isAdmin && <button onClick={onUpload} className="mt-3 text-sm font-semibold" style={{ color: 'var(--accent)' }}>Upload the daily price file →</button>}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {COLUMNS.map(col => {
                    const active = sort?.key === col.label;
                    return (
                      <th key={col.label} onClick={() => clickSort(col)}
                        className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none crm-row-hover"
                        style={{ color: active ? 'var(--accent)' : 'var(--text-faint)' }}>
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {active
                            ? (sort!.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)
                            : <ArrowUpDown className="w-3 h-3" style={{ opacity: 0.3 }} />}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((b: BondPublic) => (
                  <tr key={b.id} onClick={() => onOpen(b.id)} className="crm-row-hover cursor-pointer" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td className="px-3 py-2.5 max-w-[280px]">
                      <p className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{b.bond_name || b.issuer_name || '—'}</p>
                      {b.issuer_name && b.bond_name && <p className="text-xs truncate" style={{ color: 'var(--text-faint)' }}>{b.issuer_name}</p>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>{b.isin}</td>
                    <td className="px-3 py-2.5" style={{ color: 'var(--text-secondary)' }}>{fmtPct(b.coupon_rate)}</td>
                    <td className="px-3 py-2.5 text-xs capitalize" style={{ color: 'var(--text-faint)' }}>{(b.coupon_frequency || '—').replace('_', '-')}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{fmtDate(b.maturity_date)}</td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{b.rating || '—'}</td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{b.security_type || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtPrice(b.latest_price)}</td>
                    <td className="px-3 py-2.5"><QualityBadge score={b.data_quality_score} /></td>
                    <td className="px-3 py-2.5"><VerifBadge status={b.verification_status} /></td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: isStalePrice(b) ? 'rgb(245,158,11)' : 'var(--text-faint)' }}>
                      {fmtDate(b.price_updated_at || b.updated_at)}{isStalePrice(b) ? ' · stale' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
