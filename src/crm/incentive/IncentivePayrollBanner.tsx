/**
 * Shown on an editable payroll run: approved incentives for the PREVIOUS
 * month that are not in any run yet, with a one-click import. Same RPC as the
 * Incentive Admin "Send to payroll" button. Statements are admin-readable only,
 * so for anyone else the count is zero and nothing renders.
 */
import { useCallback, useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import { countPendingForPayroll, pushToPayroll, inr, monthLabel, periodKey } from './incentiveData';
import { hrError } from '../hr/hrError';
import { GhostButton } from '../hr/hrUi';

export default function IncentivePayrollBanner({ run, onImported, onToast }: {
  run: { id: string; period_year: number; period_month: number };
  onImported: () => void;
  onToast: (msg: string, ok?: boolean) => void;
}) {
  // Revenue month = the month before the payroll month (period_month is 1-based).
  const revenuePeriod = run.period_month === 1
    ? periodKey(run.period_year - 1, 11)
    : periodKey(run.period_year, run.period_month - 2);
  const [pending, setPending] = useState<{ count: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    countPendingForPayroll(revenuePeriod).then(setPending).catch(() => setPending(null));
  }, [revenuePeriod]);
  useEffect(() => { refresh(); }, [refresh]);

  if (!pending || pending.count === 0) return null;

  const importNow = async () => {
    setBusy(true);
    try {
      const n = await pushToPayroll(revenuePeriod, run.id);
      onToast(`${n} incentive${n === 1 ? '' : 's'} imported. Recalculate payroll to include them.`);
      refresh(); onImported();
    } catch (e) {
      onToast(hrError(e, 'Could not import incentives.'), false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-3 rounded-xl flex items-center justify-between gap-3 flex-wrap"
      style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.28)' }}>
      <div className="flex items-start gap-2.5 min-w-0">
        <Trophy className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'rgb(139,92,246)' }} />
        <div>
          <p className="text-xs font-semibold" style={{ color: 'rgb(139,92,246)' }}>
            {pending.count} approved incentive{pending.count === 1 ? '' : 's'} for {monthLabel(revenuePeriod)} ({inr(pending.total)}) not yet in this run
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            They are added as "Incentive" earnings. Recalculate afterwards.
          </p>
        </div>
      </div>
      <GhostButton onClick={importNow} disabled={busy}>{busy ? 'Importing…' : 'Import incentives'}</GhostButton>
    </div>
  );
}
