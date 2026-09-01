// Campaign blocks -> the HTML and plain text that actually gets delivered.
//
// ONE implementation, used by two runtimes: the send function (Deno) and the
// composer's live preview (browser, via shared/mail/renderEmail.ts). The
// preview is only worth trusting if it is the same code that sends, and the
// partner bond-margin drift is what happens when two copies exist. Nothing in
// here may touch Deno, the DOM, or Node — plain ES2020 string building only.
//
// The email constraints documented at the top of ../email_footer.ts apply in
// full: tables not flexbox, inline styles on every element, PNG only, and a
// single left-aligned column that reads correctly at any width because there
// is no <meta viewport> for a media query to hang off.

import { emailFooterHtml, emailFooterText, NOTICE_AUTOMATED } from '../email_footer.ts';
import type { MailAudience, MailBlock } from './blocks.ts';

const GOLD = '#8B7355';
const INK = '#111111';
const BODY = '#333333';
const RULE = '#eaeaea';

export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A URL is only allowed into the mail if it is unambiguously http(s).
 *
 * The composer is admin-only, but "admin-only" is not a reason to emit
 * javascript: or data: into a hundred inboxes — a pasted URL is not
 * necessarily an authored one. Anything that does not parse, or that parses to
 * another scheme, yields '' and the caller drops the link entirely rather than
 * rendering a dead or dangerous one.
 */
export function safeUrl(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

/**
 * Substitute {{merge_fields}} in raw text BEFORE escaping.
 *
 * Order matters and is the reason this is its own function: substituting after
 * escaping would let a client whose name contains an apostrophe (O'Brien) land
 * raw into markup, and substituting a value that itself contains {{...}} must
 * not then be re-substituted. A single pass over the template, taking values
 * verbatim, does both.
 */
export function applyMerge(text: string, merge: Record<string, string>): string {
  return String(text ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key: string) => {
    const v = merge[key.toLowerCase()];
    return v === undefined ? whole : v;
  });
}

/**
 * The inline markdown subset: **bold**, *italic*, [label](url).
 *
 * Escaping happens FIRST, so by the time the patterns run the string contains
 * no live markup and the only tags that can exist are the three emitted here.
 * A link whose URL fails safeUrl degrades to its label text rather than
 * vanishing, so the reader still sees what was meant.
 */
function inline(text: string): string {
  let s = escapeHtml(text);

  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    // The URL went through escapeHtml above; undo it before parsing, then
    // re-escape only for the attribute.
    const raw = url.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    const safe = safeUrl(raw);
    if (!safe) return label;
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener" style="color:${GOLD};text-decoration:underline;">${label}</a>`;
  });

  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong style="font-weight:700;color:' + INK + ';">$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\n/g, '<br/>');

  return s;
}

/** The same subset, flattened for the plain-text part. */
function inlineText(text: string): string {
  return String(text ?? '')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
      const safe = safeUrl(url);
      return safe ? `${label} (${safe})` : label;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
}

function buttonHtml(label: string, url: string): string {
  // Table-wrapped rather than a styled <a>: Outlook drops padding on inline
  // anchors, which collapses the button into bare underlined text.
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:8px 0 4px;">
        <tr>
          <td align="center" bgcolor="${GOLD}" style="border-radius:6px;">
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener"
               style="display:inline-block;padding:13px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
          </td>
        </tr>
      </table>`;
}

function renderBlock(b: MailBlock, merge: Record<string, string>): string {
  const m = (t: string) => applyMerge(t, merge);

  switch (b.type) {
    case 'heading':
      return `<div style="margin:26px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:700;line-height:1.4;color:${INK};">${inline(m(b.text))}</div>`;

    case 'paragraph':
      return `<div style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:${BODY};">${inline(m(b.text))}</div>`;

    case 'bullets': {
      const items = b.items.filter((i) => i.trim());
      if (!items.length) return '';
      const lis = items
        .map((i) => `<li style="margin:0 0 8px;">${inline(m(i))}</li>`)
        .join('');
      return `<ul style="margin:0 0 16px;padding-left:22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:${BODY};">${lis}</ul>`;
    }

    case 'button': {
      const url = safeUrl(m(b.url));
      const label = m(b.label).trim();
      if (!url || !label) return '';
      return buttonHtml(label, url);
    }

    case 'image': {
      const src = safeUrl(m(b.url));
      if (!src) return '';
      // width is capped rather than set, so a 1200px upload does not force a
      // horizontal scroll on a phone. height:auto keeps the aspect ratio in
      // clients that ignore max-width.
      const img = `<img src="${escapeHtml(src)}" alt="${escapeHtml(m(b.alt))}" width="560"
             style="display:block;width:100%;max-width:560px;height:auto;border:0;outline:none;text-decoration:none;border-radius:6px;" />`;
      const href = b.href ? safeUrl(m(b.href)) : '';
      const wrapped = href
        ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="text-decoration:none;">${img}</a>`
        : img;
      return `<div style="margin:0 0 18px;">${wrapped}</div>`;
    }

    case 'divider':
      return `<div style="margin:24px 0;border-top:1px solid ${RULE};line-height:0;font-size:0;">&nbsp;</div>`;
  }
}

function blockText(b: MailBlock, merge: Record<string, string>): string {
  const m = (t: string) => inlineText(applyMerge(t, merge));
  switch (b.type) {
    case 'heading':   return m(b.text).toUpperCase();
    case 'paragraph': return m(b.text);
    case 'bullets':   return b.items.filter((i) => i.trim()).map((i) => `  - ${m(i)}`).join('\n');
    case 'button': {
      const url = safeUrl(applyMerge(b.url, merge));
      const label = m(b.label).trim();
      return url && label ? `${label}: ${url}` : '';
    }
    case 'image': {
      const alt = m(b.alt).trim();
      return alt ? `[image: ${alt}]` : '';
    }
    case 'divider': return '---';
  }
}

/** The portal button appended automatically, resolved from the audience. */
export function portalCta(audience: MailAudience, appUrl: string, label: string): { label: string; url: string } {
  const base = String(appUrl || 'https://niyomwealth.com').replace(/\/$/, '');
  return audience === 'partner'
    ? { label: label.trim() || 'Open Partner Portal', url: `${base}/partner-login` }
    : { label: label.trim() || 'Open Client Portal', url: `${base}/client-login` };
}

export interface RenderCampaignOptions {
  subject: string;
  preheader: string;
  blocks: MailBlock[];
  audience: MailAudience;
  ctaPortalEnabled: boolean;
  ctaPortalLabel: string;
  /** Site origin for the portal CTA. From PUBLIC_APP_URL on the server. */
  appUrl: string;
  /** Per-recipient merge values: full_name, first_name, code. */
  merge?: Record<string, string>;
  /** Omitted for the composer preview; always present on a real send. */
  unsubscribeUrl?: string;
  year?: number;
}

export function renderCampaign(opts: RenderCampaignOptions): { html: string; text: string } {
  const merge = opts.merge ?? {};
  const year = opts.year ?? new Date().getFullYear();
  const subject = applyMerge(opts.subject, merge);

  const blocks = [...opts.blocks];
  if (opts.ctaPortalEnabled) {
    const cta = portalCta(opts.audience, opts.appUrl, opts.ctaPortalLabel);
    blocks.push({ type: 'button', label: cta.label, url: cta.url });
  }

  const body = blocks.map((b) => renderBlock(b, merge)).filter(Boolean).join('\n');

  // The preheader is the grey line a client shows next to the subject. Hidden
  // in the body, then padded so the client does not pull the footer address
  // into the summary line.
  const pre = applyMerge(opts.preheader, merge).trim();
  const preheader = pre
    ? `<div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(pre)}${'&#8199;&#65279;&#847; '.repeat(30)}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f5;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;border-collapse:collapse;">
  <tr>
    <td align="center" style="padding:28px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
             style="width:100%;max-width:600px;background:#ffffff;border-collapse:collapse;border-radius:8px;">
        <tr>
          <td style="padding:32px 32px 0;">
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;color:${INK};padding-bottom:12px;border-bottom:2px solid #D4AF37;">Niyom Wealth</div>
          </td>
        </tr>
        <tr>
          <td style="padding:26px 32px 8px;">
${body}
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px;">
${emailFooterHtml({ year, notice: NOTICE_AUTOMATED, unsubscribeUrl: opts.unsubscribeUrl })}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const textBody = blocks.map((b) => blockText(b, merge)).filter(Boolean).join('\n\n');
  const text = `${subject}\n\n${textBody}\n\n${emailFooterText({ year, notice: NOTICE_AUTOMATED, unsubscribeUrl: opts.unsubscribeUrl })}`;

  return { html, text };
}

/**
 * The digest behind the self-review gate.
 *
 * Covers exactly the fields that change what a recipient sees. A test send
 * stamps the campaign with this value; approve and send both refuse unless it
 * still matches, so editing the body after testing invalidates the test
 * instead of quietly passing it. Merge values and the unsubscribe token are
 * excluded — they differ per recipient and would make the hash meaningless.
 */
export async function campaignContentHash(input: {
  subject: string; preheader: string; blocks: MailBlock[];
  audience: MailAudience; ctaPortalEnabled: boolean; ctaPortalLabel: string;
}): Promise<string> {
  const canonical = JSON.stringify([
    input.subject, input.preheader, input.audience,
    input.ctaPortalEnabled, input.ctaPortalLabel, input.blocks,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
