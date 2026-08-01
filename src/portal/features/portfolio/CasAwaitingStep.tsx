import { useEffect, useState } from 'react';
import { Clock, MailCheck, Upload, X } from 'lucide-react';
import { CasRequestService, type CasRequest } from '../../services/CasRequestService';

/**
 * The five minutes between submitting the CAMS form and the email arriving.
 *
 * This screen exists because that gap is where the old flow lost people: they
 * left, and nothing in the product knew they had started or could tell them
 * what to do next. Now the request is tracked, so we can say what is happening
 * and stay useful while it does.
 *
 * Two rules shape it. Nothing here blocks — the statement can be uploaded the
 * moment it arrives, and the button to do so is always visible rather than
 * hidden behind a "ready?" state we cannot actually detect yet. And it never
 * claims to be watching: until email ingestion ships, we are waiting on the
 * client, not on a poller, and saying otherwise would be a lie the client
 * discovers by waiting forever.
 */
export function CasAwaitingStep({
  request,
  onUpload,
  onCancelled,
}: {
  request: CasRequest;
  onUpload: () => void;
  onCancelled: () => void;
}) {
  const [elapsed, setElapsed] = useState(() => minutesSince(request.createdAt));
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setElapsed(minutesSince(request.createdAt)), 30_000);
    return () => clearInterval(t);
  }, [request.createdAt]);

  const cancel = async () => {
    setCancelling(true);
    await CasRequestService.cancel(request.requestId);
    setCancelling(false);
    onCancelled();
  };

  // CAMS quotes roughly five minutes. Past fifteen it is worth saying that
  // something may have gone wrong rather than letting someone keep waiting.
  const overdue = elapsed >= 15;

  return (
    <div className="space-y-5 p-6">
      <div className="text-center">
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border border-accent/25 bg-accent/10 text-accent">
          <MailCheck className="h-7 w-7" />
        </span>
        <h4 className="font-display text-lg font-bold text-text-primary">
          Your statement is on its way
        </h4>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-text-muted">
          CAMS is emailing it to{' '}
          <b className="text-text-primary">{request.requestedEmail ?? 'your registered address'}</b>.
          It usually arrives within five minutes.
        </p>
      </div>

      <div className="flex items-center justify-center gap-1.5 text-xs text-text-faint">
        <Clock className="h-3.5 w-3.5" />
        {elapsed < 1 ? 'Just requested' : `Requested ${elapsed} minute${elapsed === 1 ? '' : 's'} ago`}
      </div>

      {overdue && (
        <div className="rounded-token-md border border-warning-soft/25 bg-warning-soft/5 p-3">
          <p className="text-xs leading-relaxed text-text-muted">
            Nothing yet? Check your spam folder. If it has not arrived, the most likely reason is
            that your funds are registered under a different email address — cancel below and start
            again with the other one.
          </p>
        </div>
      )}

      {/*
        Always available, never gated on a "received" state we cannot detect.
        The client knows when the email arrived long before we could.
      */}
      <button
        onClick={onUpload}
        className="press flex w-full items-center justify-center gap-2 rounded-token-md px-5 py-2.5 text-sm font-bold text-text-on-accent"
        style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
      >
        <Upload className="h-4 w-4" />
        I have the statement — upload it
      </button>

      <div className="flex justify-center">
        <button
          type="button"
          onClick={cancel}
          disabled={cancelling}
          className="inline-flex items-center gap-1.5 text-xs text-text-faint hover:text-text-primary disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          Cancel this request
        </button>
      </div>
    </div>
  );
}

function minutesSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 60_000));
}
