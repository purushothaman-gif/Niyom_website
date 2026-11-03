import { CalendarClock, Repeat } from 'lucide-react';
import { inr } from '../../../lib/money';
import type { RtaSipRow } from '../../../../shared/mf/rtaMf';

function nextInstalment(s: RtaSipRow, today = new Date()): Date | null {
  const day = Number(String(s.sipDay ?? '').replace(/\D/g, ''));
  if (!day || day < 1 || day > 31) return null;
  const f = (s.frequency ?? '').toLowerCase();
  if (f && !/month/.test(f)) return null;
  const d = new Date(today.getFullYear(), today.getMonth(), Math.min(day, 28));
  if (day > 28) d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d.setMonth(d.getMonth() + 1);
  if (s.toDate && d > new Date(s.toDate)) return null;
  return d;
}

/** Running SIPs/STPs/SWPs from the registrar, Groww "SIPs" style. */
export function SipsCard({ sips, onOpen }: { sips: RtaSipRow[]; onOpen?: () => void }) {
  const active = sips.filter((s) => s.status === 'active');
  const monthly = active
    .filter((s) => (s.type ?? 'SIP').toUpperCase() === 'SIP' && /month/i.test(s.frequency ?? 'monthly'))
    .reduce((t, s) => t + (s.amount ?? 0), 0);

  return (
    <section className="rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-[15px] font-bold text-text-primary">
          <Repeat className="h-4 w-4 text-accent" /> Active SIPs
          <span className="text-text-faint">({active.length})</span>
        </h3>
        {monthly > 0 && (
          <div className="text-right">
            <p className="text-[11px] text-text-secondary">Monthly SIP</p>
            <p className="text-sm font-bold tabular-nums text-text-primary">{inr(monthly)}</p>
          </div>
        )}
      </div>
      {active.length === 0 ? (
        <p className="mt-4 text-sm text-text-secondary">No running SIPs. Start one to invest automatically every month.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border-subtle">
          {active.slice(0, 5).map((s) => {
            const next = nextInstalment(s);
            return (
              <li key={s.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text-primary">{s.schemeName ?? s.schemeCode}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-text-secondary">
                    <CalendarClock className="h-3 w-3" />
                    {(s.type ?? 'SIP').toUpperCase()} · {s.frequency ?? 'Monthly'}
                    {next && <> · next {next.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</>}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold tabular-nums text-text-primary">
                  {s.amount != null ? inr(s.amount) : '—'}
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {onOpen && active.length > 5 && (
        <button type="button" onClick={onOpen} className="mt-3 text-xs font-semibold text-accent">
          +{active.length - 5} more
        </button>
      )}
    </section>
  );
}
