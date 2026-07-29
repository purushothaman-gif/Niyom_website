// Employee view: approved, unexpired content ready to post.
//
// The one thing this screen must get right is the referral link. Every caption
// stored in the database carries a {{REF_LINK}} placeholder; it is replaced with
// THIS employee's personal onboarding URL at the moment they copy, so whatever
// lands on the clipboard already attributes any signup back to them.

import { useState } from 'react';
import {
  Copy, Check, Download, Hash, Link2, Sparkles, Search, Share2,
} from 'lucide-react';
import { NWEmployee } from '../../types';
import {
  CONTENT_TYPES, PLATFORMS, applyReferralLink, buildCopyText, buildReferralUrl, formatHashtags,
} from '../marketingConstants';
import { MktAsset, MktContent } from '../marketingTypes';
import { useApprovedGallery, useContentAssets, useMyReferralLink, useRecordEvent } from '../marketingClient';
import { AssetThumb, downloadAsset } from './AssetPreview';
import {
  EmptyState, ExpiryCountdown, GhostButton, inputClass, inputStyle, useCopyFeedback,
} from './shared';

interface Props {
  employee: NWEmployee;
}

export default function EmployeeGallery({ employee }: Props) {
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('all');

  const { data: content = [], isLoading } = useApprovedGallery();
  const { data: refLink } = useMyReferralLink(employee.id);
  const { copied, copy } = useCopyFeedback();

  const refCode = refLink?.ref_code ?? '';

  const visible = content.filter(c => {
    if (platform !== 'all' && !c.platforms.includes(platform)) return false;
    const s = search.trim().toLowerCase();
    if (!s) return true;
    return [c.title, c.headline, c.topic, c.category, c.caption]
      .some(f => (f ?? '').toLowerCase().includes(s));
  });

  return (
    <div>
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
          Marketing Tool
        </p>
        <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>Content Creation</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Ready-to-post educational content. Every caption you copy already contains your personal link.
        </p>
      </div>

      {/* personal link */}
      {refCode && (
        <div className="rounded-2xl p-4 mb-5 flex flex-wrap items-center justify-between gap-3"
          style={{ background: 'rgba(var(--accent-soft-rgb),0.08)', border: '1px solid rgba(var(--accent-soft-rgb),0.25)' }}>
          <div className="min-w-0">
            <p className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--accent-soft)' }}>
              <Link2 className="w-3.5 h-3.5" /> Your personal onboarding link
            </p>
            <p className="text-xs font-mono mt-1 truncate" style={{ color: 'var(--text-muted)' }}>
              {buildReferralUrl(refCode)}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
              Anyone who signs up through this link is automatically assigned to you.
            </p>
          </div>
          <GhostButton onClick={() => copy('my-link', buildReferralUrl(refCode))}
            className="flex items-center gap-2 flex-shrink-0">
            {copied === 'my-link' ? <><Check className="w-4 h-4" /> Copied</> : <><Copy className="w-4 h-4" /> Copy link</>}
          </GhostButton>
        </div>
      )}

      {/* filters */}
      <div className="flex flex-wrap gap-2 mb-5">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
          <input className={`${inputClass} pl-9`} style={inputStyle} placeholder="Search content…"
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className={inputClass} style={{ ...inputStyle, maxWidth: 180 }} value={platform}
          onChange={e => setPlatform(e.target.value)}>
          <option value="all">All platforms</option>
          {PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState icon={Sparkles} title="No content available right now"
          message="Approved content appears here for 48 hours. Check back soon — new posts are added regularly." />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {visible.map(c => (
            <GalleryCard key={c.id} content={c} employee={employee} refCode={refCode}
              copied={copied} copy={copy} />
          ))}
        </div>
      )}
    </div>
  );
}

function GalleryCard({ content, employee, refCode, copied, copy }: {
  content: MktContent;
  employee: NWEmployee;
  refCode: string;
  copied: string | null;
  copy: (key: string, text: string) => Promise<boolean>;
}) {
  const { data: assets = [] } = useContentAssets(content.id);
  const recordEvent = useRecordEvent();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const primaryPlatform = content.platforms[0] ?? '';

  // Activity logging must never get in the way of the employee's action.
  const log = (eventType: Parameters<typeof recordEvent.mutateAsync>[0]['eventType'], variant?: string) => {
    recordEvent.mutate({
      contentId: content.id, contentNo: content.content_no,
      employeeId: employee.id, eventType, variant, platform: primaryPlatform,
    });
  };

  const handleCopyCaption = async () => {
    const text = buildCopyText(content.caption, content.hashtags, refCode, content.content_no, primaryPlatform);
    if (await copy(`cap-${content.id}`, text)) log('copy_caption');
  };

  const handleCopyHashtags = async () => {
    if (await copy(`tags-${content.id}`, formatHashtags(content.hashtags))) log('copy_hashtags');
  };

  const handleCopyLink = async () => {
    const url = buildReferralUrl(refCode, content.content_no, primaryPlatform);
    if (await copy(`link-${content.id}`, url)) log('share_link');
  };

  const handleDownload = async (asset: MktAsset) => {
    setDownloading(asset.id);
    setError(null);
    try {
      await downloadAsset(asset, content.content_no);
      log(asset.kind === 'video' ? 'download_video' : 'download_poster', asset.variant);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  const captionPreview = refCode
    ? applyReferralLink(content.caption, refCode, content.content_no, primaryPlatform)
    : content.caption;

  return (
    <div className="rounded-2xl overflow-hidden flex flex-col"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      {assets.length > 0 && (
        <div className="grid gap-px" style={{
          gridTemplateColumns: `repeat(${Math.min(assets.length, 3)}, minmax(0,1fr))`,
          background: 'var(--border-subtle)',
        }}>
          {assets.slice(0, 3).map(a => (
            <div key={a.id} style={{ background: 'var(--bg-base)' }}>
              <AssetThumb asset={a} />
            </div>
          ))}
        </div>
      )}

      <div className="p-4 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="px-2 py-0.5 rounded-md text-xs font-semibold"
            style={{ background: 'rgba(var(--accent-soft-rgb),0.14)', color: 'var(--accent-soft)' }}>
            {content.category}
          </span>
          <ExpiryCountdown expiresAt={content.expires_at} compact />
        </div>

        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{content.headline}</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
          {CONTENT_TYPES.find(t => t.id === content.content_type)?.label} · {content.platforms.join(', ')}
          {content.suggested_post_time ? ` · best around ${content.suggested_post_time}` : ''}
        </p>

        <div className="rounded-xl p-3 mt-3 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto"
          style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)' }}>
          {captionPreview}
        </div>

        {content.hashtags.length > 0 && (
          <p className="text-xs mt-2 line-clamp-2" style={{ color: 'var(--accent-soft)' }}>
            {formatHashtags(content.hashtags)}
          </p>
        )}

        {error && <p className="text-xs mt-2" style={{ color: '#ef4444' }}>{error}</p>}

        <div className="flex flex-wrap gap-2 mt-4 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <ActionButton onClick={handleCopyCaption} active={copied === `cap-${content.id}`}
            icon={copied === `cap-${content.id}` ? Check : Copy}
            label={copied === `cap-${content.id}` ? 'Copied' : 'Copy caption'} primary />
          <ActionButton onClick={handleCopyHashtags} active={copied === `tags-${content.id}`}
            icon={copied === `tags-${content.id}` ? Check : Hash}
            label={copied === `tags-${content.id}` ? 'Copied' : 'Hashtags'} />
          <ActionButton onClick={handleCopyLink} active={copied === `link-${content.id}`}
            icon={copied === `link-${content.id}` ? Check : Share2}
            label={copied === `link-${content.id}` ? 'Copied' : 'My link'} />
          {assets.map(a => (
            <ActionButton key={a.id} onClick={() => handleDownload(a)}
              disabled={downloading === a.id} icon={Download}
              label={downloading === a.id ? 'Saving…' : a.kind === 'video' ? 'Video' : a.variant.replace('carousel_', 'Slide ')} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ActionButton({ onClick, icon: Icon, label, primary, active, disabled }: {
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  const accent = primary || active;
  return (
    <button onClick={onClick} disabled={disabled}
      className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition hover:opacity-85 disabled:opacity-50"
      style={{
        background: accent ? 'rgba(var(--accent-soft-rgb),0.16)' : 'var(--bg-base)',
        border: `1px solid ${accent ? 'var(--accent-soft)' : 'var(--border)'}`,
        color: accent ? 'var(--accent-soft)' : 'var(--text-muted)',
      }}>
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}
