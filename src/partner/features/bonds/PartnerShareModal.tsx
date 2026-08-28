// Partner shares a bond with a client via a link carrying a per-bond margin. The
// recipient opens /bond-offer?t=<token> to see the bond at the partner's price and
// request to invest (routed to the RM). Cost is never in the link or the page.

import { useState } from 'react';
import { X, Link2, Copy, Check, Share2, Percent, Loader2 } from 'lucide-react';
import { inr, pct } from '../../../lib/money';
import { PartnerService, type PartnerBond } from '../../services/PartnerService';

export function PartnerShareModal({
  bond,
  defaultMargin,
  onClose,
}: {
  bond: PartnerBond;
  defaultMargin: number;
  onClose: () => void;
}) {
  const [margin, setMargin] = useState(String(defaultMargin || 0));
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const marginNum = Math.min(5, Math.max(0, parseFloat(margin) || 0));
  const base = Number(bond.partner_base) || 0;
  const preview = Math.round(base * (1 + marginNum / 100) * 10000) / 10000;
  const marginValid = !Number.isNaN(parseFloat(margin)) && marginNum >= 0 && marginNum <= 5;

  const generate = async () => {
    setBusy(true); setError(null);
    try {
      const token = await PartnerService.createBondShare(bond.id, marginNum);
      setLink(`${window.location.origin}/bond-offer?t=${token}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ }
  };

  const shareText = link ? `${bond.bond_name || bond.isin} — view details & invest: ${link}` : '';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-token-xl border border-border bg-bg-elevated shadow-token-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="font-display text-base font-bold text-text-primary">Share with a client</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-text-secondary">A link for <strong className="text-text-primary">{bond.bond_name || bond.isin}</strong>. Your client sees the bond at your price and can request to invest — the order comes to your RM.</p>

          {!link ? (
            <>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-faint">Your margin for this link</span>
                <div className="relative">
                  <Percent className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
                  <input type="number" step="0.01" min={0} max={5} value={margin} onChange={(e) => setMargin(e.target.value)}
                    className="w-full rounded-token-md border border-border bg-bg-surface py-2.5 pl-8 pr-2 text-sm text-text-primary outline-none" />
                </div>
              </label>
              <div className="rounded-token-lg bg-bg-surface p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-secondary">Client sees / ₹100</span>
                  <span className="text-sm font-bold tabular-nums text-accent">{inr(preview)}</span>
                </div>
                <p className="mt-1 text-[11px] text-text-faint">Your cost {inr(base)} + your margin {pct(marginNum)}. Your cost is never shown to the client.</p>
              </div>
              {error && <div className="rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">{error}</div>}
              <button type="button" disabled={busy || !marginValid} onClick={generate}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Generate link
              </button>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-token-md border border-border bg-bg-surface px-3 py-2.5">
                <Link2 className="h-4 w-4 shrink-0 text-text-faint" />
                <span className="truncate text-xs text-text-secondary">{link}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={copy} className="inline-flex items-center justify-center gap-1.5 rounded-token-md border border-border bg-bg-surface py-2.5 text-sm font-bold text-text-primary hover:border-accent/40">
                  {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}
                </button>
                <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-token-md py-2.5 text-sm font-bold text-on-accent"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                  <Share2 className="h-4 w-4" /> WhatsApp
                </a>
              </div>
              <p className="text-center text-[11px] text-text-faint">The link is valid for 30 days.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
