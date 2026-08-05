/**
 * The two links a client needs after staff place an order on their behalf.
 *
 * A placed order is not a funded one. BSE needs the investor to approve it,
 * and only then can it be paid for; until payment lands nothing is bought.
 * Staff have no way to complete either step for the client, so the only useful
 * thing this screen can do is hand over both links in a form that is easy to
 * paste into WhatsApp or an email.
 *
 * The payment link is fetched on demand rather than upfront, because BSE
 * answers `record_not_found` for an order the investor has not yet approved.
 */
import { useState } from 'react';
import { Check, Copy, CreditCard, ExternalLink, ShieldCheck } from 'lucide-react';
import { BseOpsService } from '../../services/BseOpsService';

/** One BSE-hosted link, ready to be pasted into WhatsApp or an email. */
export function LinkRow({
  label,
  url,
  icon: Icon,
}: {
  label: string;
  url: string;
  icon: typeof ShieldCheck;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the link is visible and selectable anyway */
    }
  };

  return (
    <div className="mt-2 rounded-token-md border border-border-subtle bg-bg-base p-2.5">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="text-[11px] font-semibold text-text-primary">{label}</span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex items-center gap-1 rounded-token-md border border-border bg-bg-surface px-2 py-1 text-[10px] font-semibold text-text-primary hover:text-accent"
          >
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-token-md border border-border bg-bg-surface px-2 py-1 text-[10px] font-semibold text-text-primary hover:text-accent"
          >
            Open <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </div>
      <p className="mt-1.5 break-all font-mono text-[10px] leading-relaxed text-text-faint">{url}</p>
    </div>
  );
}

export function ClientLinks({
  placed,
}: {
  placed: { orderId: string; clientCode: string; twoFaUrl?: string | null };
}) {
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [noBank, setNoBank] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPay = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await BseOpsService.paymentLink(placed.clientCode, [placed.orderId]);
      setPayUrl(res.paymentUrl);
      setNoBank(res.noBankOnFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not get the payment page.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-border-subtle pt-3">
      <p className="text-[11px] font-semibold text-text-primary">Send the client</p>
      <p className="mt-0.5 text-[11px] text-text-faint">
        The order stays unfunded until they complete both steps.
      </p>

      {placed.twoFaUrl ? (
        <LinkRow label="1 · Approve the order" url={placed.twoFaUrl} icon={ShieldCheck} />
      ) : (
        <p className="mt-2 text-[11px] text-warning">
          BSE didn’t return an approval link. Generate one from KYC → the client’s row.
        </p>
      )}

      {payUrl ? (
        <>
          <LinkRow label="2 · Pay for the order" url={payUrl} icon={CreditCard} />
          {noBank && (
            <p className="mt-1.5 text-[11px] text-warning">
              No bank account is verified on this UCC, so BSE’s page will list none. Add one before
              sending this.
            </p>
          )}
        </>
      ) : (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => void fetchPay()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-token-md border border-border bg-bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text-primary hover:text-accent disabled:opacity-50"
          >
            <CreditCard className="h-3.5 w-3.5" />
            {busy ? 'Fetching…' : 'Get payment link'}
          </button>
          <p className="mt-1.5 text-[11px] text-text-faint">
            Only works once the client has approved — BSE won’t issue a payment page before that.
          </p>
          {error && <p className="mt-1.5 text-[11px] text-danger-soft">{error}</p>}
        </div>
      )}
    </div>
  );
}
