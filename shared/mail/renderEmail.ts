/**
 * The campaign email renderer, for the app.
 *
 * A re-export, not a copy. The implementation lives under
 * supabase/functions/_shared so the Edge Function deploy is guaranteed to
 * bundle it — the same arrangement as shared/lib/database.types.ts. The
 * composer's preview and the send path must be the same code or the preview
 * is not evidence of anything.
 */
export {
  applyMerge,
  campaignContentHash,
  escapeHtml,
  portalCta,
  renderCampaign,
  safeUrl,
} from '../../supabase/functions/_shared/mail/render.ts';
export type { RenderCampaignOptions } from '../../supabase/functions/_shared/mail/render.ts';

export { BLOCK_TYPES, blockText, parseBlocks } from '../../supabase/functions/_shared/mail/blocks.ts';
export type { MailAudience, MailBlock } from '../../supabase/functions/_shared/mail/blocks.ts';
