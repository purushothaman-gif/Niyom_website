// Client unlisted-share marketplace — a card grid in the portal's own tokens.
// Each card leads to a detail page where the client picks a quantity and places
// an order. Prices are the client's approved, marked-up price (indicative); the
// base price, the markup and any partner spread never reach here.

import { useMemo, useState } from 'react';
import { Gem, ArrowRight, Search, X } from 'lucide-react';
import { inr } from '../../../lib/money';
import { ShareLogo } from '../../../components/ShareLogo';
import { Card } from '../../components/Card';
import { StatusPill } from '../../components/StatusPill';
import { MiniStat, Blank } from '../../ui/kit';
import type { ClientShare } from '../../../../shared/portal/services/ShareOrderService';
import { minQty } from '../../../../shared/portal/shares/shareMath';

function matches(s: ClientShare, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [s.company_name, s.short_name, s.isin, s.sector]
    .some((v) => (v ?? '').toLowerCase().includes(t));
}

export function SharesListPage({
  shares,
  onOpen,
}: {
  shares: ClientShare[];
  onOpen: (share: ClientShare) => void;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => shares.filter((s) => matches(s, query)), [shares, query]);

  if (shares.length === 0) {
    return (
      <Card padding="none">
        <Blank
          icon={Gem}
          title="No unlisted shares available yet"
          body="Pre-IPO and unlisted opportunities curated for you will appear here. Please contact your relationship manager to get started."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by company, ISIN or sector"
          className="w-full rounded-token-md border border-border bg-bg-raised py-2 pl-9 pr-8 text-sm text-text-primary outline-none focus:border-accent/50"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-primary">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <Card padding="none">
          <Blank icon={Search} title="Nothing matched" body="Try a different company name, ISIN or sector." />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((s) => {
            const min = minQty(s);
            return (
              <Card key={s.id} padding="md" className="flex flex-col">
                <div className="flex items-start gap-3">
                  <ShareLogo name={s.short_name || s.company_name} url={s.logo_url} size={44} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-display text-base font-bold leading-tight text-text-primary">
                      {s.short_name || s.company_name}
                    </h3>
                    <p className="mt-0.5 truncate text-[11px] text-text-faint">{s.isin}</p>
                  </div>
                  {s.sector && <StatusPill tone="accent">{s.sector}</StatusPill>}
                </div>

                {s.short_name && s.company_name !== s.short_name && (
                  <p className="mt-2.5 truncate text-xs text-text-secondary">{s.company_name}</p>
                )}

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <MiniStat label="Price / share" value={inr(s.client_price ?? 0)} />
                  <MiniStat label="Min. quantity" value={`${min} share${min === 1 ? '' : 's'}`} />
                </div>

                <button
                  type="button"
                  onClick={() => onOpen(s)}
                  className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-token-md py-2.5 text-xs font-bold text-on-accent"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
                >
                  View details <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
