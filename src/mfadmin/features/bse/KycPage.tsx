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
import { Card } from '../../../portal/components/Card';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { StatusPill } from '../../../portal/components/StatusPill';
import { LogoLoader } from '../../../components/LogoLoader';
import {
  BseOpsService,
  isBseConfigured,
  type BseUccRow,
  type UccCheck,
  type UccDetail,
} from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { ErrorNote, NotConfigured } from './formBits';

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

  if (!isBseConfigured()) return <NotConfigured title="KYC" />;

  const rows = uccs.data ?? [];

  return (
    <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
      {/* Client list */}
      <Card>
        <SectionHeader title="Clients" icon={ShieldCheck} />
        {uccs.loading && (
          <div className="flex min-h-[200px] items-center justify-center">
            <LogoLoader size={36} />
          </div>
        )}
        {!uccs.loading && uccs.error && (
          <ErrorNote title="Couldn’t load from BSE." message={uccs.error} />
        )}
        {!uccs.loading && !uccs.error && (
          <ul className="-mx-2 max-h-[560px] space-y-0.5 overflow-y-auto px-2">
            {rows.map((u) => {
              const active = u.status.toUpperCase() === 'ACTIVE';
              return (
                <li key={u.clientCode}>
                  <button
                    type="button"
                    onClick={() => setSelected(u.clientCode)}
                    className={`flex w-full items-center gap-2 rounded-token-md px-2.5 py-2 text-left transition-colors ${
                      selected === u.clientCode ? 'bg-accent/10' : 'hover:bg-bg-base/60'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        active ? 'bg-success' : 'bg-warning'
                      }`}
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
      </Card>

      {/* Verification detail */}
      <Card>
        <SectionHeader title={selected ? `Verification · ${selected}` : 'Verification'} icon={ShieldCheck} />

        {loadingDetail && (
          <div className="flex min-h-[240px] items-center justify-center">
            <LogoLoader size={44} />
          </div>
        )}
        {!loadingDetail && detailError && (
          <ErrorNote title="Couldn’t load verification detail." message={detailError} />
        )}

        {!loadingDetail && !detailError && detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill tone={detail.transactionReady ? 'success' : 'warning'}>
                {detail.transactionReady ? 'Able to transact' : 'Not transaction-ready'}
              </StatusPill>
              <StatusPill tone="muted">{detail.status}</StatusPill>
              {detail.pan && <span className="font-mono text-xs text-text-secondary">{detail.pan}</span>}
              {detail.mode && <span className="text-xs text-text-faint">{detail.mode}</span>}
            </div>

            {detail.blockedBy.length > 0 ? (
              <div className="rounded-token-md border border-warning/20 bg-warning/10 p-3 text-xs text-warning">
                <p className="font-semibold">
                  Blocked by: {detail.blockedBy.join(', ')}
                </p>
                {detail.transactionReadyReason && (
                  <p className="mt-0.5 opacity-90">{detail.transactionReadyReason}</p>
                )}
              </div>
            ) : (
              <div className="rounded-token-md border border-success/20 bg-success/10 p-3 text-xs text-success">
                All blocking checks have passed.
              </div>
            )}

            <ul className="divide-y divide-border/60">
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
                    {c.reason && <span className="mt-0.5 block text-[11px] text-text-secondary">{c.reason}</span>}
                  </span>
                  <span className="shrink-0 text-[10px] text-text-faint">{c.at ? c.at.slice(0, 10) : ''}</span>
                </li>
              ))}
            </ul>

            {/* The investor's own step — surfaced when authorisation is outstanding. */}
            {!detail.transactionReady && (
              <div className="border-t border-border pt-4">
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
                  <button
                    type="button"
                    onClick={fetchLink}
                    disabled={linkBusy}
                    className="rounded-token-md border border-border bg-bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:text-accent disabled:opacity-50"
                  >
                    {linkBusy ? 'Fetching…' : 'Get investor 2FA link'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {!loadingDetail && !detailError && !detail && (
          <p className="py-12 text-center text-sm text-text-secondary">
            Select a client to see their verification status.
          </p>
        )}
      </Card>
    </div>
  );
}
