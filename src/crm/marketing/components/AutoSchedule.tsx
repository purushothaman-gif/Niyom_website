// Automated daily batch — the admin's window onto the rotation.
//
// The point of this screen is that the rotation is checkable BEFORE any tokens
// are spent or anything is published. Three posts a day chosen by an algorithm
// is only trustworthy if a person can see, at a glance, that tomorrow is three
// different categories on three different platforms with one video — and that
// the Mon-Fri plus 1st/3rd-Saturday pattern is actually what is planned.
//
// Read-only apart from blocking a date. Everything else is written by the
// planner and the pipelines; there is nothing to edit here by design.

import { useMemo, useState } from 'react';
import {
  AlertTriangle, PauseCircle, CalendarClock, CalendarOff, CheckCircle2, ChevronLeft,
  Clock, Facebook, Film, Instagram, Layers, Linkedin, RefreshCw,
} from 'lucide-react';
import {
  useAutoCycleStatus, useAutoSchedule, useAutomationStatus, usePlanAhead, useSkipDay,
} from '../marketingClient';
import { CONTENT_TYPES } from '../marketingConstants';
import { AutoSlotState, MktAutoDay, MktAutoSlot } from '../marketingTypes';
import { EmptyState, GhostButton, PrimaryButton } from './shared';

interface Props {
  onBack: () => void;
}

const PLATFORM_ICON: Record<string, React.ElementType> = {
  instagram: Instagram,
  facebook: Facebook,
  linkedin: Linkedin,
};

const TYPE_LABEL = new Map(CONTENT_TYPES.map(t => [t.id as string, t.label as string]));
const IS_VIDEO = new Set(CONTENT_TYPES.filter(t => t.video).map(t => t.id as string));
const IS_DECK = new Set(CONTENT_TYPES.filter(t => t.slides).map(t => t.id as string));

/*
 * Colour carries the state, so the strip is scannable without reading it.
 * Amber deliberately covers both "flagged" and "still a draft": from an admin's
 * point of view those are the same job — something needs a human before it can
 * go out.
 */
const STATE_STYLE: Record<AutoSlotState, { fg: string; bg: string; label: string }> = {
  planned:    { fg: 'var(--text-muted)', bg: 'rgba(142,160,181,0.12)', label: 'Planned' },
  generating: { fg: 'rgb(var(--c-cyan-rgb))',           bg: 'rgba(var(--c-cyan-rgb),0.12)',  label: 'Writing' },
  generated:  { fg: 'rgb(var(--warning-soft-rgb))',           bg: 'rgba(var(--warning-soft-rgb),0.12)',  label: 'Generated' },
  rendering:  { fg: 'rgb(var(--c-cyan-rgb))',           bg: 'rgba(var(--c-cyan-rgb),0.12)',  label: 'Rendering' },
  rendered:   { fg: 'rgb(var(--warning-soft-rgb))',           bg: 'rgba(var(--warning-soft-rgb),0.12)',  label: 'Rendered' },
  approved:   { fg: 'var(--success-soft)',           bg: 'rgba(var(--success-soft-rgb),0.14)',   label: 'Live' },
  flagged:    { fg: 'rgb(var(--warning-soft-rgb))',           bg: 'rgba(var(--warning-soft-rgb),0.16)',  label: 'Needs review' },
  failed:     { fg: 'var(--danger-soft)',           bg: 'rgba(var(--danger-soft-rgb),0.14)',   label: 'Failed' },
};

const IST_DATE = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
});
const IST_TIME = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
});

/** Today in IST — the batch calendar is Indian business days, not the viewer's. */
function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function SlotChip({ slot }: { slot: MktAutoSlot }) {
  const Icon = PLATFORM_ICON[slot.platform] ?? Layers;
  const s = STATE_STYLE[slot.state] ?? STATE_STYLE.planned;
  const isVideo = IS_VIDEO.has(slot.content_type);

  return (
    <div className="rounded-xl p-3 flex-1 min-w-0" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
        <span className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
          {TYPE_LABEL.get(slot.content_type) ?? slot.content_type}
        </span>
        {isVideo && <Film className="w-3 h-3 shrink-0" style={{ color: 'var(--accent-soft)' }} />}
        {IS_DECK.has(slot.content_type) && (
          <span className="text-[10px] shrink-0" style={{ color: 'var(--text-faint)' }}>
            {slot.slide_count} slides
          </span>
        )}
      </div>

      <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }} title={slot.category}>
        {slot.category}
      </p>

      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: s.bg, color: s.fg }}>
          {s.label}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
          {slot.palette_id}{slot.template_id ? ` · ${slot.template_id}` : ''}
        </span>
      </div>

      {slot.state === 'flagged' && slot.lint_flags.length > 0 && (
        <p className="text-[10px] mt-1.5" style={{ color: 'rgb(var(--warning-soft-rgb))' }}>
          {slot.lint_flags.length} issue{slot.lint_flags.length === 1 ? '' : 's'}: {slot.lint_flags[0].label}
        </p>
      )}
      {slot.state === 'failed' && slot.error && (
        <p className="text-[10px] mt-1.5 line-clamp-2" style={{ color: 'var(--danger-soft)' }} title={slot.error}>
          {slot.error}
        </p>
      )}
    </div>
  );
}

/** Countdown to the 09:30 IST gate, for today only. */
function PublishCountdown({ publishAt }: { publishAt: string }) {
  const ms = new Date(publishAt).getTime() - Date.now();
  if (ms <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--success-soft)' }}>
        <CheckCircle2 className="w-3.5 h-3.5" /> Gate open since {IST_TIME.format(new Date(publishAt))}
      </span>
    );
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
      <Clock className="w-3.5 h-3.5" /> Goes live in {h >= 1 ? `${h}h ${m}m` : `${m}m`}
    </span>
  );
}

function DayRow({ day, today, automationOn }: { day: MktAutoDay; today: string; automationOn: boolean }) {
  const isToday = day.run_date === today;
  /*
    A day is alarming when the gate has passed and nothing is live — the one
    condition an admin must never scroll past.

    Unless the automation is switched off, in which case an empty day is the
    expected outcome and not a fault. The engine was retired by unscheduling its
    crons, and for three weeks this strip shouted "needs attention" at days
    nobody intended to produce. An alarm that fires for a deliberate decision is
    how people learn to ignore alarms.
  */
  const live = day.slots.filter(s => s.state === 'approved').length;
  const gatePassed = new Date(day.publish_at).getTime() <= Date.now();
  const alarming = automationOn && gatePassed && live === 0 && day.slots.length > 0;

  return (
    <div className="rounded-2xl p-4"
      style={{
        background: isToday ? 'var(--bg-surface)' : 'transparent',
        border: `1px solid ${alarming ? 'rgba(239,68,68,0.45)' : isToday ? 'var(--accent-soft)' : 'var(--border)'}`,
      }}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {IST_DATE.format(new Date(`${day.run_date}T12:00:00Z`))}
          </span>
          {isToday && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold"
              style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>TODAY</span>
          )}
          <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{day.iso_week}</span>
        </div>

        {alarming ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold" style={{ color: 'var(--danger-soft)' }}>
            <AlertTriangle className="w-3.5 h-3.5" /> Nothing live — needs attention
          </span>
        ) : !automationOn ? (
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {live}/{day.slots.length} live · automation paused
          </span>
        ) : isToday ? (
          <PublishCountdown publishAt={day.publish_at} />
        ) : (
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
            {live}/{day.slots.length} live
          </span>
        )}
      </div>

      <div className="flex gap-2 flex-wrap sm:flex-nowrap">
        {day.slots.map(s => <SlotChip key={s.id} slot={s} />)}
        {day.slots.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--danger-soft)' }}>
            Planned but no slots — the rotation failed for this day.
          </p>
        )}
      </div>
    </div>
  );
}

export default function AutoSchedule({ onBack }: Props) {
  const today = todayIst();
  const { data: days = [], isLoading } = useAutoSchedule(3, 14);
  const { data: cycle } = useAutoCycleStatus();
  const { data: automation } = useAutomationStatus();
  // Assume running until the check answers, so a slow query cannot flash a
  // "paused" banner at a healthy system.
  const automationOn = automation?.enabled !== false;
  const planAhead = usePlanAhead();
  const skipDay = useSkipDay();
  const [skipping, setSkipping] = useState<string>('');

  const { todayDay, rest } = useMemo(() => ({
    todayDay: days.find(d => d.run_date === today),
    rest: days.filter(d => d.run_date !== today),
  }), [days, today]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <GhostButton onClick={onBack} className="flex items-center gap-1.5">
            <ChevronLeft className="w-4 h-4" /> Library
          </GhostButton>
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Auto schedule</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Three pieces a day, Mon–Fri plus the 1st and 3rd Saturday. Live to employees at 09:30 IST.
            </p>
          </div>
        </div>

        <PrimaryButton
          onClick={() => planAhead.mutate(14)}
          /* Planning days that nothing will ever generate is what produced the
             orphaned fortnight this banner exists to explain. */
          disabled={planAhead.isPending || !automationOn}
          title={automationOn ? undefined : 'Automation is paused'}
          className="flex items-center gap-2">
          <RefreshCw className={`w-4 h-4 ${planAhead.isPending ? 'animate-spin' : ''}`} />
          {planAhead.isPending ? 'Planning…' : 'Plan ahead'}
        </PrimaryButton>
      </div>

      {!automationOn && (
        /*
          Said once, at the top, instead of implied by a page full of empty
          days. Someone opening this in three months needs to know the silence
          is a decision, not a fault — and needs to know the work is still here
          if they want it back.
        */
        <div className="rounded-2xl p-4 flex items-start gap-3"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <PauseCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
          <div className="min-w-0">
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Automation paused
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              The scheduled jobs that plan, write and render the daily batch are not running, so no
              new content is being produced. Everything already published stays in the library and
              in Analytics, and the Content Studio still works for making pieces by hand.
            </p>
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-faint)' }}>
              Re-scheduling the six cron jobs turns it back on; nothing was deleted.
            </p>
          </div>
        </div>
      )}

      {cycle && automationOn && (
        <div className="rounded-2xl p-4 flex items-center justify-between gap-4 flex-wrap"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              Category rotation
            </p>
            <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
              Cycle {cycle.cycle_no} · {cycle.consumed} of {cycle.total} used
            </p>
            {/* A category cannot recur until the whole circle completes, so this
                bar is also the answer to "when will we see X again?". */}
            <div className="h-1.5 rounded-full mt-2 w-56 overflow-hidden" style={{ background: 'var(--bg-base)' }}>
              <div className="h-full rounded-full"
                style={{ width: `${(cycle.consumed / Math.max(cycle.total, 1)) * 100}%`, background: 'var(--accent)' }} />
            </div>
          </div>
          {cycle.next_up.length > 0 && (
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
                Next up
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                {cycle.next_up.join(' · ')}
              </p>
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading schedule…</p>
      ) : days.length === 0 ? (
        <EmptyState
          icon={automationOn ? CalendarClock : PauseCircle}
          title={automationOn ? 'Nothing planned yet' : 'No schedule — automation is paused'}
          message={automationOn
            ? 'The planner runs at 07:50 IST each day and fills the next two weeks. Use Plan ahead to fill the horizon now.'
            : 'Nothing is scheduled to plan, write or render content. Published work is still in the library and in Analytics, and the Content Studio can make pieces by hand.'}
          /* No "Plan ahead" while paused: booking days that nothing will ever
             generate is what left a fortnight of permanently empty rows here. */
          action={automationOn
            ? <PrimaryButton onClick={() => planAhead.mutate(14)}>Plan ahead</PrimaryButton>
            : undefined} />
      ) : (
        <>
          {todayDay && <DayRow day={todayDay} today={today} automationOn={automationOn} />}
          <div className="space-y-2">
            {rest.map(d => <DayRow key={d.run_date} day={d} today={today} automationOn={automationOn} />)}
          </div>
        </>
      )}

      <div className="rounded-2xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
          <CalendarOff className="w-3.5 h-3.5" /> Block a date
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Holidays are not in any calendar this system knows about. Blocking a date stops the
          planner from using it — and skips it without consuming any categories.
        </p>
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          <input
            type="date"
            value={skipping}
            min={today}
            onChange={e => setSkipping(e.target.value)}
            className="px-3 py-2 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
          <GhostButton
            disabled={!skipping || skipDay.isPending}
            onClick={() => skipDay.mutate(
              { runDate: skipping, reason: 'Blocked by admin' },
              { onSuccess: () => setSkipping('') },
            )}>
            {skipDay.isPending ? 'Blocking…' : 'Block this date'}
          </GhostButton>
        </div>
        {skipDay.isError && (
          <p className="text-xs mt-2" style={{ color: 'var(--danger-soft)' }}>
            Could not block that date. It may already be blocked, or already planned — a planned day
            has to be cleared before it can be skipped.
          </p>
        )}
      </div>
    </div>
  );
}
