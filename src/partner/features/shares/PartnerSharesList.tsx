// Partner unlisted-share marketplace — the same card grid the client portal has,
// but priced for the partner: their cost (partner_base) and their selling price
// (partner_price = cost × their spread). Includes the partner's global markup
// control. Card click → detail.

import { useMemo, useState } from 'react';
import { Gem, ArrowRight, X, Percent, Check, Loader2, Search } from 'lucide-react';
import { inr, pct } from '../../../lib/money';
import { ShareLogo } from '../../../components/ShareLogo';
import { minQty } from '../../../../shared/portal/shares/shareMath';
import type { PartnerShare } from '../../services/PartnerService';

function matches(s: PartnerShare, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [s.company_name, s.short_name, s.isin, s.sector].some((v) => (v ?? '').toLowerCase().includes(t));
}

export function PartnerSharesList({
  shares,
  currentMarkup,
  onSaveMarkup,
  onOpen,
}: {
  shares: PartnerShare[];
  currentMarkup: number;
  onSaveMarkup: (pct: number) => Promise<void>;
  onOpen: (share: PartnerShare) => void;
}) {
  const [query, setQuery] = useState('');
  const [markup, setMarkup] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const shown = useMemo(() => shares.filter((s) => matches(s, query)), [shares, query]);

  const save = async () => {
    const v = parseFloat(markup);
    if (Number.isNaN(v)) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await onSaveMarkup(v);
      setMarkup('');
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Global markup control */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-token-xl border border-border bg-bg-elevated p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-faint">Your markup</p>
          <p className="mt-0.5 text-sm text-text-secondary">
            Added on top of your cost, capped at <strong>5%</strong>. Current:{' '}
            <strong className="text-text-primary">{pct(currentMarkup)}</strong>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Percent className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              type="number"
              step="0.01"
              min={0}
              max={5}
              value={markup}
              onChange={(e) => setMarkup(e.target.value)}
              placeholder={String(currentMarkup)}
              className="w-28 rounded-token-md border border-border bg-bg-surface py-2 pl-8 pr-2 text-sm text-text-primary outline-none"
            />
          </div>
          <button
            disabled={saving || markup === '' || Number.isNaN(parseFloat(markup))}
            onClick={save}
            className="inline-flex items-center gap-1.5 rounded-token-md bg-accent px-4 py-2 text-sm font-bold text-on-accent disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
        </div>
      </div>
      {saveErr && <p className="text-sm text-danger-soft">{saveErr}</p>}

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          {query ? `${shown.length} of ${shares.length}` : shares.length} share{shares.length === 1 ? '' : 's'}
        </p>
        <p className="hidden text-xs text-text-faint sm:block">
          “Your price” includes your {pct(currentMarkup)} markup. Your cost is never shown to a client.
        </p>
      </div>

      {shares.length === 0 ? (
        <div className="rounded-token-xl border border-border bg-bg-elevated py-16 text-center">
          <Gem className="mx-auto mb-3 h-7 w-7 text-text-faint" />
          <p className="text-sm text-text-primary">No unlisted shares available to you yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-text-faint">
            Your relationship manager sets your pricing. Once it is approved, the shares you can sell appear here.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-token-xl border border-border bg-bg-elevated py-14 text-center">
          <Search className="mx-auto mb-3 h-6 w-6 text-text-faint" />
          <p className="text-sm text-text-secondary">Nothing matched “{query}”.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((s) => {
            const min = minQty(s);
            return (
              <div key={s.id} className="flex flex-col rounded-token-xl border border-border bg-bg-elevated p-5">
                <div className="flex items-start gap-3">
                  <ShareLogo name={s.short_name || s.company_name} url={s.logo_url} size={44} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-display text-base font-bold leading-tight text-text-primary">
                      {s.short_name || s.company_name}
                    </h3>
                    <p className="mt-0.5 truncate text-[11px] text-text-faint">{s.isin}</p>
                  </div>
                </div>

                {s.sector && <p className="mt-2.5 truncate text-xs text-text-secondary">{s.sector}</p>}

                <div className="mt-4 grid grid-cols-2 gap-3 rounded-token-lg bg-bg-surface p-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Your cost</p>
                    <p className="mt-0.5 text-sm font-bold tabular-nums text-text-primary">{inr(s.partner_base ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Your price</p>
                    <p className="mt-0.5 text-sm font-bold tabular-nums text-accent">{inr(s.partner_price ?? 0)}</p>
                  </div>
                </div>

                <p className="mt-2 text-[11px] text-text-faint">
                  Minimum {min} share{min === 1 ? '' : 's'}
                </p>

                <button
                  type="button"
                  onClick={() => onOpen(s)}
                  className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-token-md py-2.5 text-xs font-bold text-on-accent"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
                >
                  View details <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
