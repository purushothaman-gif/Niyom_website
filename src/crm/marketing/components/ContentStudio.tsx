// Admin content studio: pick a brief -> generate -> edit -> preview -> save.
//
// The generated draft is held in local state and stays fully editable; nothing
// is written to the database until the admin saves, and nothing is visible to
// employees until it is separately approved.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, RefreshCw, Save, Wand2, ArrowLeft, Image as ImageIcon } from 'lucide-react';
import { NWEmployee } from '../../types';
import {
  CONTENT_CATEGORIES, CONTENT_TYPES, PLATFORMS, VIDEO_DURATIONS,
  VARIANTS_FOR_TYPE, DEFAULT_SLIDE_COUNT, MAX_SLIDE_COUNT,
  SAFE_CTA_SUGGESTIONS, lintContent, formatHashtags, REF_LINK_PLACEHOLDER,
} from '../marketingConstants';
import { AspectVariant, ContentType, MktContent, MktDraft } from '../marketingTypes';
import { useGenerateContent, useSaveDraft, useUploadAsset } from '../marketingClient';
import { PALETTES } from '../templates/brandTokens';
import { suggestTemplate, TEMPLATES } from '../templates/templateSpecs';
import { renderAll, releaseAssets, RenderedAsset } from '../templates/TemplateRenderer';
import {
  Field, GhostButton, LintBadges, PrimaryButton, inputClass, inputStyle,
} from './shared';

interface Props {
  employee: NWEmployee;
  onBack: () => void;
  onSaved: (content: MktContent) => void;
}

export default function ContentStudio({ employee, onBack, onSaved }: Props) {
  // --- brief ---
  const [category, setCategory] = useState<string>(CONTENT_CATEGORIES[0]);
  const [topic, setTopic] = useState('');
  const [contentType, setContentType] = useState<ContentType>('poster');
  const [platforms, setPlatforms] = useState<string[]>(['instagram']);
  const [tone, setTone] = useState('');
  const [extra, setExtra] = useState('');
  const [slideCount, setSlideCount] = useState(DEFAULT_SLIDE_COUNT);
  const [videoDuration, setVideoDuration] = useState<number>(30);

  // --- draft ---
  const [draft, setDraft] = useState<MktDraft | null>(null);
  const [templateId, setTemplateId] = useState('bold_statement');
  const [paletteId, setPaletteId] = useState('midnightGold');
  const [error, setError] = useState<string | null>(null);

  // --- rendering ---
  const [assets, setAssets] = useState<RenderedAsset[]>([]);
  const [rendering, setRendering] = useState(false);
  const assetsRef = useRef<RenderedAsset[]>([]);

  const generate = useGenerateContent();
  const saveDraft = useSaveDraft();
  const uploadAsset = useUploadAsset();

  const typeMeta = CONTENT_TYPES.find(t => t.id === contentType)!;
  const isDeck = typeMeta.slides;
  const isVideo = typeMeta.video;

  // Free previous object URLs whenever the rendered set is replaced or the
  // studio unmounts — these are full-size PNGs, they add up quickly.
  useEffect(() => { assetsRef.current = assets; }, [assets]);
  useEffect(() => () => releaseAssets(assetsRef.current), []);

  const findings = useMemo(
    () => draft ? lintContent({
      title: draft.title, headline: draft.headline, body: draft.body,
      caption: draft.caption, cta: draft.cta, hashtags: draft.hashtags,
    }) : [],
    [draft],
  );

  const missingPlaceholder = !!draft &&
    draft.caption.split(REF_LINK_PLACEHOLDER).length - 1 !== 1;

  const handleGenerate = async () => {
    setError(null);
    try {
      const res = await generate.mutateAsync({
        category, topic: topic.trim() || undefined, content_type: contentType,
        platforms, tone: tone.trim() || undefined,
        extra_instructions: extra.trim() || undefined,
        slide_count: isDeck ? slideCount : undefined,
        video_duration_seconds: isVideo ? videoDuration : undefined,
      });
      setDraft(res.draft);
      const suggested = suggestTemplate(category, contentType);
      setTemplateId(suggested.id);
      setPaletteId(suggested.defaultPalette);
      releaseAssets(assetsRef.current);
      setAssets([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    }
  };

  const handleRender = async () => {
    if (!draft) return;
    setRendering(true);
    setError(null);
    try {
      releaseAssets(assetsRef.current);
      const variants = (VARIANTS_FOR_TYPE[contentType] ?? ['square']) as AspectVariant[];
      const rendered = await renderAll(
        { draft, category, templateId, paletteId },
        variants,
        isDeck ? (draft.slides?.length ?? slideCount) : undefined,
      );
      setAssets(rendered);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Rendering failed');
    } finally {
      setRendering(false);
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    setError(null);
    try {
      const saved = await saveDraft.mutateAsync({
        content_type: contentType,
        platforms,
        category,
        topic: topic.trim() || draft.title,
        title: draft.title,
        headline: draft.headline,
        body: draft.body,
        caption: draft.caption,
        hashtags: draft.hashtags,
        cta: draft.cta,
        seo_keywords: draft.seo_keywords,
        suggested_post_time: draft.suggested_post_time,
        platform_notes: draft.platform_optimisation ?? {},
        template_id: templateId,
        design_spec: {
          paletteId,
          slides: draft.slides ?? null,
          video_script: draft.video_script ?? null,
        },
        generation_meta: { model: 'claude-sonnet-5', lint_findings: findings.length },
        created_by: employee.id,
        status: 'draft',
      });

      // Upload whatever has been rendered so the reviewer sees real artwork.
      for (const a of assets) {
        await uploadAsset.mutateAsync({
          contentId: saved.id, variant: a.variant, blob: a.blob,
          width: a.width, height: a.height, kind: 'image',
        });
      }
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this draft');
    }
  };

  const togglePlatform = (id: string) =>
    setPlatforms(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  const patch = (p: Partial<MktDraft>) => setDraft(d => (d ? { ...d, ...p } : d));

  return (
    <div>
      <button onClick={onBack}
        className="flex items-center gap-1.5 text-sm mb-4 transition-colors hover:opacity-80"
        style={{ color: 'var(--text-muted)' }}>
        <ArrowLeft className="w-4 h-4" /> Back to library
      </button>

      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
          Marketing Tool
        </p>
        <h1 className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>Content Studio</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Educational content only — no products, no advice, no return promises.
        </p>
      </div>

      {error && (
        <div className="rounded-xl p-3 mb-4 text-sm"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ---------------- brief ---------------- */}
        <div className="lg:col-span-2 space-y-4 rounded-2xl p-5"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>The brief</p>

          <Field label="Category">
            <select className={inputClass} style={inputStyle} value={category}
              onChange={e => setCategory(e.target.value)}>
              {CONTENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>

          <Field label="Topic" hint="optional — leave blank and the AI picks one">
            <input className={inputClass} style={inputStyle} value={topic}
              placeholder="e.g. Why an emergency fund comes before investing"
              onChange={e => setTopic(e.target.value)} />
          </Field>

          <Field label="Content type">
            <select className={inputClass} style={inputStyle} value={contentType}
              onChange={e => setContentType(e.target.value as ContentType)}>
              {CONTENT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>

          {isDeck && (
            <Field label="Slides">
              <input type="number" min={2} max={MAX_SLIDE_COUNT} className={inputClass} style={inputStyle}
                value={slideCount}
                onChange={e => setSlideCount(Math.min(MAX_SLIDE_COUNT, Math.max(2, Number(e.target.value) || DEFAULT_SLIDE_COUNT)))} />
            </Field>
          )}

          {isVideo && (
            <Field label="Duration">
              <select className={inputClass} style={inputStyle} value={videoDuration}
                onChange={e => setVideoDuration(Number(e.target.value))}>
                {VIDEO_DURATIONS.map(d => <option key={d} value={d}>{d} seconds</option>)}
              </select>
            </Field>
          )}

          <Field label="Platforms">
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(p => {
                const on = platforms.includes(p.id);
                return (
                  <button key={p.id} type="button" onClick={() => togglePlatform(p.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                    style={{
                      background: on ? 'rgba(var(--accent-soft-rgb),0.16)' : 'var(--bg-base)',
                      border: `1px solid ${on ? 'var(--accent-soft)' : 'var(--border)'}`,
                      color: on ? 'var(--accent-soft)' : 'var(--text-muted)',
                    }}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </Field>

          <Field label="Tone" hint="optional">
            <input className={inputClass} style={inputStyle} value={tone}
              placeholder="e.g. warm and encouraging, for first-time earners"
              onChange={e => setTone(e.target.value)} />
          </Field>

          <Field label="Extra instructions" hint="optional">
            <textarea className={inputClass} style={{ ...inputStyle, minHeight: 70 }} value={extra}
              placeholder="Anything specific to include or avoid"
              onChange={e => setExtra(e.target.value)} />
          </Field>

          <PrimaryButton onClick={handleGenerate} disabled={generate.isPending || !platforms.length}
            className="w-full flex items-center justify-center gap-2">
            {generate.isPending
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Generating…</>
              : <><Sparkles className="w-4 h-4" /> {draft ? 'Regenerate' : 'Generate content'}</>}
          </PrimaryButton>
          {!platforms.length && (
            <p className="text-xs" style={{ color: '#ef4444' }}>Pick at least one platform.</p>
          )}
        </div>

        {/* ---------------- draft ---------------- */}
        <div className="lg:col-span-3 space-y-4">
          {!draft ? (
            <div className="rounded-2xl p-12 flex flex-col items-center justify-center text-center h-full"
              style={{ background: 'var(--bg-surface)', border: '1px dashed var(--border)' }}>
              <Wand2 className="w-8 h-8 mb-3" style={{ color: 'var(--accent-soft)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Nothing generated yet</p>
              <p className="text-xs mt-1 max-w-xs" style={{ color: 'var(--text-muted)' }}>
                Set the brief and generate. Everything stays editable before you save.
              </p>
            </div>
          ) : (
            <>
              <LintBadges findings={findings} />

              {missingPlaceholder && (
                <div className="rounded-xl p-3 text-xs"
                  style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
                  The caption must contain <code>{REF_LINK_PLACEHOLDER}</code> exactly once — that token becomes each
                  employee&rsquo;s personal referral link when they copy it.
                </div>
              )}

              <div className="rounded-2xl p-5 space-y-4"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Copy</p>

                <Field label="Title" hint="internal reference">
                  <input className={inputClass} style={inputStyle} value={draft.title}
                    onChange={e => patch({ title: e.target.value })} />
                </Field>

                <Field label="Headline" hint="the hero line on the artwork">
                  <textarea className={inputClass} style={{ ...inputStyle, minHeight: 60 }} value={draft.headline}
                    onChange={e => patch({ headline: e.target.value })} />
                </Field>

                <Field label="Body" hint="supporting copy on the artwork">
                  <textarea className={inputClass} style={{ ...inputStyle, minHeight: 80 }} value={draft.body}
                    onChange={e => patch({ body: e.target.value })} />
                </Field>

                <Field label="Caption" hint="the social post text">
                  <textarea className={inputClass} style={{ ...inputStyle, minHeight: 130 }} value={draft.caption}
                    onChange={e => patch({ caption: e.target.value })} />
                </Field>

                <Field label="Call to action">
                  <input className={inputClass} style={inputStyle} value={draft.cta}
                    onChange={e => patch({ cta: e.target.value })} />
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {SAFE_CTA_SUGGESTIONS.slice(0, 4).map(s => (
                      <button key={s} type="button" onClick={() => patch({ cta: s })}
                        className="px-2 py-1 rounded-md text-xs transition hover:opacity-80"
                        style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label="Hashtags" hint="space or comma separated">
                  <textarea className={inputClass} style={{ ...inputStyle, minHeight: 60 }}
                    value={formatHashtags(draft.hashtags)}
                    onChange={e => patch({
                      hashtags: e.target.value.split(/[\s,]+/).map(h => h.replace(/^#/, '')).filter(Boolean),
                    })} />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Suggested time">
                    <input className={inputClass} style={inputStyle} value={draft.suggested_post_time}
                      onChange={e => patch({ suggested_post_time: e.target.value })} />
                  </Field>
                  <Field label="SEO keywords">
                    <input className={inputClass} style={inputStyle} value={draft.seo_keywords.join(', ')}
                      onChange={e => patch({ seo_keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
                  </Field>
                </div>
              </div>

              {/* ---------------- artwork ---------------- */}
              <div className="rounded-2xl p-5 space-y-4"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Artwork</p>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Template">
                    <select className={inputClass} style={inputStyle} value={templateId}
                      onChange={e => setTemplateId(e.target.value)}>
                      {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Colourway">
                    <select className={inputClass} style={inputStyle} value={paletteId}
                      onChange={e => setPaletteId(e.target.value)}>
                      {Object.keys(PALETTES).map(p => (
                        <option key={p} value={p}>
                          {p.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <GhostButton onClick={handleRender} disabled={rendering}
                  className="w-full flex items-center justify-center gap-2">
                  {rendering
                    ? <><RefreshCw className="w-4 h-4 animate-spin" /> Rendering…</>
                    : <><ImageIcon className="w-4 h-4" /> {assets.length ? 'Re-render artwork' : 'Render artwork'}</>}
                </GhostButton>

                {assets.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {assets.map(a => (
                      <div key={a.variant} className="rounded-xl overflow-hidden"
                        style={{ border: '1px solid var(--border)' }}>
                        <img src={a.previewUrl} alt={a.variant} className="w-full h-auto block" />
                        <p className="text-xs px-2 py-1.5" style={{ color: 'var(--text-faint)' }}>
                          {a.variant} · {a.width}×{a.height}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <PrimaryButton onClick={handleSave}
                  disabled={saveDraft.isPending || uploadAsset.isPending}
                  className="flex items-center gap-2">
                  <Save className="w-4 h-4" />
                  {saveDraft.isPending || uploadAsset.isPending ? 'Saving…' : 'Save as draft'}
                </PrimaryButton>
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  Saved drafts stay hidden from employees until you approve them.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
