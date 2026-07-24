// Bond Security Master — searchable list of every bond in the master.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Search, UploadCloud, Loader2, ShieldCheck, ShieldAlert, Clock, Landmark, Sparkles } from 'lucide-react';
import { useBonds, enrichPendingLoop } from './bondClient';
import { BondPublic } from './bondTypes';

interface Props { isAdmin: boolean; onUpload: () => void; onVerify: () => void; onOpen: (id: string) => void; }

function fmtDate(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtPct(v: number | null): string { return v === null || v === undefined ? '—' : `${Number(v).toFixed(2)}%`; }
function fmtPrice(v: number | null): string { return v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`; }

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
          <p className="text-sm mt-1" style={{ color: 'var(--text-faint)' }}>{bonds.length.toLocaleString('en-IN')} in current list</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search ISIN, name, issuer"
              className="pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none w-64"
              style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          </div>
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

      {error && <p className="text-sm" style={{ color: 'rgb(239,68,68)' }}>{(error as Error).message}</p>}

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} /></div>
      ) : bonds.length === 0 ? (
        <div className="text-center py-24 rounded-2xl" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <Landmark className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{search ? 'No bonds match your search.' : 'No bonds yet.'}</p>
          {isAdmin && !search && <button onClick={onUpload} className="mt-3 text-sm font-semibold" style={{ color: 'var(--accent)' }}>Upload the daily price file →</button>}
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Bond', 'ISIN', 'Coupon', 'Freq', 'Maturity', 'Rating', 'Price', 'Quality', 'Status', 'Updated'].map(h => (
                    <th key={h} className="px-3 py-2.5 text-left text-xs font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bonds.map((b: BondPublic) => (
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
                    <td className="px-3 py-2.5 text-right font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtPrice(b.latest_price)}</td>
                    <td className="px-3 py-2.5"><QualityBadge score={b.data_quality_score} /></td>
                    <td className="px-3 py-2.5"><VerifBadge status={b.verification_status} /></td>
                    <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-faint)' }}>{fmtDate(b.price_updated_at || b.updated_at)}</td>
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
