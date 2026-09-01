// The live preview.
//
// Rendered by the SAME module the send path uses (shared/mail/renderEmail ->
// supabase/functions/_shared/mail/render.ts). That is the entire point: a
// preview produced by a second, browser-only renderer would look right and
// prove nothing, and the mandatory test send would be the first time anyone
// saw the real output.
//
// srcDoc rather than dangerouslySetInnerHTML: the email HTML carries its own
// <html>/<body> and background, and an iframe gives it the isolated document
// it expects instead of letting it inherit the CRM's styles.

import { useMemo } from 'react';
import { renderCampaign } from '../../../../shared/mail/renderEmail';
import type { MailAudience, MailBlock } from '../mailTypes';

interface Props {
  subject: string;
  preheader: string;
  blocks: MailBlock[];
  audience: MailAudience;
  ctaPortalEnabled: boolean;
  ctaPortalLabel: string;
  height?: number;
}

/** Stand-in merge values, so the preview shows a real name rather than {{first_name}}. */
const SAMPLE_MERGE = { full_name: 'Asha Ramesh', first_name: 'Asha', code: 'NW0042' };

export default function CampaignPreview(props: Props) {
  const html = useMemo(() => {
    // The app URL is only used for the portal button's href, which the preview
    // shows but nobody clicks; the send path uses PUBLIC_APP_URL server-side.
    const appUrl = window.location.origin.includes('localhost')
      ? 'https://niyomwealth.com'
      : window.location.origin;
    return renderCampaign({
      subject: props.subject,
      preheader: props.preheader,
      blocks: props.blocks,
      audience: props.audience,
      ctaPortalEnabled: props.ctaPortalEnabled,
      ctaPortalLabel: props.ctaPortalLabel,
      appUrl,
      merge: SAMPLE_MERGE,
    }).html;
  }, [props.subject, props.preheader, props.blocks, props.audience, props.ctaPortalEnabled, props.ctaPortalLabel]);

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <div className="px-3 py-2 text-xs flex items-center justify-between"
        style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
        <span className="truncate">
          <strong style={{ color: 'var(--text)' }}>{props.subject || '(no subject)'}</strong>
          {props.preheader && <span className="ml-2">{props.preheader}</span>}
        </span>
        <span className="shrink-0 ml-2">Preview</span>
      </div>
      <iframe
        title="Email preview"
        srcDoc={html}
        sandbox=""
        className="w-full bg-white"
        style={{ height: props.height ?? 560, border: 0 }}
      />
    </div>
  );
}
