/** Shared building blocks for the console's transaction forms. */
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Card } from '../../../portal/components/Card';

export const selectCls =
  'w-full rounded-token-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent placeholder:text-text-faint disabled:opacity-50';
export const inputCls = selectCls;

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold text-text-primary">{label}</span>
      {children}
    </label>
  );
}

export function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-text-primary">{value}</dd>
    </div>
  );
}

export function ErrorNote({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 opacity-90">{message}</p>
      </div>
    </div>
  );
}

export function WarnNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-token-md border border-warning/20 bg-warning/10 p-3 text-xs text-warning">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function SuccessCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card padding="lg" className="border-success/30 bg-success/5">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        <div className="min-w-0">
          <p className="font-semibold text-text-primary">{title}</p>
          {children}
        </div>
      </div>
    </Card>
  );
}

/** "Not wired up" panel, shown when VITE_BSE_PROXY_URL is disabled. */
export function NotConfigured({ title }: { title: string }) {
  return (
    <Card padding="lg" className="mx-auto max-w-lg text-center">
      <h2 className="font-display text-xl font-bold text-text-primary">{title}</h2>
      <p className="mt-2 text-sm text-text-secondary">
        Live BSE access isn’t connected in this environment.
      </p>
    </Card>
  );
}

/** Two-step confirmation block used before anything is sent to BSE. */
export function ConfirmBox({
  rows,
  note,
  busy,
  submitLabel,
  onBack,
  onConfirm,
}: {
  rows: { label: string; value: string }[];
  note: string;
  busy: boolean;
  submitLabel: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="rounded-token-lg border border-accent/30 bg-accent/5 p-4">
      <p className="font-display text-sm font-bold text-text-primary">Confirm this transaction</p>
      <dl className="mt-3 space-y-1.5 text-xs">
        {rows.map((r) => (
          <Row key={r.label} label={r.label} value={r.value} />
        ))}
      </dl>
      <p className="mt-3 text-[11px] text-text-secondary">{note}</p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="flex-1 rounded-token-md border border-border bg-bg-surface py-2.5 text-xs font-semibold text-text-primary disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="flex-1 rounded-token-md bg-accent py-2.5 text-xs font-bold text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-60"
        >
          {busy ? 'Submitting…' : submitLabel}
        </button>
      </div>
    </div>
  );
}
