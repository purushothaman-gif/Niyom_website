// Write a campaign: audience, brief, body, preview, send.

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Eye, Save, Sparkles, Trash2 } from 'lucide-react';
import { Field, GhostButton, Input, PrimaryButton, Select, StatusBadge, Textarea } from '../../ui/kit';
import { campaignContentHash } from '../../../../shared/mail/renderEmail';
import { useDeleteCampaign, useGenerate, useSaveCampaign } from '../mailClient';
import { STATUS_HELP } from '../mailTypes';
import type { CampaignFilters, MailAudience, MailBlock, MailCampaign } from '../mailTypes';
import BlockEditor from './BlockEditor';
import CampaignPreview from './CampaignPreview';
import SendPanel from './SendPanel';

const TONES = ['Warm and personal', 'Straightforward', 'Formal', 'Celebratory'];
const PURPOSES = [
  'Announcement', 'Market or product update', 'Educational', 'Reminder',
  'Portal or feature launch', 'Seasonal greeting',
];
const LENGTHS = ['Short (3–4 blocks)', 'Medium (5–7 blocks)', 'Detailed (8+ blocks)'];

interface Props {
  campaign: MailCampaign;
  onBack: () => void;
}

export default function CampaignComposer({ campaign, onBack }: Props) {
  const save = useSaveCampaign();
  const generate = useGenerate();
  const del = useDeleteCampaign();

  const [audience, setAudience] = useState<MailAudience>(campaign.audience);
  const [subject, setSubject] = useState(campaign.subject);
  const [preheader, setPreheader] = useState(campaign.preheader);
  const [blocks, setBlocks] = useState<MailBlock[]>(campaign.blocks);
  const [ctaOn, setCtaOn] = useState(campaign.cta_portal_enabled);
  const [ctaLabel, setCtaLabel] = useState(campaign.cta_portal_label);
  const [filters, setFilters] = useState<CampaignFilters>(campaign.filters);
  const [flags, setFlags] = useState(campaign.compliance_flags);

  const [keywords, setKeywords] = useState('');
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [tone, setTone] = useState(TONES[0]);
  const [length, setLength] = useState(LENGTHS[1]);

  const [error, setError] = useState('');
  const [hash, setHash] = useState(campaign.content_hash);
  const [showPreview, setShowPreview] = useState(true);

  const locked = campaign.status !== 'draft';

  // Re-sync when the server row changes underneath (approve, send, resume).
  useEffect(() => {
    setAudience(campaign.audience); setSubject(campaign.subject);
    setPreheader(campaign.preheader); setBlocks(campaign.blocks);
    setCtaOn(campaign.cta_portal_enabled); setCtaLabel(campaign.cta_portal_label);
    setFilters(campaign.filters); setFlags(campaign.compliance_flags);
    setHash(campaign.content_hash);
  }, [campaign.id, campaign.status, campaign.updated_at]);

  // Dirty is decided by comparing the hash of what is on screen against the
  // hash stored on the row — the same digest the approve gate uses. Comparing
  // fields by hand would drift from what the gate actually checks.
  useEffect(() => {
    let cancelled = false;
    void campaignContentHash({
      subject, preheader, blocks, audience,
      ctaPortalEnabled: ctaOn, ctaPortalLabel: ctaLabel,
    }).then((h) => { if (!cancelled) setHash(h); });
    return () => { cancelled = true; };
  }, [subject, preheader, blocks, audience, ctaOn, ctaLabel]);

  const dirty = hash !== campaign.content_hash ||
    JSON.stringify(filters) !== JSON.stringify(campaign.filters);

  const draft = useMemo(() => ({
    audience, subject, preheader, blocks, filters,
    cta_portal_enabled: ctaOn, cta_portal_label: ctaLabel, compliance_flags: flags,
  }), [audience, subject, preheader, blocks, filters, ctaOn, ctaLabel, flags]);

  const doSave = async () => {
    setError('');
    await save.mutateAsync({ id: campaign.id, draft });
  };

  const handleGenerate = async () => {
    setError('');
    if (!keywords.trim()) { setError('Give it a few keywords to work from.'); return; }
    try {
      const d = await generate.mutateAsync({ audience, keywords, purpose, tone, length });
      setSubject(d.subject);
      setPreheader(d.preheader);
      setBlocks(d.blocks);
      setFlags(d.flags);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The draft could not be generated.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <GhostButton type="button" onClick={onBack}><ArrowLeft size={14} /> All campaigns</GhostButton>
          <span className="text-sm font-mono" style={{ color: 'var(--text-muted)' }}>{campaign.campaign_no}</span>
          <StatusBadge status={campaign.status} small />
        </div>
        <div className="flex items-center gap-2">
          <GhostButton type="button" onClick={() => setShowPreview((v) => !v)}>
            <Eye size={14} /> {showPreview ? 'Hide preview' : 'Show preview'}
          </GhostButton>
          {!locked && (
            <PrimaryButton type="button" onClick={doSave} disabled={!dirty || save.isPending}>
              <Save size={14} /> {save.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </PrimaryButton>
          )}
        </div>
      </div>

      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{STATUS_HELP[campaign.status]}</p>

      {error && (
        <div className="rounded-xl px-3 py-2 text-sm"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'rgb(239,68,68)' }}>
          {error}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          {/* Brief ------------------------------------------------------- */}
          {!locked && (
            <section className="rounded-xl p-4"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={15} style={{ color: 'var(--accent)' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Write it for me</h3>
              </div>
              <div className="space-y-3">
                <Field label="Keywords">
                  <Textarea rows={2} value={keywords} onChange={(e) => setKeywords(e.target.value)}
                    placeholder="e.g. new bond offering, 9.2% coupon, AA rated, applications close 15 September" />
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Purpose">
                    <Select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                      {PURPOSES.map((p) => <option key={p}>{p}</option>)}
                    </Select>
                  </Field>
                  <Field label="Tone">
                    <Select value={tone} onChange={(e) => setTone(e.target.value)}>
                      {TONES.map((t) => <option key={t}>{t}</option>)}
                    </Select>
                  </Field>
                  <Field label="Length">
                    <Select value={length} onChange={(e) => setLength(e.target.value)}>
                      {LENGTHS.map((l) => <option key={l}>{l}</option>)}
                    </Select>
                  </Field>
                </div>
                <PrimaryButton type="button" onClick={handleGenerate} disabled={generate.isPending}>
                  <Sparkles size={14} /> {generate.isPending ? 'Writing…' : 'Generate draft'}
                </PrimaryButton>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  This replaces the subject and body below. Everything stays editable afterwards.
                </p>
              </div>
            </section>
          )}

          {/* Body -------------------------------------------------------- */}
          <section className="space-y-3">
            <Field label="Subject" required>
              <Input value={subject} disabled={locked} onChange={(e) => setSubject(e.target.value)}
                placeholder="What lands in the inbox" />
            </Field>
            <Field label="Preview text" hint="The grey line shown next to the subject in most inboxes.">
              <Input value={preheader} disabled={locked} onChange={(e) => setPreheader(e.target.value)}
                placeholder="One line that makes the subject worth opening" />
            </Field>

            <div>
              <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>BODY</div>
              <BlockEditor blocks={blocks} onChange={setBlocks} disabled={locked} />
            </div>

            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Personalise with <code>{'{{first_name}}'}</code>, <code>{'{{full_name}}'}</code> or{' '}
              <code>{'{{code}}'}</code> — they are replaced per recipient.
            </p>
          </section>
        </div>

        {/* Sidebar ------------------------------------------------------- */}
        <div className="space-y-5">
          <section className="rounded-xl p-4 space-y-3"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <Field label="Send to">
              <Select value={audience} disabled={locked}
                onChange={(e) => { setAudience(e.target.value as MailAudience); setFilters({}); }}>
                <option value="client">All clients</option>
                <option value="partner">All partners</option>
              </Select>
            </Field>

            {audience === 'client' && (
              <Field label="Only clients who are" hint="Leave as Everyone to reach the whole book.">
                <Select value={filters.verification_status ?? ''} disabled={locked}
                  onChange={(e) => setFilters({ ...filters, verification_status: e.target.value || undefined })}>
                  <option value="">Everyone</option>
                  <option value="verified">KYC verified</option>
                  <option value="partial">KYC partial</option>
                  <option value="pending">KYC pending</option>
                </Select>
              </Field>
            )}

            <Field label="Portal button"
              hint={audience === 'partner' ? 'Links to the partner portal login.' : 'Links to the client portal login.'}>
              <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text)' }}>
                <input type="checkbox" checked={ctaOn} disabled={locked}
                  onChange={(e) => setCtaOn(e.target.checked)} />
                Add a portal button at the end
              </label>
            </Field>

            {ctaOn && (
              <Field label="Button label">
                <Input value={ctaLabel} disabled={locked} onChange={(e) => setCtaLabel(e.target.value)}
                  placeholder={audience === 'partner' ? 'Open Partner Portal' : 'Open Client Portal'} />
              </Field>
            )}
          </section>

          <SendPanel campaign={campaign} dirty={dirty} onSaveFirst={doSave} />

          {campaign.status === 'draft' && (
            <GhostButton type="button" disabled={del.isPending}
              onClick={() => { if (confirm('Delete this draft?')) void del.mutateAsync(campaign.id).then(onBack); }}>
              <Trash2 size={14} /> Delete draft
            </GhostButton>
          )}
        </div>
      </div>

      {showPreview && (
        <CampaignPreview
          subject={subject} preheader={preheader} blocks={blocks} audience={audience}
          ctaPortalEnabled={ctaOn} ctaPortalLabel={ctaLabel}
        />
      )}
    </div>
  );
}
