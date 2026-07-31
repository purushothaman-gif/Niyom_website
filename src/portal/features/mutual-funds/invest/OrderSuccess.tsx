/**
 * The end of the invest flow — and the two steps that actually matter after it.
 *
 * A placed order is not a completed investment. BSE requires the investor to
 * approve it (2FA), and only then can it be paid for; until payment lands the
 * order sits at payment_pending and nothing is bought. This screen used to stop
 * at the approval link, which left clients at a dead end with money never
 * leaving their account.
 *
 * It now shows the journey as it really is:
 *   1. Approve  — the BSE 2FA link returned with the order
 *   2. Pay      — BSE's hosted payment page, fetched on demand
 *
 * The pay button only appears after approval, because BSE answers
 * `record_not_found` for an unapproved order and a Pay button that errors is
 * worse than one that isn't there yet.
 */
import { useState } from 'react';
import { CheckCircle2, CreditCard, ExternalLink, Info, ShieldCheck } from 'lucide-react';
import { fmtDate } from '../../../../crm/utils';
import { inr } from '../../../../lib/money';
import { PaymentService } from '../../../services/PaymentService';
import { PortalButton, Tile } from '../../../ui/kit';
import type { OrderResult } from '../../../types/funds';

interface Props {
  result: OrderResult;
  onDone: () => void;
}

export function OrderSuccess({ result, onDone }: Props) {
  const [approved, setApproved] = useState(!result.twoFaUrl);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [noBank, setNoBank] = useState(false);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  // A SIP is authorised by a mandate, not funded per instalment, so the pay
  // step belongs to lumpsum purchases only.
  const needsPayment = result.type !== 'sip';

  const fetchPayLink = async () => {
    setPayBusy(true);
    setPayError(null);
    try {
      const res = await PaymentService.getLink({
        orderIds: [result.orderId],
        returnUrl: `${window.location.origin}/client-portal`,
      });
      setPayUrl(res.paymentUrl);
      setNoBank(res.noBankOnFile);
    } catch (err) {
      console.error('[portal] payment link failed', err);
      setPayError(
        'We couldn’t open the payment page just now. If you’ve only just approved the order, ' +
          'give it a moment and try again.',
      );
    } finally {
      setPayBusy(false);
    }
  };

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Order reference', value: result.orderId },
    { label: 'Fund', value: result.schemeName },
    { label: result.type === 'sip' ? 'SIP amount' : 'Amount', value: inr(result.amount) },
    { label: 'Type', value: result.type === 'sip' ? 'SIP' : 'Lumpsum' },
    { label: 'Expected NAV date', value: fmtDate(result.expectedNavDate) },
  ];

  const done = approved && (!needsPayment || Boolean(payUrl));

  return (
    <div className="mx-auto max-w-md space-y-4 py-4">
      <Tile className="animate-fadeInUp text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
          <CheckCircle2 className="h-7 w-7 text-success" />
        </span>
        <h2 className="font-display text-xl font-bold text-text-primary">
          {done ? 'All done' : 'Almost there'}
        </h2>
        <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-text-secondary">
          {result.type === 'sip'
            ? 'Your SIP is registered. Approve it below and the first instalment will be collected on schedule.'
            : 'Your order is placed. Two quick steps and the money goes to work.'}
        </p>

        {/* Step 1 — approval */}
        {result.twoFaUrl && (
          <div className="mt-5 rounded-token-md border border-border-subtle bg-bg-base p-3.5 text-left">
            <p className="mb-2 flex items-center gap-2 text-xs font-bold text-text-primary">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] text-on-accent">
                1
              </span>
              Approve this {result.type === 'sip' ? 'SIP' : 'order'}
            </p>
            <a
              href={result.twoFaUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => setApproved(true)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-token-md bg-accent py-2.5 text-sm font-bold text-on-accent transition-colors hover:bg-accent-strong"
            >
              <ShieldCheck className="h-4 w-4" />
              Open approval page
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <p className="mt-2 text-[11px] leading-relaxed text-text-faint">
              Opens BSE’s secure page. Come back here once you’ve approved.
            </p>
          </div>
        )}

        {/* Step 2 — payment */}
        {needsPayment && (
          <div className="mt-3 rounded-token-md border border-border-subtle bg-bg-base p-3.5 text-left">
            <p className="mb-2 flex items-center gap-2 text-xs font-bold text-text-primary">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                  approved ? 'bg-accent text-on-accent' : 'bg-bg-surface text-text-faint'
                }`}
              >
                2
              </span>
              Pay for this order
            </p>

            {!approved ? (
              <p className="text-[11px] leading-relaxed text-text-faint">
                Available once you’ve approved above — BSE can’t take payment for an order that
                hasn’t been approved yet.
              </p>
            ) : payUrl ? (
              <>
                <a
                  href={payUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-token-md bg-accent py-2.5 text-sm font-bold text-on-accent transition-colors hover:bg-accent-strong"
                >
                  <CreditCard className="h-4 w-4" />
                  Pay {inr(result.amount)}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                {noBank && (
                  <p className="mt-2 text-[11px] leading-relaxed text-warning">
                    No bank account is verified on your investment account yet, so the payment page
                    may not list one. Your relationship manager can add it.
                  </p>
                )}
              </>
            ) : (
              <>
                <PortalButton onClick={fetchPayLink} disabled={payBusy} full>
                  {payBusy ? 'Opening…' : 'Continue to payment'}
                </PortalButton>
                {payError && (
                  <p className="mt-2 text-[11px] leading-relaxed text-warning">{payError}</p>
                )}
              </>
            )}
          </div>
        )}

        <dl className="mt-5 space-y-2 text-left">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between gap-3 rounded-token-md bg-bg-surface px-3 py-2.5"
            >
              <dt className="text-xs text-text-secondary">{r.label}</dt>
              <dd className="truncate text-right text-xs font-semibold text-text-primary">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>

        {result.isMock && (
          <p className="mt-4 flex items-start gap-1.5 rounded-token-md border border-border bg-bg-surface p-2.5 text-left text-[11px] text-text-faint">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Demo order — no funds have been debited.
          </p>
        )}

        <div className="mt-5">
          <PortalButton variant={done ? 'primary' : 'secondary'} onClick={onDone} full>
            {done ? 'Done' : 'I’ll finish this later'}
          </PortalButton>
        </div>
      </Tile>
    </div>
  );
}
