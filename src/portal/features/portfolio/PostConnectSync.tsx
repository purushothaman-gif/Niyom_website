import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { InboxService } from '../../../../shared/portal/services/InboxService';

/**
 * Shown once, right after a client returns from connecting their email inbox.
 *
 * Rather than drop them into the import hub to press "Sync now" themselves, we
 * run the first sync for them and show its result, then move them on to their
 * portfolio. The whole point of connecting email was to not have to do anything
 * else, so finishing the job here keeps that promise.
 *
 * `onDone` dismisses this and takes them to the portfolio; it fires on the
 * success auto-advance and on the error/empty "Go to portfolio" button.
 */
type Phase = 'syncing' | 'done' | 'empty' | 'error';

export function PostConnectSync({
  onDone,
  onImported,
}: {
  onDone: () => void;
  onImported: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('syncing');
  const [count, setCount] = useState(0);
  const [error, setError] = useState('');
  // Guard against double-run (StrictMode) spending a sync twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let alive = true;
    void (async () => {
      const r = await InboxService.sync();
      if (!alive) return;
      if (!r.ok) {
        setError(r.error);
        setPhase('error');
        return;
      }
      if (r.summary.reconnectNeeded) {
        setError('Your email connection expired. Please connect it again.');
        setPhase('error');
        return;
      }
      const n = r.summary.imported + r.summary.mfImported;
      if (n > 0) {
        setCount(n);
        onImported();
        setPhase('done');
      } else {
        setPhase('empty');
      }
      // Give them a moment to read the result, then move on to the portfolio.
      setTimeout(() => {
        if (alive) onDone();
      }, 2400);
    })();
    return () => {
      alive = false;
    };
  }, [onDone, onImported]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-token-xl border border-border bg-modal p-8 text-center shadow-token-lg">
        {phase === 'syncing' && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
            <h3 className="mt-4 font-display text-lg font-bold text-text-primary">Syncing your statements…</h3>
            <p className="mt-1.5 text-sm text-text-muted">
              Your email is connected — we’re bringing in everything from your inbox. This takes a
              few seconds.
            </p>
          </>
        )}

        {phase === 'done' && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-success-soft/30 bg-success-soft/10 text-success-soft">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h3 className="mt-4 font-display text-lg font-bold text-text-primary">Your mail is synced</h3>
            <p className="mt-1.5 text-sm text-text-muted">
              {count} statement{count === 1 ? '' : 's'} imported successfully. Taking you to your
              portfolio…
            </p>
          </>
        )}

        {phase === 'empty' && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-accent">
              <Mail className="h-7 w-7" />
            </div>
            <h3 className="mt-4 font-display text-lg font-bold text-text-primary">Email connected</h3>
            <p className="mt-1.5 text-sm text-text-muted">
              No new statements in your inbox yet — we’ll bring them in automatically next time.
              Taking you to your portfolio…
            </p>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-danger-soft/30 bg-danger-soft/10 text-danger-soft">
              <AlertCircle className="h-7 w-7" />
            </div>
            <h3 className="mt-4 font-display text-lg font-bold text-text-primary">Couldn’t sync just now</h3>
            <p className="mt-1.5 text-sm text-text-muted">
              {error} Your email stays connected — you can sync again from Import my portfolio.
            </p>
            <button
              type="button"
              onClick={onDone}
              className="press mt-5 inline-flex items-center justify-center rounded-token-md px-6 py-2.5 text-sm font-bold text-text-on-accent"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              Go to my portfolio
            </button>
          </>
        )}
      </div>
    </div>
  );
}
