/**
 * The attendance punch card.
 *
 * This is the one HR screen most people will use every day, on a phone, in a
 * hurry -- so it is a single card with a live clock, the current state, an
 * honest statement about the network, and one big button. Nothing else.
 *
 * The network verdict shown here comes from the SERVER (hr-attendance-state),
 * not from anything the browser can see. The browser is never told which IPs
 * are allowed -- hr_allowed_networks is HR-readable only, because an employee
 * who could list it would know exactly what to spoof. Disabling the button is a
 * courtesy, not a control: the same check runs again inside the punch endpoint.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, LogIn, LogOut, MapPin, ShieldAlert, ShieldCheck, WifiOff } from 'lucide-react';
import { getPunchState, punch } from './hrApi';
import type { PunchState } from './hrTypes';
import { formatDuration } from '../../lib/hr/attendanceSummary';
import { Notice } from './hrUi';
import { hrError } from './hrError';

interface Props {
  employeeName: string;
  /** Compact variant for the CRM dashboard; full variant for the My HR page. */
  compact?: boolean;
  onPunched?: () => void;
}

const IST = 'Asia/Kolkata';

const timeIST = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: IST }) : '--';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function PunchCard({ employeeName, compact, onPunched }: Props) {
  const [state, setState] = useState<PunchState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [now, setNow] = useState(() => new Date());
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    try {
      const s = await getPunchState();
      if (!mounted.current) return;
      if ((s as { error?: string }).error) {
        setMessage({ text: (s as { error?: string }).error!, ok: false });
      } else {
        setState(s);
      }
    } catch (err) {
      if (mounted.current) setMessage({ text: hrError(err, 'Could not load your attendance.'), ok: false });
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // A ticking clock, and a refresh every two minutes so the worked-time figure
  // and the network verdict stay honest if someone changes Wi-Fi mid-shift.
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    const refresh = window.setInterval(load, 120_000);
    return () => { window.clearInterval(tick); window.clearInterval(refresh); };
  }, [load]);

  const doPunch = async () => {
    if (!state || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await punch(state.next_action);
      if (res.ok) {
        setMessage({ text: res.message ?? 'Recorded.', ok: res.approval_status !== 'pending' });
      } else {
        setMessage({ text: res.message ?? res.error ?? 'Could not record that punch.', ok: false });
      }
      await load();
      onPunched?.();
    } catch (err) {
      setMessage({ text: hrError(err, 'Could not record that punch.'), ok: false });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl p-6 hr-shimmer" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', minHeight: compact ? 180 : 320 }} />
    );
  }

  if (!state) {
    return (
      <div className="rounded-2xl p-6" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <Notice tone="warn" title="Attendance unavailable">
          {message?.text ?? 'Could not load your attendance right now.'}{' '}
          <button onClick={load} className="underline font-semibold">Try again</button>
        </Notice>
      </div>
    );
  }

  const isIn = state.punched_in;
  const worked = state.worked_minutes;
  const onOffice = state.network_status === 'office';
  const enforcing = state.enforcement_mode === 'enforce';
  // Two independent reasons the button can be unavailable. Kept apart because
  // "you are outside the office network" and "it is 3am" need different
  // sentences -- telling someone their Wi-Fi is wrong at 3am sends them
  // hunting for a router problem that does not exist.
  const outsideHours = state.window_blocks_next;
  const blocked = enforcing && !onOffice && !state.network_exempt && !outsideHours;

  const NetIcon = onOffice ? ShieldCheck : state.network_status === 'unknown' ? WifiOff : ShieldAlert;
  const netRgb = onOffice ? '16,185,129' : enforcing ? '245,158,11' : '148,163,184';
  const netLabel = onOffice
    ? (state.network_name || 'Office network')
    : state.network_status === 'unknown' ? 'Network not detected' : 'Outside the office network';

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      {/* Header: greeting + live clock */}
      <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-4 flex-wrap">
        <div>
          {!compact && (
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
              {greeting(Number(now.toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: IST })))}
            </p>
          )}
          <p className="text-base font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
            {compact ? 'Today’s Attendance' : employeeName.split(' ')[0]}
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {new Date(state.work_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            {' · '}{state.office_start?.slice(0, 5)}–{state.office_end?.slice(0, 5)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums leading-none" style={{ color: 'var(--text-primary)' }}>
            {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: IST })}
          </p>
          <p className="text-[11px] mt-1 tabular-nums" style={{ color: 'var(--text-faint)' }}>
            {now.toLocaleTimeString('en-IN', { second: '2-digit', timeZone: IST })} IST
          </p>
        </div>
      </div>

      {/* The three facts that matter */}
      <div className="px-5 pb-4 grid grid-cols-3 gap-3">
        <Fact label="Punch In"  value={timeIST(state.first_in_at)} />
        <Fact label="Punch Out" value={timeIST(state.last_out_at)} />
        <Fact label="Working"   value={formatDuration(worked)} />
      </div>

      {/* Network verdict -- server decided */}
      <div className="mx-5 mb-4 px-3.5 py-2.5 rounded-xl flex items-center gap-2.5"
        style={{ background: `rgba(${netRgb},0.08)`, border: `1px solid rgba(${netRgb},0.25)` }}>
        <NetIcon className="w-4 h-4 flex-shrink-0" style={{ color: `rgb(${netRgb})` }} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold truncate" style={{ color: `rgb(${netRgb})` }}>{netLabel}</p>
          {!onOffice && !enforcing && (
            <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              Recorded for review — network checks are not being enforced yet.
            </p>
          )}
          {state.network_exempt && (
            <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              You are exempt from the office network requirement.
            </p>
          )}
        </div>
        {(state.is_late || state.has_pending_punch) && (
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {state.is_late && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md"
                style={{ background: 'rgba(245,158,11,0.14)', color: 'rgb(245,158,11)' }}>
                Late {state.late_minutes}m
              </span>
            )}
          </div>
        )}
      </div>

      {outsideHours && (
        <div className="mx-5 mb-4">
          <Notice tone="warn" title={state.day_blocked ? 'Not a working day' : 'Outside permitted hours'}>
            {state.day_blocked
              ? 'Attendance cannot be punched today. If you are working, ask an administrator to record it as an attendance correction.'
              : <>Attendance can be punched between <strong>{state.window_start?.slice(0, 5)}</strong> and{' '}
                 <strong>{state.window_end?.slice(0, 5)}</strong>. If you are working outside these hours, ask an
                 administrator to record it as an attendance correction.</>}
          </Notice>
        </div>
      )}

      {blocked && (
        <div className="mx-5 mb-4">
          <Notice tone="warn" title="Attendance not allowed from here">
            You are currently outside the approved office network. Connect to the Niyom office Wi-Fi and try again —
            or punch anyway and it will be held for an admin to approve.
          </Notice>
        </div>
      )}

      {state.has_pending_punch && (
        <div className="mx-5 mb-4">
          <Notice tone="warn" title="Waiting for approval">
            One of today’s punches was made outside the office network. It does not count towards your hours until an
            administrator approves it.
          </Notice>
        </div>
      )}

      {message && (
        <div className="mx-5 mb-4">
          <Notice tone={message.ok ? 'good' : 'warn'}>{message.text}</Notice>
        </div>
      )}

      {/* The button */}
      <div className="px-5 pb-5">
        <button
          onClick={doPunch}
          disabled={busy || outsideHours}
          title={outsideHours ? 'Attendance cannot be punched at this time' : undefined}
          className="w-full py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2.5 transition-all disabled:opacity-60 active:scale-[0.99]"
          style={{
            background: isIn ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.14)',
            color: isIn ? 'rgb(239,68,68)' : 'rgb(16,185,129)',
            border: `1px solid ${isIn ? 'rgba(239,68,68,0.35)' : 'rgba(16,185,129,0.4)'}`,
          }}>
          {busy ? <Clock className="w-4 h-4 animate-spin" /> : isIn ? <LogOut className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
          {busy ? 'Recording…' : outsideHours ? 'OUTSIDE PERMITTED HOURS' : isIn ? 'PUNCH OUT' : 'PUNCH IN'}
        </button>
      </div>

      {/* Timeline -- full variant only */}
      {!compact && state.timeline.length > 0 && (
        <div className="px-5 pb-5">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>
            Today’s timeline
          </p>
          <ol className="space-y-1.5">
            {state.timeline.map((t, i) => (
              <li key={i} className="flex items-center gap-2.5 text-xs">
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: t.type === 'in' ? 'rgb(16,185,129)' : 'rgb(239,68,68)' }} />
                <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{timeIST(t.at)}</span>
                <span style={{ color: 'var(--text-muted)' }}>{t.type === 'in' ? 'Punched in' : 'Punched out'}</span>
                {t.network !== 'office' && (
                  <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
                    <MapPin className="w-3 h-3" /> off network
                  </span>
                )}
                {t.approval === 'pending' && (
                  <span className="ml-auto text-[11px] font-semibold px-1.5 py-0.5 rounded-md"
                    style={{ background: 'rgba(245,158,11,0.14)', color: 'rgb(245,158,11)' }}>
                    awaiting approval
                  </span>
                )}
                {t.approval === 'rejected' && (
                  <span className="ml-auto text-[11px] font-semibold px-1.5 py-0.5 rounded-md"
                    style={{ background: 'rgba(239,68,68,0.14)', color: 'rgb(239,68,68)' }}>
                    rejected
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2.5 rounded-xl" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</p>
      <p className="text-sm font-bold mt-1 tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  );
}
