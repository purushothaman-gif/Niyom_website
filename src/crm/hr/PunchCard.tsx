/**
 * The attendance punch card.
 *
 * This is the one HR screen most people will use every day, on a phone, in a
 * hurry -- so it is a single card with a live clock, the current state, an
 * honest statement about the network, and one big button. Nothing else.
 *
 * Presence is verified by LOCATION, not by which network the phone is on. The
 * browser reports a GPS fix; the server holds the office coordinates, computes
 * the distance itself and decides. The card is never told where the office is
 * or how large the geofence is -- that is exactly what someone would need to
 * fake a convincing position. It is told a verdict and a rounded distance.
 *
 * Disabling the button is a courtesy, not a control: the same checks run again
 * inside the punch endpoint, which is the only thing that can create a punch.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, LogIn, LogOut, MapPin, MapPinOff, Navigation, ShieldCheck } from 'lucide-react';
import { getPunchState, punch } from './hrApi';
import { getPosition, formatDistance, type GeoResult } from './geolocation';
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
  // The last fix we obtained, and whatever went wrong getting one. Kept apart
  // so a stale fix is never silently reused after a later failure.
  const [geo, setGeo] = useState<GeoResult | null>(null);
  const [locating, setLocating] = useState(true);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    setLocating(true);
    try {
      /*
       * STATE FIRST, with no position attached.
       *
       * Asking the browser for GPS before knowing whether anything wants it
       * raises a permission prompt on a system that is not using location, and
       * the punch button sits disabled behind it for as long as the prompt
       * goes unanswered. That is what stopped five people punching out on
       * 31 August 2026: their punches did go through, but only after a wait
       * long enough to read as a broken button, so they filed corrections for
       * attendance they had already recorded.
       *
       * Nothing is asked of the browser until the server says location is
       * actually being checked.
       */
      const first = await getPunchState();
      if (!mounted.current) return;
      if ((first as { error?: string }).error) {
        setMessage({ text: (first as { error?: string }).error!, ok: false });
        return;
      }
      setState(first);

      if (first.location_mode === 'off') {
        setGeo(null);
        return;
      }

      // Location is being checked, so now the prompt is worth raising. The
      // card is already usable at this point; this only refines the verdict.
      const fix = await getPosition();
      if (!mounted.current) return;
      setGeo(fix);

      const refined = await getPunchState(
        fix.ok ? { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy } : undefined);
      if (!mounted.current) return;
      if (!(refined as { error?: string }).error) setState(refined);
    } catch (err) {
      if (mounted.current) setMessage({ text: hrError(err, 'Could not load your attendance.'), ok: false });
    } finally {
      if (mounted.current) { setLoading(false); setLocating(false); }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /*
   * A ticking clock, and a slower refresh so the worked-time figure and the
   * location verdict stay honest if someone walks out mid-shift.
   *
   * Five minutes, not the two this used when the verdict came from the network.
   * Each refresh now takes a real high-accuracy GPS reading, and polling the
   * satellite chip every two minutes drains a phone for a number that changes
   * a few times a day.
   */
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 1000);
    const refresh = window.setInterval(load, 300_000);
    return () => { window.clearInterval(tick); window.clearInterval(refresh); };
  }, [load]);

  const doPunch = async () => {
    if (!state || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      /*
       * A FRESH fix when location is being checked -- not the one from page
       * load. Someone could otherwise open the page at the office and press
       * the button an hour later from elsewhere, and the stale coordinates
       * would still say "inside".
       *
       * When location is off, nothing is asked of the browser at all. Waiting
       * on a GPS fix nobody is going to look at is how a working punch button
       * comes to feel broken.
       */
      let fix: GeoResult | null = null;
      if (state.location_mode !== 'off') {
        fix = await getPosition();
        if (!mounted.current) return;
        setGeo(fix);

        if (!fix.ok && state.location_mode === 'enforce' && !state.location_exempt) {
          setMessage({ text: fix.message, ok: false });
          return;
        }
      }

      const res = await punch(
        state.next_action,
        fix?.ok ? { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy } : undefined);
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
  const enforcing = state.location_mode === 'enforce';
  const inside = state.location_status === 'inside';
  // Two independent reasons the button can be unavailable. Kept apart because
  // "you are not at the office" and "it is 3am" need different sentences --
  // telling someone their location is wrong at 3am sends them walking to a desk
  // that will not help.
  const outsideHours = state.window_blocks_next;
  // Blocked on LOCATION, and only when that is the actual reason -- an
  // out-of-hours punch gets its own message below rather than being reported as
  // a location problem.
  const blocked = enforcing && !state.location_ok && !outsideHours;

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

      {/* Where you are, as the server judged it. Never the office position. */}
      {state.location_mode !== 'off' && (() => {
        const rgb = locating ? '148,163,184'
          : inside ? '16,185,129'
          : state.location_status === 'not_configured' ? '148,163,184'
          : enforcing ? '239,68,68' : '245,158,11';
        const Icon = locating ? Navigation : inside ? ShieldCheck : MapPinOff;
        const headline = locating ? 'Checking your office location…'
          : inside ? 'You are within the office attendance area.'
          : state.location_status === 'outside' ? 'Attendance can only be marked from the Niyom office.'
          : state.location_status === 'inaccurate' ? 'Your location is not precise enough yet.'
          : state.location_status === 'mock' ? 'Your device is reporting a simulated location.'
          : state.location_status === 'not_configured' ? 'Office location has not been set up yet.'
          : (geo && !geo.ok ? geo.message : 'Your location could not be read.');
        return (
          <div className="mx-5 mb-4 px-3.5 py-2.5 rounded-xl flex items-start gap-2.5"
            style={{ background: `rgba(${rgb},0.08)`, border: `1px solid rgba(${rgb},0.25)` }}>
            <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${locating ? 'animate-pulse' : ''}`}
              style={{ color: `rgb(${rgb})` }} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold" style={{ color: `rgb(${rgb})` }}>
                {inside && '✓ '}{headline}
              </p>
              {!locating && state.distance_m !== null && !inside && (
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  You are approximately {formatDistance(state.distance_m)} from the office.
                </p>
              )}
              {!locating && !inside && !enforcing && state.location_status !== 'not_configured' && (
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                  Recorded for review — location checks are not being enforced yet.
                </p>
              )}
              {state.location_exempt && (
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                  You are exempt from the office location requirement.
                </p>
              )}
              {!locating && !inside && (
                <button onClick={load} className="text-[11px] font-semibold mt-1 underline"
                  style={{ color: `rgb(${rgb})` }}>
                  Check my location again
                </button>
              )}
            </div>
            {state.is_late && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md flex-shrink-0"
                style={{ background: 'rgba(245,158,11,0.14)', color: 'rgb(245,158,11)' }}>
                Late {state.late_minutes}m
              </span>
            )}
          </div>
        );
      })()}

      {blocked && (
        <div className="mx-5 mb-4">
          <Notice tone="warn" title="Attendance not allowed from here">
            {state.location_status === 'outside'
              ? <>You need to be at the Niyom office to mark attendance. If you are at the office and still see this,
                  step near a window so your phone can get a clearer signal, then check again.</>
              : geo && !geo.ok ? geo.message
              : 'Your location could not be confirmed. Check that location access is on for this site and try again.'}
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
          disabled={busy || outsideHours || (locating && state.location_mode !== 'off')}
          title={outsideHours ? 'Attendance cannot be punched at this time' : undefined}
          className="w-full py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2.5 transition-all disabled:opacity-60 active:scale-[0.99]"
          style={{
            background: isIn ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.14)',
            color: isIn ? 'rgb(239,68,68)' : 'rgb(16,185,129)',
            border: `1px solid ${isIn ? 'rgba(239,68,68,0.35)' : 'rgba(16,185,129,0.4)'}`,
          }}>
          {busy ? <Clock className="w-4 h-4 animate-spin" /> : isIn ? <LogOut className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
          {busy ? (state.location_mode === 'off' ? 'Recording…' : 'Checking your location…')
            : outsideHours ? 'OUTSIDE PERMITTED HOURS'
            : locating && state.location_mode !== 'off' ? 'CHECKING LOCATION…'
            : isIn ? 'PUNCH OUT' : 'PUNCH IN'}
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
                {t.location && t.location !== 'inside' && (
                  <span className="inline-flex items-center gap-1" style={{ color: 'var(--text-faint)' }}>
                    <MapPin className="w-3 h-3" />
                    {t.location === 'outside' && t.distance_m != null
                      ? formatDistance(t.distance_m) + ' away'
                      : t.location.replace(/_/g, ' ')}
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
