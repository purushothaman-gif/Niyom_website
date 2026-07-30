import { useEffect, useState } from 'react';
import { Users, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Card } from '../../../portal/components/Card';
import { EmptyState } from '../../../portal/components/EmptyState';
import { StatusPill } from '../../../portal/components/StatusPill';
import { fmt, PRODUCT_LABELS } from '../../../crm/utils';
import { PartnerService } from '../../services/PartnerService';
import type { PartnerClientRow, PartnerHoldingRow, PartnerTransactionRow } from '../../types';
import type { ProductType } from '../../../crm/types';

interface Props {
  clients: PartnerClientRow[];
}

const productLabel = (t: string) => PRODUCT_LABELS[t as ProductType] ?? t;

/**
 * Clients this partner sourced, each expandable to their complete portfolio.
 *
 * The list itself comes from the snapshot; the portfolio and transactions are
 * fetched on expand (nw_partner_client_portfolio / _transactions), which
 * independently re-check that the client belongs to this partner — so a guessed
 * client id returns nothing even with a valid partner session.
 */
export function ClientsPage({ clients }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (clients.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Users}
          title="No clients sourced yet"
          hint="Clients you introduce to Niyom Wealth will appear here once they complete onboarding."
        />
      </Card>
    );
  }

  const totalInvested = clients.reduce((s, c) => s + Number(c.invested_amount || 0), 0);
  const totalValue = clients.reduce((s, c) => s + Number(c.current_value || 0), 0);

  return (
    <div className="space-y-4">
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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || holdings !== null) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      PartnerService.getClientPortfolio(client.client_id),
      PartnerService.getClientTransactions(client.client_id),
    ])
      .then(([h, t]) => {
        if (cancelled) return;
        setHoldings(h);
        setTxns(t);
      })
      .catch(() => {
        if (cancelled) return;
        setHoldings([]);
        setTxns([]);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [open, holdings, client.client_id]);

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
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                  Holdings
                </p>
                {holdings && holdings.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead>
                        <tr className="border-b border-border-subtle text-[11px] uppercase tracking-wider text-text-faint">
                          <th className="pb-2 text-left font-semibold">Product</th>
                          <th className="pb-2 text-right font-semibold">Qty</th>
                          <th className="pb-2 text-right font-semibold">Invested</th>
                          <th className="pb-2 text-right font-semibold">Value</th>
                          <th className="pb-2 text-right font-semibold">Gain / Loss</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle">
                        {holdings.map((h) => (
                          <tr key={h.holding_id}>
                            <td className="py-2.5 pr-3">
                              <p className="font-medium text-text-primary">{h.product_name}</p>
                              <p className="text-[11px] text-text-secondary">
                                {productLabel(h.product_type)}
                              </p>
                            </td>
                            <td className="py-2.5 text-right tabular-nums text-text-secondary">
                              {Number(h.quantity).toLocaleString('en-IN')}
                            </td>
                            <td className="py-2.5 text-right tabular-nums text-text-secondary">
                              {fmt(Number(h.invested_amount))}
                            </td>
                            <td className="py-2.5 text-right tabular-nums font-medium text-text-primary">
                              {fmt(Number(h.current_value))}
                            </td>
                            <td
                              className="py-2.5 text-right tabular-nums font-medium"
                              style={{
                                color: Number(h.gain_loss) >= 0 ? 'var(--success)' : 'var(--danger)',
                              }}
                            >
                              {Number(h.gain_loss) >= 0 ? '+' : ''}
                              {fmt(Number(h.gain_loss))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState icon={Users} title="No holdings recorded" compact />
                )}
              </section>

              {txns && txns.length > 0 && (
                <section>
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-secondary">
                    Transactions
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
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
                            <td className="py-2.5 pr-3 tabular-nums text-text-secondary">
                              {t.txn_date}
                            </td>
                            <td className="py-2.5 pr-3">
                              <p className="font-medium text-text-primary">{t.product_name}</p>
                              <p className="text-[11px] text-text-secondary">
                                {productLabel(t.product_type)}
                              </p>
                            </td>
                            <td className="py-2.5 pr-3">
                              <StatusPill tone={t.txn_type === 'buy' ? 'info' : 'warning'}>
                                {t.txn_type}
                              </StatusPill>
                            </td>
                            <td className="py-2.5 text-right tabular-nums text-text-secondary">
                              {Number(t.quantity).toLocaleString('en-IN')}
                            </td>
                            <td className="py-2.5 text-right tabular-nums font-medium text-text-primary">
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
