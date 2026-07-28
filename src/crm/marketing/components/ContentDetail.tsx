// Admin detail view: review the copy and artwork, edit, then approve, reject,
// schedule, archive or delete.

import { useMemo, useState } from 'react';
import {
  ArrowLeft, Check, X, Archive, Trash2, Save, Calendar, AlertTriangle,
} from 'lucide-react';
import { NWEmployee } from '../../types';
import { CONTENT_TYPES, formatHashtags, lintContent, REF_LINK_PLACEHOLDER } from '../marketingConstants';
import { MktContent } from '../marketingTypes';
import {
  useContentAssets, useDeleteContent, useSetContentStatus, useUpdateContent,
} from '../marketingClient';
import { AssetThumb } from './AssetPreview';
import {
  ExpiryCountdown, Field, GhostButton, LintBadges, PrimaryButton, StatusPill,
  inputClass, inputStyle,
} from './shared';

interface Props {
  content: MktContent;
  employee: NWEmployee;
  onBack: () => void;
  onChanged: (c: MktContent) => void;
  onDeleted: () => void;
}

export default function ContentDetail({ content, employee, onBack, onChanged, onDeleted }: Props) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(content);
  const [rejectNote, setRejectNote] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [schedule, setSchedule] = useState(content.scheduled_publish_at?.slice(0, 16) ?? '');
  const [error, setError] = useState<string | null>(null);

  const { data: assets = [] } = useContentAssets(content.id);
  const update = useUpdateContent();
  const setStatus = useSetContentStatus();
  const remove = useDeleteContent();

  const findings = useMemo(
    () => lintContent({
      title: form.title, headline: form.headline, body: form.body,
      caption: form.caption, cta: form.cta, hashtags: form.hashtags,
    }),
    [form],
  );

  const placeholderCount = form.caption.split(REF_LINK_PLACEHOLDER).length - 1;
  const blocked = findings.length > 0 || placeholderCount !== 1;

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setError(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    }
  };

  const handleSave = () => run(async () => {
    const saved = await update.mutateAsync({
      id: content.id, actorId: employee.id,
      patch: {
        title: form.title, headline: form.headline, body: form.body,
        caption: form.caption, cta: form.cta, hashtags: form.hashtags,
        seo_keywords: form.seo_keywords, suggested_post_time: form.suggested_post_time,
        scheduled_publish_at: schedule ? new Date(schedule).toISOString() : null,
      },
    });
    onChanged(saved);
    setForm(saved);
    setEditing(false);
  });

  const handleStatus = (action: 'approved' | 'rejected' | 'archived', note?: string) =>
    run(async () => {
      const updated = await setStatus.mutateAsync({ id: content.id, action, note });
      onChanged(updated);
      setForm(updated);
      setShowReject(false);
    });

  const handleDelete = () => run(
    () => remove.mutateAsync({ contentId: content.id, note: 'Deleted from content detail' }),
    onDeleted,
  );

  const busy = update.isPending || setStatus.isPending || remove.isPending;

  return (
    <div>
      <button onClick={onBack}
        className="flex items-center gap-1.5 text-sm mb-4 transition-colors hover:opacity-80"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft className="w-4 h-4" /> Back to library
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <StatusPill status={form.status} />
            <span className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{form.content_no}</span>
            {form.status === 'approved' && <ExpiryCountdown expiresAt={form.expires_at} />}
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{form.title}</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {CONTENT_TYPES.find(t => t.id === form.content_type)?.label} · {form.category} · {form.platforms.join(', ')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {form.status === 'draft' && (
            <>
              <PrimaryButton onClick={() => handleStatus('approved')} disabled={busy || blocked}
                className="flex items-center gap-2"
                title={blocked ? 'Resolve the compliance issues before approving' : undefined}>
                <Check className="w-4 h-4" /> Approve
              </PrimaryButton>
              <GhostButton onClick={() => setShowReject(s => !s)} disabled={busy}
                className="flex items-center gap-2">
                <X className="w-4 h-4" /> Reject
              </GhostButton>
            </>
          )}
          {form.status === 'approved' && (
            <GhostButton onClick={() => handleStatus('archived')} disabled={busy}
              className="flex items-center gap-2">
              <Archive className="w-4 h-4" /> Archive
            </GhostButton>
          )}
          {(form.status === 'rejected' || form.status === 'archived') && (
            <PrimaryButton onClick={() => handleStatus('approved')} disabled={busy || blocked}
              className="flex items-center gap-2">
              <Check className="w-4 h-4" /> Approve
            </PrimaryButton>
          )}
          <GhostButton onClick={() => setConfirmDelete(true)} disabled={busy}
            className="flex items-center gap-2" style={{ color: '#ef4444' }}>
            <Trash2 className="w-4 h-4" /> Delete
          </GhostButton>
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-3 mb-4 text-sm"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      {blocked && form.status === 'draft' && (
        <div className="mb-4">
          <LintBadges findings={findings} />
          {placeholderCount !== 1 && (
            <div className="rounded-xl p-3 mt-2 text-xs"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
              The caption must contain <code>{REF_LINK_PLACEHOLDER}</code> exactly once
              (found {placeholderCount}). Approval is blocked until this is fixed.
            </div>
          )}
        </div>
      )}

      {showReject && (
        <div className="rounded-2xl p-4 mb-4 space-y-3"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <Field label="Reason for rejection">
            <input className={inputClass} style={inputStyle} value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              placeholder="What needs to change?" />
          </Field>
          <div className="flex gap-2">
            <PrimaryButton onClick={() => handleStatus('rejected', rejectNote)} disabled={busy}>
              Confirm rejection
            </PrimaryButton>
            <GhostButton onClick={() => setShowReject(false)}>Cancel</GhostButton>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="rounded-2xl p-4 mb-4"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <p className="text-sm font-bold flex items-center gap-2 mb-1" style={{ color: '#ef4444' }}>
            <AlertTriangle className="w-4 h-4" /> Delete {form.content_no} permanently?
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
            The copy and every rendered poster or video will be erased from the database and storage immediately.
            Employees lose access at once. There is no backup and no recycle bin — only a slim record
            (title, category, counts) is kept for reporting.
          </p>
          <div className="flex gap-2">
            <PrimaryButton onClick={handleDelete} disabled={busy} style={{ background: '#ef4444', color: '#fff' }}>
              {remove.isPending ? 'Deleting…' : 'Delete permanently'}
            </PrimaryButton>
            <GhostButton onClick={() => setConfirmDelete(false)}>Cancel</GhostButton>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* copy */}
        <div className="rounded-2xl p-5 space-y-4"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Copy</p>
            {editing ? (
              <div className="flex gap-2">
                <PrimaryButton onClick={handleSave} disabled={busy} className="flex items-center gap-1.5 !px-3 !py-1.5">
                  <Save className="w-3.5 h-3.5" /> Save
                </PrimaryButton>
                <GhostButton onClick={() => { setForm(content); setEditing(false); }} className="!px-3 !py-1.5">
                  Cancel
                </GhostButton>
              </div>
            ) : (
              <GhostButton onClick={() => setEditing(true)} className="!px-3 !py-1.5">Edit</GhostButton>
            )}
          </div>

          {editing ? (
            <>
              <Field label="Title">
                <input className={inputClass} style={inputStyle} value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })} />
              </Field>
              <Field label="Headline">
                <textarea className={inputClass} style={{ ...inputStyle, minHeight: 60 }} value={form.headline}
                  onChange={e => setForm({ ...form, headline: e.target.value })} />
              </Field>
              <Field label="Body">
                <textarea className={inputClass} style={{ ...inputStyle, minHeight: 80 }} value={form.body}
                  onChange={e => setForm({ ...form, body: e.target.value })} />
              </Field>
              <Field label="Caption">
                <textarea className={inputClass} style={{ ...inputStyle, minHeight: 130 }} value={form.caption}
                  onChange={e => setForm({ ...form, caption: e.target.value })} />
              </Field>
              <Field label="Call to action">
                <input className={inputClass} style={inputStyle} value={form.cta}
                  onChange={e => setForm({ ...form, cta: e.target.value })} />
              </Field>
              <Field label="Hashtags">
                <textarea className={inputClass} style={{ ...inputStyle, minHeight: 60 }}
                  value={formatHashtags(form.hashtags)}
                  onChange={e => setForm({
                    ...form,
                    hashtags: e.target.value.split(/[\s,]+/).map(h => h.replace(/^#/, '')).filter(Boolean),
                  })} />
              </Field>
              <Field label="Schedule visibility" hint="optional — the 48h window starts when it goes live">
                <input type="datetime-local" className={inputClass} style={inputStyle} value={schedule}
                  onChange={e => setSchedule(e.target.value)} />
              </Field>
            </>
          ) : (
            <div className="space-y-3">
              <Readout label="Headline" value={form.headline} />
              <Readout label="Body" value={form.body} />
              <Readout label="Caption" value={form.caption} mono />
              <Readout label="Call to action" value={form.cta} />
              <Readout label="Hashtags" value={formatHashtags(form.hashtags)} />
              <Readout label="Suggested time" value={form.suggested_post_time} />
              {form.seo_keywords.length > 0 && (
                <Readout label="SEO keywords" value={form.seo_keywords.join(', ')} />
              )}
              {form.scheduled_publish_at && (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--accent-soft)' }}>
                  <Calendar className="w-3.5 h-3.5" />
                  Goes live {new Date(form.scheduled_publish_at).toLocaleString('en-IN')}
                </div>
              )}
              {form.reject_reason && (
                <Readout label="Rejection note" value={form.reject_reason} />
              )}
            </div>
          )}
        </div>

        {/* artwork */}
        <div className="rounded-2xl p-5"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <p className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
            Artwork ({assets.length})
          </p>
          {assets.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              No artwork was rendered for this item. Employees will still get the caption and hashtags.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {assets.map(a => (
                <div key={a.id} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
                  <AssetThumb asset={a} />
                  <p className="text-xs px-2 py-1.5" style={{ color: 'var(--text-faint)' }}>
                    {a.variant} {a.width ? `· ${a.width}×${a.height}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Readout({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>{label}</p>
      <p className={`text-sm mt-0.5 whitespace-pre-wrap ${mono ? 'font-mono text-xs' : ''}`}
        style={{ color: 'var(--text-secondary)' }}>{value}</p>
    </div>
  );
}
