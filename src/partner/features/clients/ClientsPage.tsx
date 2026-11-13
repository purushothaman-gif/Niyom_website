import { useEffect, useMemo, useRef, useState } from 'react';
import { Users, ChevronDown, ChevronRight, Loader2, UserPlus, Repeat } from 'lucide-react';
import { Card } from '../../../portal/components/Card';
import { EmptyState } from '../../../portal/components/EmptyState';
import { StatusPill } from '../../../portal/components/StatusPill';
import { fmt, PRODUCT_LABELS } from '../../../crm/utils';
import { PartnerService } from '../../services/PartnerService';
import { OnboardClientModal } from './OnboardClientModal';
import { mfSsoEnabled } from '../../../../shared/platform/env';
import { fromPartnerHoldings } from '../../../../shared/portal/investments/model';
import { InvestmentsBoard } from '../../../portal/features/investments/InvestmentsBoard';
import { useInvestmentRows } from '../../../portal/features/investments/useInvestmentRows';
import type {
  PartnerClientRow,
  PartnerHoldingRow,
  PartnerSipRow,
  PartnerTransactionRow,
} from '../../types';
import type { ProductType } from '../../../crm/types';

interface Props {
  clients: PartnerClientRow[];
  /** Refresh the portal snapshot after a new client is onboarded. */
  onOnboarded: () => void;
}

const productLabel = (t: string) => PRODUCT_LABELS[t as ProductType] ?? t;

/** MONTHLY -> Monthly; leaves short all-caps plan codes (SIP/STP/SWP) alone. */
const titleCase = (s: string | null | undefined) =>
  !s ? '' : s.length <= 3 ? s : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

const sipStatusTone = (status: string): 'success' | 'warning' | 'muted' => {
  const s = (status || '').toLowerCase();
  if (s === 'active') return 'success';
  if (s === 'paused') return 'warning';
  return 'muted';
};

/**
 * Clients this partner sourced, each expandable to their complete portfolio.
 *
 * The list itself comes from the snapshot; the portfolio and transactions are
 * fetched on expand (nw_partner_client_portfolio / _transactions), which
 * independently re-check that the client belongs to this partner — so a guessed
 * client id returns nothing even with a valid partner session.
 */
export function ClientsPage({ clients, onOnboarded }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showOnboard, setShowOnboard] = useState(false);

  const onboardBtn = (
    <button
      type="button"
      onClick={() => setShowOnboard(true)}
      className="inline-flex items-center gap-2 rounded-token-md px-4 py-2.5 text-sm font-bold text-on-accent"
      style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
    >
      <UserPlus className="h-4 w-4" /> Onboard a client
    </button>
  );

  const modal = showOnboard && (
    <OnboardClientModal
      onClose={() => setShowOnboard(false)}
      onOnboarded={() => { setShowOnboard(false); onOnboarded(); }}
    />
  );

  if (clients.length === 0) {
    return (
      <>
        <Card>
          <EmptyState
            icon={Users}
            title="No clients sourced yet"
            hint="Onboard a client to map them under you, or they'll appear here once they complete onboarding."
          />
          <div className="flex justify-center pb-6">{onboardBtn}</div>
        </Card>
        {modal}
      </>
    );
  }

  const totalInvested = clients.reduce((s, c) => s + Number(c.invested_amount || 0), 0);
  const totalValue = clients.reduce((s, c) => s + Number(c.current_value || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-lg font-bold text-text-primary">My Clients</h1>
        {onboardBtn}
      </div>

      <Card padding="md">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
          <span className="text-text-muted">
            <span className="font-semibold text-text-primary">{clients.length}</span> clients
          </span>
          <span className="text-text-muted">
            Invested <span className="font-semibold text-text-primary">{fmt(totalInvested)}</span>
          </span>
          <span className="text-text-muted">
            Current value{' '}
            <span
              className="font-semibold"
              style={{ color: totalValue >= totalInvested ? 'var(--success)' : 'var(--danger)' }}
            >
              {fmt(totalValue)}
            </span>
          </span>
        </div>
      </Card>

      <div className="space-y-3">
        {clients.map((c) => (
          <ClientRow
            key={c.client_id}
            client={c}
            open={openId === c.client_id}
            onToggle={() => setOpenId((id) => (id === c.client_id ? null : c.client_id))}
          />
        ))}
      </div>

      {modal}
    </div>
  );
}

function ClientRow({
  client,
  open,
  onToggle,
}: {
  client: PartnerClientRow;
  open: boolean;
  onToggle: () => void;
}) {
  const [holdings, setHoldings] = useState<PartnerHoldingRow[] | null>(null);
  const [txns, setTxns] = useState<PartnerTransactionRow[] | null>(null);
  const [sips, setSips] = useState<PartnerSipRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  // The fetch is guarded by a ref, not by `holdings`, and `holdings` is NOT a
  // dependency. It used to be both: setHoldings then re-ran this effect, whose
  // cleanup set cancelled = true before the .finally() microtask got there, so
  // setLoading(false) was skipped and the row span the spinner forever with the
  // portfolio already in state behind it.
  const fetched = useRef(false);

  useEffect(() => {
    if (!open || fetched.current) return;
    fetched.current = true;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      PartnerService.getClientPortfolio(client.client_id),
      PartnerService.getClientTransactions(client.client_id),
      PartnerService.getClientSips(client.client_id),
    ])
      .then(([h, t, s]) => {
        if (cancelled) return;
        setHoldings(h);
        setTxns(t);
        setSips(s);
      })
      .catch(() => {
        if (cancelled) return;
        setHoldings([]);
        setTxns([]);
        setSips([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, client.client_id]);

  const gain = Number(client.current_value || 0) - Number(client.invested_amount || 0);

  return (
    <Card padding="none">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-hover sm:p-5"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-text-primary">{client.full_name}</p>
            <StatusPill tone={client.onboarding_status === 'active' ? 'success' : 'warning'}>
              {client.onboarding_status || 'pending'}
            </StatusPill>
          </div>
          <p className="mt-0.5 text-[11px] text-text-secondary">
            <span className="font-mono">{client.client_code}</span>
            {client.city && <> · {client.city.trim()}</>}
            {client.mobile_masked && <> · {client.mobile_masked}</>}
          </p>
        </div>

        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-xs text-text-muted">Invested</p>
          <p className="text-sm font-semibold text-text-primary">
            {fmt(Number(client.invested_amount || 0))}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-text-muted">Value</p>
          <p
            className="text-sm font-semibold"
            style={{ color: gain >= 0 ? 'var(--success)' : 'var(--danger)' }}
          >
            {fmt(Number(client.current_value || 0))}
          </p>
        </div>
      </button>

      {open && (
        <div className="border-t border-border-subtle p-4 sm:p-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading portfolio…
            </div>
          ) : (
            <div className="space-y-6">
              <section>
                {holdings && holdings.length > 0 ? (
                  <ClientBoard holdings={holdings} />
                ) : (
                  <EmptyState icon={Users} title="No holdings recorded" compact />
                )}
              </section>

              {sips && sips.length > 0 && (
                <section>
                  <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    <Repeat className="h-3.5 w-3.5 text-text-muted" /> Systematic plans
                  </p>
                  <div className="m-table-wrap overflow-x-auto">
                    <table className="m-table w-full min-w-[580px] text-sm">
                      <thead>
                        <tr className="border-b border-border-subtle text-[11px] uppercase tracking-wider text-text-faint">
                          <th className="pb-2 text-left font-semibold">Scheme</th>
                          <th className="pb-2 text-left font-semibold">Plan</th>
                          <th className="pb-2 text-right font-semibold">Instalment</th>
                          <th className="pb-2 text-left font-semibold">Frequency</th>
                          <th className="pb-2 text-left font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle">
                        {sips.map((s) => (
                          <tr key={s.sip_id}>
                            <td data-primary className="py-2.5 pr-3">
                              <p className="font-medium text-text-primary">{s.scheme_name}</p>
                              {(s.from_date || s.to_date) && (
                                <p className="text-[11px] text-text-secondary">
                                  {s.from_date || '—'}
                                  {s.to_date ? ` → ${s.to_date}` : ''}
                                </p>
                              )}
                            </td>
                            <td data-label="Plan" className="py-2.5 pr-3">
                              <span className="text-text-secondary">{s.txn_type || 'SIP'}</span>
                              {s.sip_day && (
                                <p className="text-[11px] text-text-faint">Day {s.sip_day}</p>
                              )}
                            </td>
                            <td data-label="Instalment" className="py-2.5 pr-3 text-right tabular-nums font-medium text-text-primary">
                              {s.amount != null ? fmt(Number(s.amount)) : '—'}
                            </td>
                            <td data-label="Frequency" className="py-2.5 pr-3 text-text-secondary">
                              {s.frequency || '—'}
                            </td>
                            <td data-label="Status" className="py-2.5">
                              <StatusPill tone={sipStatusTone(s.status)}>
                                {titleCase(s.status) || 'Active'}
                              </StatusPill>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {txns && txns.length > 0 && (
                <section>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    Transactions
                  </p>
                  <div className="m-table-wrap overflow-x-auto">
                    <table className="m-table w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="border-b border-border-subtle text-[11px] uppercase tracking-wider text-text-faint">
                          <th className="pb-2 text-left font-semibold">Date</th>
                          <th className="pb-2 text-left font-semibold">Product</th>
                          <th className="pb-2 text-left font-semibold">Type</th>
                          <th className="pb-2 text-right font-semibold">Qty</th>
                          <th className="pb-2 text-right font-semibold">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle">
                        {txns.map((t) => (
                          <tr key={t.txn_id}>
                            <td data-label="Date" className="py-2.5 pr-3 tabular-nums text-text-secondary">
                              {t.txn_date}
                            </td>
                            <td data-primary className="py-2.5 pr-3">
                              <p className="font-medium text-text-primary">{t.product_name}</p>
                              <p className="text-[11px] text-text-secondary">
                                {productLabel(t.product_type)}
                              </p>
                            </td>
                            <td data-label="Type" className="py-2.5 pr-3">
                              <StatusPill tone={t.txn_type === 'buy' ? 'info' : 'warning'}>
                                {t.txn_type}
                              </StatusPill>
                            </td>
                            <td data-label="Qty" className="py-2.5 text-right tabular-nums text-text-secondary">
                              {Number(t.quantity).toLocaleString('en-IN')}
                            </td>
                            <td data-label="Amount" className="py-2.5 text-right tabular-nums font-medium text-text-primary">
                              {fmt(Number(t.amount))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ClientBoard({ holdings }: { holdings: PartnerHoldingRow[] }) {
  const base = useMemo(() => fromPartnerHoldings(holdings, { registrarMf: mfSsoEnabled() }), [holdings]);
  const { rows, enriching } = useInvestmentRows('partner', base);
  return <InvestmentsBoard rows={rows} enriching={enriching} title="Holdings" compact />;
}
