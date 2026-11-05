// CRM → Marketing Tools → Brand Logos (admin only).
//
// Upload the real logo of each mutual-fund house and bond issuer. One upload
// shows everywhere that name appears: client portal MF + bonds, partner bonds,
// the public /bond-offer page, CRM Fund Research and Bond Master. Same model as
// unlisted-share logos, but keyed by name (see 20261106100000_brand_logos.sql).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Search, Trash2, Upload } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { NWEmployee } from './types';
import { ShareLogo } from '../components/ShareLogo';
import { brandKey, loadBrandLogos, useBrandLogoMap, type BrandKind } from '../components/brandLogos';

interface Candidate { kind: BrandKind; name: string; uses: number }

const TABS: { kind: BrandKind; label: string }[] = [
  { kind: 'amc', label: 'Mutual fund houses' },
  { kind: 'bond_issuer', label: 'Bond issuers' },
];

async function uploadBrandLogo(kind: BrandKind, name: string, file: File, empId: string) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  // Fixed path per name so a re-upload overwrites instead of orphaning.
  const path = `${kind}/${brandKey(name)}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('brand-logos')
    .upload(path, file, { upsert: true, contentType: file.type || 'image/png' });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from('brand-logos').getPublicUrl(path);
  const logo_url = `${data.publicUrl}?v=${Date.now()}`;
  const { error } = await supabase
    .from('nw_brand_logos')
    .upsert({ kind, name, logo_url, updated_by: empId, updated_at: new Date().toISOString() }, { onConflict: 'kind,name_key' });
  if (error) throw error;
}

async function removeBrandLogo(kind: BrandKind, name: string) {
  const { error } = await supabase.from('nw_brand_logos').delete().eq('kind', kind).eq('name_key', brandKey(name));
  if (error) throw error;
}

export default function BrandLogos({ employee }: { employee: NWEmployee }) {
  const [tab, setTab] = useState<BrandKind>('amc');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const logos = useBrandLogoMap();

  useEffect(() => {
    supabase.rpc('nw_brand_logo_candidates').then(({ data, error }) => {
      if (error) setErr(error.message);
      else setRows((data ?? []) as Candidate[]);
      setLoading(false);
    });
  }, []);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => r.kind === tab && (!needle || r.name.toLowerCase().includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, tab, q]);

  const counts = useMemo(() => {
    const c: Record<BrandKind, [number, number]> = { amc: [0, 0], bond_issuer: [0, 0] };
    for (const r of rows) {
      c[r.kind][1]++;
      if (logos.has(`${r.kind}:${brandKey(r.name)}`)) c[r.kind][0]++;
    }
    return c;
  }, [rows, logos]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Brand Logos</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Upload the real logo for each fund house and bond issuer. It replaces the initials tile across the CRM, client portal, partner portal and bond offer links.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.kind}
            onClick={() => setTab(t.kind)}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold"
            style={tab === t.kind
              ? { background: 'var(--accent)', color: '#fff' }
              : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            {t.label} <span className="opacity-75">· {counts[t.kind][0]}/{counts[t.kind][1]}</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="pl-8 pr-3 py-1.5 rounded-lg text-sm"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
          />
        </div>
      </div>

      {err && <p className="text-sm" style={{ color: 'var(--danger, #dc2626)' }}>{err}</p>}
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-faint)' }} /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((r) => (
            <LogoRow key={r.name} row={r} url={logos.get(`${r.kind}:${brandKey(r.name)}`) ?? null} empId={employee.id} />
          ))}
          {list.length === 0 && <p className="text-sm" style={{ color: 'var(--text-faint)' }}>Nothing matches.</p>}
        </div>
      )}
    </div>
  );
}

function LogoRow({ row, url, empId }: { row: Candidate; url: string | null; empId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); await loadBrandLogos(true); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      <ShareLogo name={row.name.replace(/mutual fund|limited|ltd\.?/gi, '').trim() || row.name} url={url} size={44} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }} title={row.name}>{row.name}</p>
        <p className="text-xs" style={{ color: err ? 'var(--danger, #dc2626)' : 'var(--text-faint)' }}>
          {err ?? `${row.uses} ${row.kind === 'amc' ? 'scheme' : 'bond'}${row.uses === 1 ? '' : 's'}${url ? '' : ' · no logo'}`}
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void run(() => uploadBrandLogo(row.kind, row.name, f, empId));
        }}
      />
      <button
        disabled={busy}
        onClick={() => input.current?.click()}
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
        style={{ background: 'var(--bg-raised, var(--bg-elevated))', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        title={url ? 'Replace logo' : 'Upload logo'}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : url ? <ImageIcon className="w-3.5 h-3.5" /> : <Upload className="w-3.5 h-3.5" />}
        {url ? 'Replace' : 'Upload'}
      </button>
      {url && (
        <button
          disabled={busy}
          onClick={() => { if (confirm(`Remove the logo for ${row.name}?`)) void run(() => removeBrandLogo(row.kind, row.name)); }}
          className="p-1.5 rounded-lg"
          style={{ color: 'var(--text-faint)' }}
          title="Remove logo"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
