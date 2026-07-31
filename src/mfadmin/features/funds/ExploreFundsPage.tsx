/**
 * Explore Funds — scheme discovery off BSE's live scheme master.
 *
 * Filters mirror what BSE actually returns per scheme, not a wishlist: AMC,
 * category, transaction mode and whether the scheme is open. There are no
 * return figures anywhere on this screen because `master_scheme_list` carries
 * none — showing a CAGR here would mean sourcing it from somewhere BSE has not
 * told us, on the same screen staff use to place real orders.
 */
import { useMemo, useState } from 'react';
import { Compass, Filter, ShoppingCart, CalendarClock } from 'lucide-react';
import { BseOpsService, isBseConfigured, type BseSchemeRow } from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { Chip, PageHead, Panel } from '../../ui/Surface';
import { Button, ErrorBlock, Loading, Segmented, fieldCls } from '../../ui/controls';
import { NotConfigured } from '../bse/formBits';
import { inr } from '../../ui/format';
import type { AdminView } from '../../layout/adminNav';

type ModeFilter = 'all' | 'physical' | 'demat';

export function ExploreFundsPage({ onNavigate }: { onNavigate?: (v: AdminView) => void }) {
  const schemes = useBseData<BseSchemeRow[]>(() => BseOpsService.schemes(2000));
  const [term, setTerm] = useState('');
  const [amc, setAmc] = useState('');
  const [category, setCategory] = useState('');
  const [mode, setMode] = useState<ModeFilter>('physical');
  const [openOnly, setOpenOnly] = useState(true);
  const [limit, setLimit] = useState(24);

  const all = useMemo(() => schemes.data ?? [], [schemes.data]);

  const amcs = useMemo(
    () => [...new Set(all.map((s) => s.amc).filter(Boolean))].sort(),
    [all],
  );
  const categories = useMemo(
    () => [...new Set(all.map((s) => s.category).filter(Boolean))].sort(),
    [all],
  );

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return all.filter((s) => {
      if (openOnly && !s.isOpen) return false;
      if (mode === 'physical' && !s.allowsPhysical) return false;
      if (mode === 'demat' && !s.allowsDemat) return false;
      if (amc && s.amc !== amc) return false;
      if (category && s.category !== category) return false;
      if (q && !`${s.name} ${s.schemeCode} ${s.amc}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, term, amc, category, mode, openOnly]);

  if (!isBseConfigured()) return <NotConfigured title="Explore Funds" />;

  return (
    <>
      <PageHead
        title="Explore Funds"
        subtitle="BSE's live scheme master. Only schemes BSE marks open and tradable in the selected mode."
        actions={
          <Chip tone="info">
            {schemes.loading ? 'Loading…' : `${filtered.length.toLocaleString('en-IN')} schemes`}
          </Chip>
        }
      />

      <Panel className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <label className="mb-1.5 block text-[11px] font-semibold text-text-primary">
              Search
            </label>
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Scheme name, BSE code or AMC"
              className={fieldCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-text-primary">AMC</label>
            <select value={amc} onChange={(e) => setAmc(e.target.value)} className={fieldCls}>
              <option value="">All AMCs</option>
              {amcs.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold text-text-primary">
              Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={fieldCls}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-3">
          <Filter className="h-3.5 w-3.5 text-text-faint" />
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'physical', label: 'Physical' },
              { value: 'demat', label: 'Demat' },
              { value: 'all', label: 'Both' },
            ]}
          />
          <label className="flex items-center gap-2 text-[11px] text-text-secondary">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
            />
            Open for subscription only
          </label>
          {(term || amc || category) && (
            <button
              type="button"
              onClick={() => {
                setTerm('');
                setAmc('');
                setCategory('');
              }}
              className="ml-auto text-[11px] font-semibold text-accent hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </Panel>

      {schemes.loading && <Loading label="Loading BSE's scheme master…" />}
      {!schemes.loading && schemes.error && (
        <ErrorBlock message={schemes.error} onRetry={schemes.refresh} />
      )}

      {!schemes.loading && !schemes.error && (
        <>
          {filtered.length === 0 ? (
            <Panel className="py-14 text-center">
              <Compass className="mx-auto mb-3 h-7 w-7 text-text-faint" />
              <p className="text-sm font-semibold text-text-primary">No schemes match</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-text-faint">
                Widen the filters — a physical UCC cannot trade demat-only schemes, which rules out
                a large part of the master.
              </p>
            </Panel>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.slice(0, limit).map((s) => (
                  <SchemeCard key={s.schemeCode} scheme={s} onNavigate={onNavigate} />
                ))}
              </div>
              {filtered.length > limit && (
                <div className="mt-5 text-center">
                  <Button onClick={() => setLimit((l) => l + 24)}>
                    Show more ({(filtered.length - limit).toLocaleString('en-IN')} remaining)
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

function SchemeCard({
  scheme,
  onNavigate,
}: {
  scheme: BseSchemeRow;
  onNavigate?: (v: AdminView) => void;
}) {
  const min = scheme.purchase?.min || scheme.minLumpsum;
  return (
    <article className="flex flex-col rounded-token-lg border border-border-subtle bg-card p-4 transition-colors hover:border-border-strong">
      <div className="flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">
          {scheme.amc || '—'}
        </p>
        <h3 className="mt-1 line-clamp-2 text-[13px] font-semibold leading-snug text-text-primary">
          {scheme.name}
        </h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {scheme.category && <Chip>{scheme.category}</Chip>}
          {scheme.allowsPhysical && <Chip tone="info">Physical</Chip>}
          {scheme.allowsDemat && <Chip tone="neutral">Demat</Chip>}
          {!scheme.isOpen && <Chip tone="danger">Closed</Chip>}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border-subtle pt-3 text-[11px]">
        <dt className="text-text-faint">BSE code</dt>
        <dd className="text-right font-mono font-semibold text-text-primary">{scheme.schemeCode}</dd>
        <dt className="text-text-faint">Min lumpsum</dt>
        <dd className="text-right font-semibold tabular-nums text-text-primary">
          {min > 0 ? inr(min) : '—'}
        </dd>
        {scheme.purchase?.minAdditional ? (
          <>
            <dt className="text-text-faint">Multiples of</dt>
            <dd className="text-right font-semibold tabular-nums text-text-primary">
              {inr(scheme.purchase.minAdditional)}
            </dd>
          </>
        ) : null}
      </dl>

      {onNavigate && scheme.isOpen && scheme.allowsPhysical && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button icon={ShoppingCart} onClick={() => onNavigate('purchase')}>
            Lumpsum
          </Button>
          <Button icon={CalendarClock} onClick={() => onNavigate('sip')}>
            SIP
          </Button>
        </div>
      )}
    </article>
  );
}
