import { FileText, Repeat, Wallet } from 'lucide-react';
import { fmt, fmtDate } from '../../../../crm/utils';
import { Card } from '../../../components/Card';
import { EmptyState } from '../../../components/EmptyState';
import { LogoLoader } from '../../../../components/LogoLoader';
import { useRtaMf } from '../../../hooks/useRtaMf';

/**
 * "Statement" tab — the client's mutual funds exactly as the registrar
 * (CAMS/KFintech) reports them, refreshed daily from the mailback feeds. This
 * is their real holdings and running SIP/STP/SWP plans, kept separate from
 * Explore (research) and My Funds (the in-house/BSE order rail) so the numbers
 * never blur. Read-only: it mirrors the statement, it is not a place to trade.
 */
export function StatementPage({ clientId }: { clientId: string }) {
  const { data, loading, error } = useRtaMf(clientId);

  if (loading && !data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LogoLoader size={48} />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <EmptyState icon={FileText} title="Couldn’t load your statement" hint={error} />
      </Card>
    );
  }

  if (!data || !data.hasData) {
    return (
      <Card>
        <EmptyState
          icon={Wallet}
          title="No mutual fund holdings on record yet"
          hint="Funds you hold through us appear here automatically, updated daily from the registrar. Investments made elsewhere show up once your folios are linked."
        />
      </Card>
    );
  }

  const active = data.sips.filter((s) => s.status === 'active');

  return (
    <div className="space-y-5">
      <Card padding="md">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] uppercase tracking-wider text-text-secondary">Your mutual funds</p>
          <p className="text-[11px] text-text-secondary">
            From your registrar statement{data.snapshotDate ? ` · ${fmtDate(data.snapshotDate)}` : ''}
          </p>
        </div>
        {data.totalInvested != null ? (
          <div className="mt-2 grid grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-text-secondary">Value</p>
              <p className="mt-0.5 font-display text-lg font-bold text-text-primary">{fmt(data.totalValue)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-text-secondary">Invested</p>
              <p className="mt-0.5 font-display text-lg font-bold text-text-primary">{fmt(data.totalInvested)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wider text-text-secondary">Returns</p>
              <p
                className="mt-0.5 font-display text-lg font-bold"
                style={{ color: data.totalValue >= data.totalInvested ? 'var(--success)' : 'var(--danger)' }}
              >
                {data.totalValue >= data.totalInvested ? '+' : ''}
                {data.totalInvested > 0 ? (((data.totalValue - data.totalInvested) / data.totalInvested) * 100).toFixed(1) : '0.0'}%
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 font-display text-xl font-bold text-text-primary">{fmt(data.totalValue)}</p>
        )}
      </Card>

      {data.holdings.length > 0 && (
        <div className="space-y-3">
          {data.holdings.map((h) => {
            const value = h.rtaValue ?? h.navValue ?? 0;
            const invested = h.investedCost;
            const gain = invested != null ? value - invested : null;
            const gainPct = invested != null && invested > 0 ? (gain! / invested) * 100 : null;
            const up = (gain ?? 0) >= 0;
            return (
              <Card key={h.id} padding="md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-primary">{h.schemeName ?? h.schemeCode}</p>
                    <p className="mt-0.5 text-[11px] text-text-secondary">
                      Folio {h.folio} · {h.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units
                      {h.firstInvestmentDate ? ` · invested since ${fmtDate(h.firstInvestmentDate)}` : ''}
                    </p>
                  </div>
                  <p className="flex-shrink-0 text-sm font-bold text-text-primary">{fmt(value)}</p>
                </div>
                {invested != null && (
                  <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-[11px]">
                    <span className="text-text-secondary">Invested {fmt(invested)}</span>
                    <span className="font-semibold" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>
                      {up ? '+' : ''}{fmt(gain!)}{gainPct != null ? ` · ${up ? '+' : ''}${gainPct.toFixed(1)}%` : ''}
                    </span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {active.length > 0 && (
        <Card padding="md">
          <div className="mb-3 flex items-center gap-2">
            <Repeat className="h-4 w-4 text-accent" />
            <h3 className="text-sm font-bold text-text-primary">Running plans ({active.length})</h3>
          </div>
          <div className="space-y-3">
            {active.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 border-t border-border pt-3 first:border-0 first:pt-0">
                <div className="min-w-0">
                  <p className="truncate text-sm text-text-primary">{s.schemeName ?? s.schemeCode}</p>
                  <p className="text-[11px] text-text-secondary">
                    {(s.type ?? 'SIP')} · {s.frequency ?? '—'}{s.sipDay ? ` · day ${s.sipDay}` : ''}
                  </p>
                </div>
                <p className="flex-shrink-0 text-sm font-semibold text-text-primary">
                  {s.amount != null ? fmt(s.amount) : '—'}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
