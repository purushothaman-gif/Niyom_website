/**
 * Scheme NAV — latest published NAVs.
 *
 * This screen previously claimed NAVs were unavailable ("the proxy does not
 * expose nav_master_list yet"). That stopped being true once the NAV refresh
 * job started populating nav_daily, and the message stayed — telling staff a
 * capability did not exist while 41,000 NAVs sat in the database.
 *
 * Reads Supabase directly rather than going through the BSE proxy: nav_daily
 * is ours, refreshed on a schedule, and routing a lookup through BSE would make
 * the screen fail whenever BSE does.
 *
 * The day change is only shown for schemes that actually have a prior NAV in
 * the table. Coverage is uneven — every scheme has a latest NAV, about two
 * thirds have any history at all — so the alternative would be printing 0.00%
 * for a scheme we simply have not seen twice, which reads as "flat" rather than
 * "unknown".
 */
import { useEffect, useMemo, useState } from 'react';
import { LineChart, RefreshCw } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { Chip, PageHead, StatTile } from '../../ui/Surface';
import { DataTable, type Column } from '../../ui/DataTable';
import { Button, ErrorBlock, Loading, fieldCls } from '../../ui/controls';
import { num, pct, shortDate } from '../../../lib/money';

interface NavRow {
  isin: string;
  amfiCode: string;
  schemeName: string;
  nav: number;
  navDate: string;
  /** Null when we have no earlier NAV for this scheme — not the same as zero. */
  changePercent: number | null;
}

/** Two most recent rows per scheme is enough for latest + day change. */
const FETCH_LIMIT = 4000;

export function SchemeNavPage() {
  const [rows, setRows] = useState<NavRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);

    void (async () => {
      // nav_daily is readable only by an authenticated role, and RLS returns an
      // EMPTY SET rather than an error when the session has lapsed. Without this
      // check the screen would blame the refresh job for what is actually an
      // expired login — the proxy-backed screens get a clean 401 instead.
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        if (!alive) return;
        setError('Your session has expired — please sign in again.');
        setRows([]);
        return;
      }

      const query = supabase
        .from('nav_daily')
        .select('isin,amfi_code,scheme_name,nav,nav_date')
        .order('nav_date', { ascending: false })
        .limit(FETCH_LIMIT);

      const search = term.trim();
      // Server-side filter when searching: 17k schemes will not fit in a page,
      // so a client-side filter would quietly search only the newest slice.
      const { data, error: err } = await (search.length >= 2
        ? query.or(`scheme_name.ilike.%${search}%,isin.ilike.%${search}%,amfi_code.ilike.%${search}%`)
        : query);

      if (!alive) return;
      if (err) {
        setError(err.message);
        setRows([]);
        return;
      }

      // Rows arrive newest-first, so the first sighting of an ISIN is its
      // latest NAV and the second is the one to compare against.
      const latest = new Map<string, NavRow>();
      const previous = new Map<string, number>();
      for (const r of (data ?? []) as Record<string, unknown>[]) {
        const isin = String(r.isin ?? '');
        if (!isin) continue;
        const nav = Number(r.nav ?? 0);
        if (!latest.has(isin)) {
          latest.set(isin, {
            isin,
            amfiCode: String(r.amfi_code ?? ''),
            schemeName: String(r.scheme_name ?? ''),
            nav,
            navDate: String(r.nav_date ?? ''),
            changePercent: null,
          });
        } else if (!previous.has(isin)) {
          previous.set(isin, nav);
        }
      }
      for (const [isin, prior] of previous) {
        const row = latest.get(isin);
        if (row && prior > 0) row.changePercent = ((row.nav - prior) / prior) * 100;
      }
      setRows([...latest.values()].sort((a, b) => a.schemeName.localeCompare(b.schemeName)));
    })();

    return () => {
      alive = false;
    };
  }, [term, reloadKey]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    const dated = list.map((r) => r.navDate).filter(Boolean).sort();
    return {
      schemes: list.length,
      withChange: list.filter((r) => r.changePercent !== null).length,
      latest: dated.length ? dated[dated.length - 1] : '',
    };
  }, [rows]);

  const cols: Column<NavRow>[] = [
    {
      key: 'scheme',
      header: 'Scheme',
      value: (r) => r.schemeName,
      render: (r) => (
        <div className="min-w-0">
          <p className="line-clamp-2 font-medium text-text-primary">{r.schemeName || '—'}</p>
          <p className="font-mono text-[10px] text-text-faint">
            {r.isin}
            {r.amfiCode ? ` · AMFI ${r.amfiCode}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'nav',
      header: 'NAV',
      numeric: true,
      value: (r) => r.nav,
      render: (r) => <span className="font-semibold text-text-primary">{num(r.nav, 4)}</span>,
    },
    {
      key: 'change',
      header: 'Day change',
      numeric: true,
      value: (r) => r.changePercent ?? -Infinity,
      render: (r) =>
        r.changePercent === null ? (
          <span className="text-text-faint" title="No earlier NAV on file for this scheme">
            —
          </span>
        ) : (
          <span className={r.changePercent >= 0 ? 'text-success' : 'text-danger'}>
            {pct(r.changePercent)}
          </span>
        ),
    },
    {
      key: 'navDate',
      header: 'As on',
      align: 'right',
      value: (r) => r.navDate,
      render: (r) => <span className="whitespace-nowrap text-text-faint">{shortDate(r.navDate)}</span>,
    },
  ];

  return (
    <>
      <PageHead
        title="Scheme NAV"
        subtitle="Latest published NAVs, refreshed on a schedule into our own store rather than fetched from BSE per lookup."
        actions={
          <Button icon={RefreshCw} onClick={() => setReloadKey((k) => k + 1)}>
            Refresh
          </Button>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Schemes shown" value={rows === null ? '—' : num(stats.schemes)} icon={LineChart} />
        <StatTile
          label="With a day change"
          value={rows === null ? '—' : num(stats.withChange)}
          sub="the rest have only one NAV on file"
        />
        <StatTile label="Latest NAV date" value={stats.latest ? shortDate(stats.latest) : '—'} />
      </div>

      <div className="mb-4">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search 17,000+ schemes by name, ISIN or AMFI code…"
          className={fieldCls}
        />
        <p className="mt-1.5 text-[11px] text-text-faint">
          {term.trim().length >= 2 ? (
            <>Searching every scheme.</>
          ) : (
            <>
              Showing the most recently published NAVs. Type at least two characters to search the
              full set — <Chip>17,662 schemes</Chip> is more than one page can hold.
            </>
          )}
        </p>
      </div>

      {rows === null && <Loading label="Loading NAVs…" />}
      {rows !== null && error && <ErrorBlock message={error} onRetry={() => setReloadKey((k) => k + 1)} />}
      {rows !== null && !error && (
        <DataTable
          rows={rows}
          columns={cols}
          rowKey={(r) => r.isin}
          searchable={false}
          empty={{
            title: term.trim() ? 'No scheme matches that' : 'No NAVs loaded yet',
            hint: term.trim()
              ? 'Try the ISIN or the AMFI code — scheme names vary between sources.'
              : 'The NAV refresh job populates this. If it stays empty, check the job on the droplet.',
          }}
        />
      )}
    </>
  );
}
