/**
 * Client Management — the bridge between NIYOM's CRM clients and their BSE UCCs.
 *
 * Answers the question staff actually have: "who is on-boarded at BSE, who
 * isn't, and what's stopping them?" Clients are matched to UCCs by PAN (there
 * is no stored link — see ClientBridgeService), and any client whose CRM record
 * is complete can be registered at BSE from here in one step.
 */
import { useMemo, useState } from 'react';
import { ExternalLink, Users } from 'lucide-react';
import { Card } from '../../../portal/components/Card';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { StatusPill } from '../../../portal/components/StatusPill';
import { LogoLoader } from '../../../components/LogoLoader';
import { EmptyState } from '../../../portal/components/EmptyState';
import { ClientBridgeService, type BridgedClient } from '../../services/ClientBridgeService';
import { BseOpsService, isBseConfigured } from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { ConfirmBox, ErrorNote, NotConfigured, SuccessCard, TableScrollX } from './formBits';
import { TH, TD } from './BsePanel';

type Filter = 'all' | 'registered' | 'not_registered';

function uccTone(status: string): 'success' | 'warning' | 'danger' | 'muted' {
  const s = status.toUpperCase();
  if (s === 'ACTIVE') return 'success';
  if (s.includes('REJECT') || s.includes('SUSPEND')) return 'danger';
  if (s.startsWith('PENDING')) return 'warning';
  return 'muted';
}

export function ClientManagementPage() {
  const { data, loading, error, refresh } = useBseData<BridgedClient[]>(() =>
    ClientBridgeService.list(),
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [target, setTarget] = useState<BridgedClient | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<{ clientCode: string; status: string; url?: string } | null>(
    null,
  );

  const rows = data ?? [];
  const registered = rows.filter((r) => r.ucc).length;
  const shown = useMemo(
    () =>
      rows.filter((r) =>
        filter === 'registered' ? r.ucc : filter === 'not_registered' ? !r.ucc : true,
      ),
    [rows, filter],
  );

  const register = async () => {
    if (!target) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await ClientBridgeService.registerAtBse(target.crm);
      // Fetch the investor's approval link straight away — nothing progresses
      // at BSE until they complete it, so staff need it in hand.
      let url: string | undefined;
      try {
        const links = await BseOpsService.uccTwoFaLink(res.clientCode);
        url = links.links?.[0]?.url;
      } catch {
        /* link is best-effort — registration itself succeeded */
      }
      setDone({ clientCode: res.clientCode, status: res.status, url });
      setTarget(null);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Registration failed.');
      setTarget(null);
    } finally {
      setBusy(false);
    }
  };

  if (!isBseConfigured()) return <NotConfigured title="Client Management" />;

  return (
    <div className="space-y-5">
      {done && (
        <SuccessCard title="Client registered at BSE">
          <p className="mt-1 text-sm text-text-secondary">
            UCC <span className="font-mono font-semibold">{done.clientCode}</span> created with
            status {done.status}.
          </p>
          {done.url ? (
            <p className="mt-2 text-xs text-text-secondary">
              The investor must approve this link before verification starts:{' '}
              <a
                href={done.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
              >
                Open 2FA link <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          ) : (
            <p className="mt-2 text-xs text-text-secondary">
              Generate the investor’s 2FA link from UCC Management to continue onboarding.
            </p>
          )}
        </SuccessCard>
      )}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeader title="Client Management" icon={Users} />
          <div className="flex gap-1.5">
            {(
              [
                ['all', `All (${rows.length})`],
                ['registered', `At BSE (${registered})`],
                ['not_registered', `Not registered (${rows.length - registered})`],
              ] as [Filter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`rounded-token-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filter === key
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-bg-surface text-text-secondary hover:text-accent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="flex min-h-[240px] items-center justify-center">
            <LogoLoader size={44} />
          </div>
        )}

        {!loading && error && <ErrorNote title="Couldn’t load clients." message={error} />}
        {!loading && actionError && (
          <ErrorNote title="Registration failed." message={actionError} />
        )}

        {!loading && !error && shown.length === 0 && (
          <EmptyState icon={Users} title="No clients in this view." compact />
        )}

        {!loading && !error && shown.length > 0 && (
          <>
            <TableScrollX>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <TH>Client</TH>
                    <TH>PAN</TH>
                    <TH>Onboarding</TH>
                    <TH>BSE UCC</TH>
                    <TH>Status</TH>
                    <TH right>Action</TH>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.crm.id} className="hover:bg-bg-base/50">
                      <TD>
                        <span className="font-medium">{r.crm.full_name || '—'}</span>
                        <span className="ml-1.5 font-mono text-text-faint">{r.crm.client_code}</span>
                      </TD>
                      <TD>
                        <span className="font-mono">{r.crm.pan || '—'}</span>
                      </TD>
                      <TD>{r.crm.onboarding_status?.replace(/_/g, ' ') || '—'}</TD>
                      <TD>
                        {r.ucc ? (
                          <>
                            <span className="font-mono">{r.ucc.clientCode}</span>
                            {r.linkedByPan && (
                              // Inferred, not stored — flagged so a wrong PAN
                              // match is visible rather than silently trusted.
                              <span
                                className="ml-1.5 cursor-help text-[10px] text-warning"
                                title="Matched by PAN, not a stored link. Saving it now — refresh to confirm."
                              >
                                ~PAN
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-text-faint">—</span>
                        )}
                      </TD>
                      <TD>
                        {r.ucc ? (
                          <StatusPill tone={uccTone(r.ucc.status)}>{r.ucc.status}</StatusPill>
                        ) : (
                          <StatusPill tone="muted">Not registered</StatusPill>
                        )}
                      </TD>
                      <TD right>
                        {r.ucc ? (
                          <span className="text-text-faint">—</span>
                        ) : r.canRegister ? (
                          <button
                            type="button"
                            onClick={() => {
                              setDone(null);
                              setActionError(null);
                              setTarget(r);
                            }}
                            className="rounded-token-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20"
                          >
                            Register at BSE
                          </button>
                        ) : (
                          <span
                            className="cursor-help text-[11px] text-warning"
                            title={`Missing: ${r.missing.join(', ')}`}
                          >
                            Missing {r.missing.length} field{r.missing.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScrollX>
            <p className="mt-3 text-[11px] text-text-faint">
              {rows.length} client{rows.length === 1 ? '' : 's'} · {registered} registered at BSE ·
              matched by PAN
            </p>
          </>
        )}
      </Card>

      {target && (
        <Card padding="lg">
          <ConfirmBox
            rows={[
              { label: 'Client', value: `${target.crm.full_name} (${target.crm.client_code})` },
              { label: 'PAN', value: target.crm.pan.toUpperCase() },
              { label: 'Date of birth', value: target.crm.dob },
              { label: 'Email', value: target.crm.email },
              { label: 'Mobile', value: target.crm.phone },
              {
                label: 'Bank',
                value: `${target.crm.bank_ifsc.toUpperCase()} · ${target.crm.bank_account}`,
              },
              {
                label: 'Address',
                value: `${target.crm.city}, ${target.crm.state} ${target.crm.pincode}`,
              },
            ]}
            note="This registers the client at BSE StAR MF as a physical, resident-individual UCC. The investor must then approve a 2FA link before KYC and PAN verification begin."
            busy={busy}
            submitLabel="Register at BSE"
            onBack={() => setTarget(null)}
            onConfirm={register}
          />
        </Card>
      )}
    </div>
  );
}
