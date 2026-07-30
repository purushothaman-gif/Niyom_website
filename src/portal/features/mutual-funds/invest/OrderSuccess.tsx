import { CheckCircle2, ExternalLink, Info, ShieldCheck } from 'lucide-react';
import { fmt, fmtDate } from '../../../../crm/utils';
import { Card } from '../../../components/Card';
import type { OrderResult } from '../../../types/funds';

interface Props {
  result: OrderResult;
  onDone: () => void;
}

export function OrderSuccess({ result, onDone }: Props) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Order Reference', value: result.orderId },
    { label: 'Fund', value: result.schemeName },
    { label: result.type === 'sip' ? 'SIP Amount' : 'Amount', value: fmt(result.amount) },
    { label: 'Type', value: result.type === 'sip' ? 'SIP' : 'Lumpsum' },
    { label: 'Expected NAV Date', value: fmtDate(result.expectedNavDate) },
  ];

  return (
    <div className="mx-auto max-w-md space-y-5 py-4">
      <Card className="text-center animate-fadeInUp">
        <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success-soft/10">
          <CheckCircle2 className="h-8 w-8" style={{ color: 'var(--success)' }} />
        </span>
        <h2 className="font-display text-xl font-bold text-text-primary">
          {result.twoFaUrl ? 'One last step' : 'Order Confirmed'}
        </h2>
        <p className="mx-auto mt-1 max-w-xs text-sm text-text-secondary">
          {result.twoFaUrl
            ? `Your ${result.type === 'sip' ? 'SIP' : 'order'} is placed but needs your approval before it can go ahead.`
            : `Your ${result.type === 'sip' ? 'SIP has been registered' : 'investment has been placed'} successfully.`}
        </p>

        {/* Without this the order simply never proceeds — say so plainly rather
            than letting "Confirmed" imply it is done. */}
        {result.twoFaUrl && (
          <a
            href={result.twoFaUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-token-md py-3 text-sm font-bold text-on-accent"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
          >
            <ShieldCheck className="h-4 w-4" />
            Approve this order
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}

        <dl className="mt-5 space-y-2 text-left">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between gap-3 rounded-token-md bg-bg-surface px-3 py-2.5"
            >
              <dt className="text-xs text-text-secondary">{r.label}</dt>
              <dd className="truncate text-right text-xs font-semibold text-text-primary">{r.value}</dd>
            </div>
          ))}
        </dl>

        {result.isMock && (
          <p className="mt-4 flex items-start gap-1.5 rounded-token-md border border-border-strong bg-bg-surface p-2.5 text-left text-[11px] text-text-faint">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Demo order — no funds have been debited. Live BSE StAR MF settlement connects in a later phase.
          </p>
        )}

        <button
          type="button"
          onClick={onDone}
          className="mt-5 w-full rounded-token-md py-3 text-sm font-bold text-on-accent"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
        >
          Done
        </button>
      </Card>
    </div>
  );
}
