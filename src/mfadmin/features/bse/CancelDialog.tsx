/**
 * Cancelling an order or a systematic plan at BSE.
 *
 * Both cancellations are *requests*. BSE treats each as a 2FA event
 * (verify_order_cancel / verify_sxp_cancel), so the order stays open and the
 * SIP keeps collecting until the investor approves on BSE's hosted page. The
 * whole design of this dialog follows from that: the success state does not say
 * "cancelled", it hands over the approval link and says what is still true.
 *
 * A modal rather than an inline row action because this is destructive, needs a
 * reason for a plan, and ends with a link staff must actually do something with
 * — none of which fits in a table cell.
 */
import { useState } from 'react';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import {
  BseOpsService,
  SXP_CANCEL_REASONS,
  type CancelResult,
} from '../../services/BseOpsService';
import { ErrorNote, Field, inputCls, Row, selectCls } from './formBits';
import { LinkRow } from './CopyLink';

/** What is being cancelled — the two shapes BSE's two cancel APIs need. */
export type CancelSubject =
  | { kind: 'order'; orderId: string; clientCode: string; rows: { label: string; value: string }[] }
  | { kind: 'sxp'; sxpRegNum: string; sxpType: string; rows: { label: string; value: string }[] };

interface Props {
  subject: CancelSubject;
  onClose: () => void;
  /** Called after a successful request so the book can be reloaded from BSE. */
  onDone: () => void;
}

export function CancelDialog({ subject, onClose, onDone }: Props) {
  const isOrder = subject.kind === 'order';
  const [remark, setRemark] = useState('');
  const [reasonCode, setReasonCode] = useState(1);
  const [reasonText, setReasonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CancelResult | null>(null);

  const needsWords = !isOrder && reasonCode === 13;
  const blocked = busy || (needsWords && !reasonText.trim());

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = isOrder
        ? await BseOpsService.cancelOrder({
            orderId: subject.orderId,
            clientCode: subject.clientCode,
            remark: remark.trim() || undefined,
          })
        : await BseOpsService.cancelSxp({
            sxpRegNum: subject.sxpRegNum,
            sxpType: subject.sxpType,
            reasonCode,
            reasonText: reasonText.trim() || undefined,
          });
      setResult(res);
      // Refresh underneath while the dialog stays open on the approval link:
      // BSE may already have moved the row, and staff still need the link.
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'BSE did not accept the cancellation.');
    } finally {
      setBusy(false);
    }
  };

  const thing = isOrder ? 'order' : 'plan';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Cancel this ${thing}`}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-lg">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger-soft/10">
            <AlertTriangle className="h-4.5 w-4.5 text-danger-soft" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-base font-bold text-text-primary">
              {result ? `Cancellation requested` : `Cancel this ${thing}?`}
            </h3>
            <p className="mt-0.5 text-xs text-text-secondary">
              {result
                ? `BSE has the request. The ${thing} does not change until the investor approves it.`
                : isOrder
                  ? 'The order stays open until the investor approves the cancellation at BSE.'
                  : 'The plan keeps collecting until the investor approves the cancellation at BSE.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-token-md p-1 text-text-faint hover:text-text-primary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <dl className="mt-4 space-y-1.5 rounded-token-md border border-border-subtle bg-bg-base p-3 text-xs">
          {subject.rows.map((r) => (
            <Row key={r.label} label={r.label} value={r.value} />
          ))}
        </dl>

        {!result && (
          <div className="mt-4 space-y-3">
            {isOrder ? (
              <Field label="Remark (optional)">
                <input
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  maxLength={200}
                  placeholder="Why this order is being cancelled"
                  className={inputCls}
                />
              </Field>
            ) : (
              <>
                <Field label="Reason (BSE requires one)">
                  <select
                    value={reasonCode}
                    onChange={(e) => setReasonCode(Number(e.target.value))}
                    className={selectCls}
                  >
                    {SXP_CANCEL_REASONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {needsWords && (
                  <Field label="Reason in words">
                    <input
                      value={reasonText}
                      onChange={(e) => setReasonText(e.target.value)}
                      maxLength={200}
                      placeholder="Required when the reason is Others"
                      className={inputCls}
                    />
                  </Field>
                )}
              </>
            )}

            {error && <ErrorNote title="BSE rejected this" message={error} />}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="flex-1 rounded-token-md border border-border bg-bg-surface py-2.5 text-xs font-semibold text-text-primary disabled:opacity-50"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={blocked}
                className="flex-1 rounded-token-md bg-danger-soft py-2.5 text-xs font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {busy ? 'Sending to BSE…' : `Cancel this ${thing}`}
              </button>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-4">
            {result.twoFaUrl ? (
              <>
                <p className="text-[11px] font-semibold text-text-primary">Send the client</p>
                <LinkRow label="Approve the cancellation" url={result.twoFaUrl} icon={ShieldCheck} />
              </>
            ) : (
              <p className="rounded-token-md border border-warning/20 bg-warning/10 p-3 text-[11px] text-warning">
                BSE accepted the request but returned no approval link. The {thing} stays as it is
                until the investor approves — ask BSE to reissue the{' '}
                <span className="font-mono">
                  {isOrder ? 'verify_order_cancel' : 'verify_sxp_cancel'}
                </span>{' '}
                link, and re-check the book before telling the client anything.
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-token-md border border-border bg-bg-surface py-2.5 text-xs font-semibold text-text-primary"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
