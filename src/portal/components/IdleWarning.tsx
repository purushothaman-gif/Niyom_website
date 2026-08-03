import { Clock } from 'lucide-react';

interface Props {
  secondsLeft: number;
  onStay: () => void;
  onSignOutNow: () => void;
}

/**
 * The thirty seconds before an idle sign-out.
 *
 * Warning rather than a silent drop: someone reading a long statement without
 * touching the trackpad should be able to say "still here", and someone who has
 * walked away loses nothing by the countdown finishing.
 */
export function IdleWarning({ secondsLeft, onStay, onSignOutNow }: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      role="alertdialog"
      aria-live="assertive"
    >
      <div className="w-full max-w-sm rounded-token-xl border border-border bg-bg-elevated p-6 text-center shadow-token-lg">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
          <Clock className="h-6 w-6 text-accent" />
        </span>
        <h3 className="text-base font-bold text-text-primary">Still there?</h3>
        <p className="mt-2 text-sm text-text-secondary">
          You’ll be signed out in{' '}
          <span className="font-bold text-text-primary">{secondsLeft}s</span> to keep your account
          safe on this device.
        </p>
        <div className="mt-5 flex justify-center gap-3">
          <button
            type="button"
            onClick={onSignOutNow}
            className="rounded-token-md border border-border px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-bg-base"
          >
            Sign out now
          </button>
          <button
            type="button"
            onClick={onStay}
            className="rounded-token-md bg-accent px-4 py-2 text-sm font-bold text-on-accent transition-opacity hover:opacity-90"
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
