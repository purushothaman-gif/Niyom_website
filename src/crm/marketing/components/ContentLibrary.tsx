// Admin library: search, filter and open every piece of content, plus the
// history of what has already been deleted or expired.

import { useState } from 'react';
import { Search, Plus, Sparkles, BarChart3, History } from 'lucide-react';
import {
  CONTENT_CATEGORIES, CONTENT_TYPES, PLATFORMS,
} from '../marketingConstants';
import { ContentFilters, ContentStatus, ContentType, EMPTY_FILTERS, MktContent } from '../marketingTypes';
import { useContentHistory, useContentList } from '../marketingClient';
import { EmptyState, ExpiryCountdown, GhostButton, PrimaryButton, StatusPill, inputClass, inputStyle } from './shared';

interface Props {
  onOpen: (content: MktContent) => void;
  onNew: () => void;
  onAnalytics: () => void;
}

const STATUSES: (ContentStatus | 'all')[] = ['all', 'draft', 'approved', 'rejected', 'archived'];

export default function ContentLibrary({ onOpen, onNew, onAnalytics }: Props) {
  const [filters, setFilters] = useState<ContentFilters>(EMPTY_FILTERS);
  const [showHistory, setShowHistory] = useState(false);

  const { data: content = [], isLoading, error } = useContentList(filters);
  const { data: history = [] } = useContentHistory(showHistory ? filters.search : '');

  const set = (patch: Partial<ContentFilters>) => setFilters(f => ({ ...f, ...patch }));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
            Marketing Tool
          </p>
          <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>Content Creation</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {content.length} {content.length === 1 ? 'item' : 'items'} · approved content expires 48 hours after it goes live
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GhostButton onClick={onAnalytics} className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Analytics
          </GhostButton>
          <PrimaryButton onClick={onNew} className="flex items-center gap-2">
            <Plus className="w-4 h-4" /> New content
          </PrimaryButton>
        </div>
      </div>

      {/* filters */}
      <div className="rounded-2xl p-4 mb-5 space-y-3"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input className={`${inputClass} pl-9`} style={inputStyle}
            placeholder="Search title, headline, topic, caption or reference…"
            value={filters.search} onChange={e => set({ search: e.target.value })} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          <select className={inputClass} style={inputStyle} value={filters.status}
            onChange={e => set({ status: e.target.value as ContentStatus | 'all' })}>
            {STATUSES.map(s => (
              <option key={s} value={s}>{s === 'all' ? 'All statuses' : s[0].toUpperCase() + s.slice(1)}</option>
            ))}
          </select>

          <select className={inputClass} style={inputStyle} value={filters.contentType}
            onChange={e => set({ contentType: e.target.value as ContentType | 'all' })}>
            <option value="all">All types</option>
            {CONTENT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>

          <select className={inputClass} style={inputStyle} value={filters.platform}
            onChange={e => set({ platform: e.target.value })}>
            <option value="all">All platforms</option>
            {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>

          <select className={inputClass} style={inputStyle} value={filters.category}
            onChange={e => set({ category: e.target.value })}>
            <option value="all">All categories</option>
            {CONTENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <input type="date" className={inputClass} style={inputStyle} value={filters.fromDate}
            onChange={e => set({ fromDate: e.target.value })} />
          <input type="date" className={inputClass} style={inputStyle} value={filters.toDate}
            onChange={e => set({ toDate: e.target.value })} />
        </div>

        <div className="flex items-center justify-between">
          <button onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-xs transition hover:opacity-80" style={{ color: 'var(--accent-soft)' }}>
            Reset filters
          </button>
          <button onClick={() => setShowHistory(h => !h)}
            className="text-xs flex items-center gap-1.5 transition hover:opacity-80"
            style={{ color: showHistory ? 'var(--accent-soft)' : 'var(--text-muted)' }}>
            <History className="w-3.5 h-3.5" /> {showHistory ? 'Hide' : 'Show'} deleted &amp; expired
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl p-3 mb-4 text-sm"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
          {error instanceof Error ? error.message : 'Could not load content'}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : content.length === 0 ? (
        <EmptyState icon={Sparkles} title="No content yet"
          message="Generate your first educational post — employees will see it as soon as you approve it."
          action={<PrimaryButton onClick={onNew}>Create content</PrimaryButton>} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {content.map(c => (
            <button key={c.id} onClick={() => onOpen(c)}
              className="text-left rounded-2xl p-4 transition hover:opacity-90"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <StatusPill status={c.status} />
                <span className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{c.content_no}</span>
              </div>
              <p className="text-sm font-bold line-clamp-2" style={{ color: 'var(--text-primary)' }}>
                {c.title || c.headline}
              </p>
              <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-muted)' }}>{c.headline}</p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="px-2 py-0.5 rounded-md text-xs"
                  style={{ background: 'var(--bg-base)', color: 'var(--text-muted)' }}>
                  {CONTENT_TYPES.find(t => t.id === c.content_type)?.label ?? c.content_type}
                </span>
                <span className="px-2 py-0.5 rounded-md text-xs"
                  style={{ background: 'var(--bg-base)', color: 'var(--text-muted)' }}>
                  {c.category}
                </span>
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {new Date(c.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </span>
                {c.status === 'approved' && <ExpiryCountdown expiresAt={c.expires_at} compact />}
              </div>
            </button>
          ))}
        </div>
      )}

      {showHistory && (
        <div className="mt-8">
          <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>
            Deleted &amp; expired ({history.length})
          </h2>
          <p className="text-xs mb-3" style={{ color: 'var(--text-faint)' }}>
            Posters, captions and videos are permanently gone. Only this record is kept, so the AI can avoid
            repeating topics and the analytics stay accurate.
          </p>
          <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-surface)' }}>
                  {['Reference', 'Title', 'Category', 'Type', 'Downloads', 'Removed', 'Reason'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-xs font-semibold"
                      style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-xs"
                    style={{ color: 'var(--text-faint)', background: 'var(--bg-base)' }}>
                    Nothing has been deleted or expired yet.
                  </td></tr>
                ) : history.map(h => (
                  <tr key={h.content_no} style={{ background: 'var(--bg-base)', borderTop: '1px solid var(--border-subtle)' }}>
                    <td className="px-3 py-2 text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{h.content_no}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-primary)' }}>{h.title}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{h.category}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{h.content_type}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{h.download_count}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {new Date(h.deleted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {h.delete_reason === 'expired' ? 'Expired (48h)' : 'Deleted by admin'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
