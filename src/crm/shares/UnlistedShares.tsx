// Unlisted Shares — the security master and the daily price desk.
//
// The bond master gets its prices from an uploaded sheet; unlisted equity has no
// sheet, so the price is typed in here by an admin, dated, and kept as a log
// (us_share_prices) rather than overwritten. Every employee sees the resulting
// list — the same list bonds give them — but only an admin can change a number
// on it. What clients and partners see is this price plus an approved markup,
// which is set on the Share Pricing page, not here.

import { useMemo, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  Search, Loader2, Gem, ShieldAlert, X, Plus, IndianRupee, History,
  Pencil, ImagePlus, CalendarClock,
} from 'lucide-react';
import { NWEmployee } from '../types';
import { ShareLogo } from '../../components/ShareLogo';
import {
  shareQueryClient, useShares, useSharePrices, useSetPrice, useSaveShare, uploadShareLogo,
  type UnlistedShare, type ShareDraft,
} from './shareClient';

interface Props { employee: NWEmployee }

const today = () => new Date().toISOString().slice(0, 10);

const fmtPrice = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/*
 * A hand-entered price goes stale silently — nobody gets a failed-job alert the
 * way the NAV feed does. Flagging anything older than two days is what turns
 * "someone forgot" into something visible on the screen the desk already opens.
 */
const STALE_DAYS = 2;
function staleDays(d: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d + 'T00:00:00');
  if (Number.isNaN(dt.getTime())) return null;
  return Math.floor((Date.now() - dt.getTime()) / 86_400_000);
}

const STATUS_RGB: Record<string, string> = {
  active: '16,185,129', suspended: '245,158,11', inactive: '148,163,184',
};

function StatusBadge({ status }: { status: string }) {
  const rgb = STATUS_RGB[status] ?? STATUS_RGB.inactive;
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-lg font-bold capitalize"
      style={{ background: `rgba(${rgb},0.12)`, color: `rgb(${rgb})` }}>{status}</span>
  );
}

// --- Daily price entry -------------------------------------------------------

function PriceModal({ share, onClose }: { share: UnlistedShare; onClose: () => void }) {
  const [price, setPrice] = useState(share.latest_price != null ? String(share.latest_price) : '');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const setPriceM = useSetPrice();
  const { data: history = [], isLoading } = useSharePrices(share.id);

  const value = parseFloat(price);
  const valid = Number.isFinite(value) && value > 0 && !!date && date <= today();
  const existing = history.find((h) => h.price_date === date);

  const save = async () => {
    setErr(null);
    try {
      await setPriceM.mutateAsync({ shareId: share.id, price: value, date, note });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the price.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-lg rounded-2xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <ShareLogo name={share.short_name || share.company_name} url={share.logo_url} size={36} />
            <div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{share.short_name || share.company_name}</h2>
              <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{share.isin}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ color: 'var(--text-faint)' }}><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {err && (
            <div className="p-3 rounded-xl text-sm flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'rgb(239,68,68)' }}>
              <ShieldAlert className="w-4 h-4 shrink-0" />{err}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-faint)' }}>Price per share</label>
              <div className="relative">
                <IndianRupee className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
                <input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} autoFocus
                  className="w-full pl-7 pr-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-faint)' }}>Price date</label>
              <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
            </div>
          </div>

          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-faint)' }}>Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. dealer quote, size available"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          </div>

          {existing && (
            <p className="text-xs" style={{ color: 'rgb(245,158,11)' }}>
              A price of {fmtPrice(existing.price)} is already on file for {fmtDate(existing.price_date)} — saving will correct it.
            </p>
          )}

          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-faint)' }}>
              <History className="w-3 h-3" /> Recent prices
            </p>
            <div className="rounded-xl overflow-hidden max-h-52 overflow-y-auto" style={{ border: '1px solid var(--border)' }}>
              {isLoading ? (
                <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} /></div>
              ) : history.length === 0 ? (
                <p className="text-xs px-4 py-5 text-center" style={{ color: 'var(--text-faint)' }}>No prices entered yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td className="px-3 py-2" style={{ color: 'var(--text-secondary)' }}>{fmtDate(h.price_date)}</td>
                        <td className="px-3 py-2 font-semibold" style={{ color: 'var(--text-primary)' }}>{fmtPrice(h.price)}</td>
                        <td className="px-3 py-2 truncate" style={{ color: 'var(--text-faint)' }}>{h.employee?.full_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold"
            style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
          <button disabled={!valid || setPriceM.isPending} onClick={save}
            className="px-4 py-2 rounded-lg text-xs font-bold text-on-accent disabled:opacity-40 inline-flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            {setPriceM.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save price
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Add / edit a share ------------------------------------------------------

const BLANK: ShareDraft = {
  isin: '', company_name: '', short_name: '', sector: '', about: '', logo_url: '', website: '',
  face_value: null, lot_size: 1, min_qty: 1, active_status: 'active', display_order: 0,
};

function ShareModal({ share, onClose }: { share: UnlistedShare | null; onClose: () => void }) {
  const [form, setForm] = useState<ShareDraft>(() => share ? {
    isin: share.isin, company_name: share.company_name, short_name: share.short_name,
    sector: share.sector, about: share.about, logo_url: share.logo_url, website: share.website,
    face_value: share.face_value, lot_size: share.lot_size, min_qty: share.min_qty,
    active_status: share.active_status, display_order: share.display_order,
  } : BLANK);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const save = useSaveShare();

  const set = <K extends keyof ShareDraft>(k: K, v: ShareDraft[K]) => setForm((f) => ({ ...f, [k]: v }));

  const valid = (form.isin ?? '').trim().length === 12 && (form.company_name ?? '').trim().length > 1;

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!share) { setErr('Save the share first, then add its logo.'); return; }
    if (file.size > 2 * 1024 * 1024) { setErr('Please choose a logo under 2 MB.'); return; }
    setErr(null);
    setUploading(true);
    try {
      const url = await uploadShareLogo(share.id, file);
      set('logo_url', url);
      // Persist immediately: an uploaded logo the admin then cancels out of would
      // otherwise sit in the bucket unreferenced.
      await save.mutateAsync({ id: share.id, draft: { logo_url: url } });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Logo upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    setErr(null);
    try {
      await save.mutateAsync({ id: share?.id, draft: { ...form, isin: (form.isin ?? '').trim().toUpperCase() } });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save.');
    }
  };

  const field = (label: string, node: React.ReactNode) => (
    <div>
      <label className="text-[11px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--text-faint)' }}>{label}</label>
      {node}
    </div>
  );
  const inputStyle = { background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' };
  const inputCls = 'w-full px-3 py-2 rounded-lg text-sm outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden max-h-[90vh] flex flex-col" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{share ? 'Edit share' : 'Add unlisted share'}</h2>
          <button onClick={onClose} style={{ color: 'var(--text-faint)' }}><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {err && (
            <div className="p-3 rounded-xl text-sm flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'rgb(239,68,68)' }}>
              <ShieldAlert className="w-4 h-4 shrink-0" />{err}
            </div>
          )}

          {/* Logo */}
          <div className="flex items-center gap-4">
            <ShareLogo name={form.short_name || form.company_name || '?'} url={form.logo_url} size={64} />
            <div>
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer"
                style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                {form.logo_url ? 'Replace logo' : 'Upload logo'}
                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden"
                  onChange={(e) => void pickLogo(e.target.files?.[0])} />
              </label>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-faint)' }}>
                {share ? 'PNG or SVG on a transparent background, under 2 MB.' : 'Save the share first, then add its logo.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {field('ISIN', <input value={form.isin ?? ''} onChange={(e) => set('isin', e.target.value.toUpperCase())} maxLength={12} className={inputCls} style={inputStyle} />)}
            {field('Short name', <input value={form.short_name ?? ''} onChange={(e) => set('short_name', e.target.value)} placeholder="NSE" className={inputCls} style={inputStyle} />)}
          </div>
          {field('Company name', <input value={form.company_name ?? ''} onChange={(e) => set('company_name', e.target.value)} className={inputCls} style={inputStyle} />)}
          <div className="grid grid-cols-2 gap-3">
            {field('Sector', <input value={form.sector ?? ''} onChange={(e) => set('sector', e.target.value)} className={inputCls} style={inputStyle} />)}
            {field('Website', <input value={form.website ?? ''} onChange={(e) => set('website', e.target.value)} placeholder="https://" className={inputCls} style={inputStyle} />)}
          </div>
          {field('About', <textarea value={form.about ?? ''} onChange={(e) => set('about', e.target.value)} rows={3} className={inputCls} style={inputStyle} />)}
          <div className="grid grid-cols-4 gap-3">
            {field('Face value', <input type="number" step="0.01" value={form.face_value ?? ''} onChange={(e) => set('face_value', e.target.value === '' ? null : parseFloat(e.target.value))} className={inputCls} style={inputStyle} />)}
            {field('Min qty', <input type="number" min={1} value={form.min_qty ?? 1} onChange={(e) => set('min_qty', parseInt(e.target.value, 10) || 1)} className={inputCls} style={inputStyle} />)}
            {field('Lot size', <input type="number" min={1} value={form.lot_size ?? 1} onChange={(e) => set('lot_size', parseInt(e.target.value, 10) || 1)} className={inputCls} style={inputStyle} />)}
            {field('Order', <input type="number" value={form.display_order ?? 0} onChange={(e) => set('display_order', parseInt(e.target.value, 10) || 0)} className={inputCls} style={inputStyle} />)}
          </div>
          {field('Status', (
            <select value={form.active_status ?? 'active'} onChange={(e) => set('active_status', e.target.value as UnlistedShare['active_status'])} className={inputCls} style={inputStyle}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="inactive">Inactive</option>
            </select>
          ))}
        </div>

        <div className="px-5 py-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold"
            style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
          <button disabled={!valid || save.isPending} onClick={submit}
            className="px-4 py-2 rounded-lg text-xs font-bold text-on-accent disabled:opacity-40 inline-flex items-center gap-2"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            {save.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {share ? 'Save changes' : 'Add share'}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Page --------------------------------------------------------------------

function Inner({ employee }: Props) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const [search, setSearch] = useState('');
  const { data: shares = [], isLoading, error } = useShares(search);
  const [priceFor, setPriceFor] = useState<UnlistedShare | null>(null);
  const [editShare, setEditShare] = useState<UnlistedShare | null>(null);
  const [adding, setAdding] = useState(false);

  const unpriced = useMemo(() => shares.filter((s) => s.active_status === 'active' && s.latest_price == null).length, [shares]);
  const stale = useMemo(
    () => shares.filter((s) => {
      const n = staleDays(s.price_date);
      return s.active_status === 'active' && n !== null && n > STALE_DAYS;
    }).length,
    [shares],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Unlisted Shares</p>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Share Master &amp; Daily Price</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-faint)' }}>
            Prices are entered by hand each day. Clients and partners see this price plus their approved markup — set that on Share Pricing.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setAdding(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-on-accent"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            <Plus className="w-3.5 h-3.5" /> Add share
          </button>
        )}
      </div>

      {(unpriced > 0 || stale > 0) && (
        <div className="p-3 rounded-xl text-sm flex flex-wrap items-center gap-x-4 gap-y-1"
          style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: 'rgb(245,158,11)' }}>
          <span className="inline-flex items-center gap-2"><CalendarClock className="w-4 h-4" /></span>
          {unpriced > 0 && <span>{unpriced} active share{unpriced > 1 ? 's have' : ' has'} no price yet — {unpriced > 1 ? 'they are' : 'it is'} hidden from clients and partners.</span>}
          {stale > 0 && <span>{stale} price{stale > 1 ? 's are' : ' is'} more than {STALE_DAYS} days old.</span>}
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by company, short name or ISIN"
          className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
      </div>

      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        {isLoading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} /></div>
        ) : error ? (
          <p className="text-sm px-5 py-10 text-center" style={{ color: 'rgb(239,68,68)' }}>{(error as Error).message}</p>
        ) : shares.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Gem className="w-7 h-7 mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
            <p className="text-sm" style={{ color: 'var(--text-faint)' }}>No shares in the master yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Company', 'ISIN', 'Sector', 'Price / share', 'Priced on', 'Min · Lot', 'Status', ''].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => {
                  const n = staleDays(s.price_date);
                  const isStale = n !== null && n > STALE_DAYS;
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ShareLogo name={s.short_name || s.company_name} url={s.logo_url} size={34} />
                          <div className="min-w-0">
                            <p className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{s.short_name || s.company_name}</p>
                            {s.short_name && <p className="text-[11px] truncate" style={{ color: 'var(--text-faint)' }}>{s.company_name}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{s.isin}</td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{s.sector || '—'}</td>
                      <td className="px-4 py-3 font-bold whitespace-nowrap" style={{ color: s.latest_price == null ? 'var(--text-faint)' : 'var(--text-primary)' }}>{fmtPrice(s.latest_price)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: isStale ? 'rgb(245,158,11)' : 'var(--text-faint)' }}>
                        {fmtDate(s.price_date)}{isStale && n !== null ? ` · ${n}d old` : ''}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs" style={{ color: 'var(--text-secondary)' }}>{s.min_qty} · {s.lot_size}</td>
                      <td className="px-4 py-3"><StatusBadge status={s.active_status} /></td>
                      <td className="px-4 py-3">
                        {isAdmin && (
                          <div className="flex items-center justify-end gap-2">
                            <button onClick={() => setPriceFor(s)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-on-accent whitespace-nowrap"
                              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                              <IndianRupee className="w-3 h-3" /> Price
                            </button>
                            <button onClick={() => setEditShare(s)} title="Edit share"
                              className="p-1.5 rounded-lg" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                              <Pencil className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {priceFor && <PriceModal share={priceFor} onClose={() => setPriceFor(null)} />}
      {editShare && <ShareModal share={editShare} onClose={() => setEditShare(null)} />}
      {adding && <ShareModal share={null} onClose={() => setAdding(false)} />}
    </div>
  );
}

export default function UnlistedShares({ employee }: Props) {
  return (
    <QueryClientProvider client={shareQueryClient}>
      <Inner employee={employee} />
    </QueryClientProvider>
  );
}
