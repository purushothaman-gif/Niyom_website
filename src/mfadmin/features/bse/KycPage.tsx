/**
 * KYC — the verification board for every UCC.
 *
 * Answers the question that otherwise costs an afternoon: "why isn't this
 * client able to transact yet?" BSE runs several checks per holder and buries
 * them inside ucc_status_object; the proxy flattens them and marks which ones
 * actually gate activation. Bank verification and FATCA are shown but marked
 * non-blocking, because per BSE's own webhook docs neither prevents a UCC going
 * ACTIVE — chasing them wastes time.
 */
import { useEffect, useState } from 'react';
import { Check, ChevronRight, ExternalLink, Minus, ShieldCheck, X } from 'lucide-react';
import {
  BseOpsService,
  isBseConfigured,
  type BseUccRow,
  type UccCheck,
  type UccDetail,
} from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { Chip, PageHead, Panel, PanelHead } from '../../ui/Surface';
import { Button, ErrorBlock, Loading } from '../../ui/controls';
import { NotConfigured } from './formBits';
import { shortDate } from '../../../lib/money';

function CheckIcon({ state }: { state: UccCheck['state'] }) {
  if (state === 'pass') return <Check className="h-3.5 w-3.5 text-success" />;
  if (state === 'fail') return <X className="h-3.5 w-3.5 text-danger" />;
  return <Minus className="h-3.5 w-3.5 text-text-faint" />;
}

export function KycPage() {
  const uccs = useBseData<BseUccRow[]>(() => BseOpsService.uccs());
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<UccDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [filter, setFilter] = useState('');

  // Default to the first client that isn't yet transaction-ready — that's who
  // staff are actually here to look at.
  useEffect(() => {
    if (!selected && uccs.data?.length) {
      const stuck = uccs.data.find((u) => u.status.toUpperCase() !== 'ACTIVE');
      setSelected((stuck ?? uccs.data[0]).clientCode);
    }
  }, [uccs.data, selected]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setLoadingDetail(true);
    setDetailError(null);
    setLink(null);
    BseOpsService.uccDetail(selected)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setDetailError(e instanceof Error ? e.message : 'Could not load.'))
      .finally(() => alive && setLoadingDetail(false));
    return () => {
      alive = false;
    };
  }, [selected]);

  const fetchLink = async () => {
    if (!selected) return;
    setLinkBusy(true);
    try {
      const res = await BseOpsService.uccTwoFaLink(selected);
      setLink(res.links?.[0]?.url ?? null);
    } catch {
      setLink(null);
    } finally {
      setLinkBusy(false);
    }
  };

  const all = uccs.data ?? [];
  const q = filter.trim().toLowerCase();
  const rows = q
    ? all.filter((u) => `${u.name} ${u.clientCode} ${u.pan}`.toLowerCase().includes(q))
    : all;
  const blocked = all.filter((u) => u.status.toUpperCase() !== 'ACTIVE').length;

  if (!isBseConfigured()) return <NotConfigured title="KYC & Verification" />;

  return (
    <>
      <PageHead
        title="KYC & Verification"
        subtitle={
          // "All clear" would be a lie when the list simply hasn't loaded or
          // nobody is registered yet — those are different states.
          all.length === 0
            ? 'No clients registered at BSE yet.'
            : blocked > 0
              ? `${blocked} client${blocked === 1 ? '' : 's'} cannot transact yet — select one to see what is blocking it.`
              : 'Every registered client has cleared BSE’s blocking checks.'
        }
      />

      <div className="grid gap-5 lg:grid-cols-[290px_minmax(0,1fr)]">
        {/* Client list */}
        <Panel flush>
          <div className="border-b border-border-subtle p-3">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter clients…"
              className="w-full rounded-token-md border border-border bg-bg-base px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-accent placeholder:text-text-faint"
            />
          </div>

          {uccs.loading && <Loading />}
          {!uccs.loading && uccs.error && (
            <div className="p-3">
              <ErrorBlock message={uccs.error} onRetry={uccs.refresh} />
            </div>
          )}
          {!uccs.loading && !uccs.error && (
            <ul className="max-h-[600px] overflow-y-auto p-2">
              {rows.length === 0 && (
                <li className="px-2 py-8 text-center text-xs text-text-faint">
                  {all.length === 0 ? 'No clients registered at BSE yet.' : 'No client matches.'}
                </li>
              )}
              {rows.map((u) => {
                const active = u.status.toUpperCase() === 'ACTIVE';
                return (
                  <li key={u.clientCode}>
                    <button
                      type="button"
                      onClick={() => setSelected(u.clientCode)}
                      className={`flex w-full items-center gap-2.5 rounded-token-md px-2.5 py-2 text-left transition-colors ${
                        selected === u.clientCode ? 'bg-accent/10' : 'hover:bg-bg-surface'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          active ? 'bg-success' : 'bg-warning'
                        }`}
                        title={active ? 'Able to transact' : 'Not transaction-ready'}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-text-primary">
                          {u.name?.trim() || u.clientCode}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-text-faint">
                          {u.clientCode}
                        </span>
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* Verification detail */}
        <Panel>
          <PanelHead
            title={selected ? `Verification · ${selected}` : 'Verification'}
            icon={ShieldCheck}
          />

          {loadingDetail && <Loading label="Reading verification state from BSE…" />}
          {!loadingDetail && detailError && <ErrorBlock message={detailError} />}

          {!loadingDetail && !detailError && detail && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone={detail.transactionReady ? 'success' : 'warning'}>
                  {detail.transactionReady ? 'Able to transact' : 'Not transaction-ready'}
                </Chip>
                <Chip>{detail.status}</Chip>
                {detail.pan && (
                  <span className="font-mono text-xs text-text-secondary">{detail.pan}</span>
                )}
                {detail.mode && <span className="text-xs text-text-faint">{detail.mode}</span>}
              </div>

              {detail.blockedBy.length > 0 ? (
                <div className="rounded-token-md border border-warning/20 bg-warning/10 p-3 text-xs text-warning">
                  <p className="font-semibold">Blocked by: {detail.blockedBy.join(', ')}</p>
                  {detail.transactionReadyReason && (
                    <p className="mt-0.5 opacity-90">{detail.transactionReadyReason}</p>
                  )}
                </div>
              ) : (
                <div className="rounded-token-md border border-success/20 bg-success/10 p-3 text-xs text-success">
                  All blocking checks have passed.
                </div>
              )}

              <ul className="divide-y divide-border-subtle">
                {detail.checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-3 py-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-base">
                      <CheckIcon state={c.state} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-text-primary">{c.label}</span>
                        {!c.blocking && (
                          <span className="rounded bg-bg-base px-1.5 py-0.5 text-[10px] text-text-faint">
                            doesn’t block activation
                          </span>
                        )}
                      </span>
                      {c.reason && (
                        <span className="mt-0.5 block text-[11px] text-text-secondary">
                          {c.reason}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[10px] text-text-faint">
                      {c.at ? shortDate(c.at) : ''}
                    </span>
                  </li>
                ))}
              </ul>

              {/* The investor's own step — surfaced when authorisation is outstanding. */}
              {!detail.transactionReady && (
                <div className="border-t border-border-subtle pt-4">
                  {link ? (
                    <p className="text-xs text-text-secondary">
                      Send the investor this approval link:{' '}
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
                      >
                        Open 2FA link <ExternalLink className="h-3 w-3" />
                      </a>
                    </p>
                  ) : (
                    <Button onClick={fetchLink} disabled={linkBusy}>
                      {linkBusy ? 'Fetching…' : 'Get investor 2FA link'}
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}

          {!loadingDetail && !detailError && !detail && (
            <p className="py-14 text-center text-sm text-text-secondary">
              Select a client to see their verification status.
            </p>
          )}
        </Panel>
      </div>
    </>
  );
}
