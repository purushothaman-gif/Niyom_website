// Shared corporate footer for every transactional email.
//
// Single source of truth: previously each template carried its own copy, which
// had already drifted (4px vs 6px margins, differing spacing) and meant a
// branding change had to be made in eight places.
//
// EMAIL CONSTRAINTS worth knowing before editing:
//   - Tables, not flexbox/grid. Outlook (Word rendering engine) ignores modern
//     layout entirely.
//   - Inline styles on every element. Gmail strips <head>, and many clients
//     drop class-based rules.
//   - PNG only. Gmail and Outlook both refuse SVG, so the logo and the social
//     icons are hosted PNGs served from the site.
//   - Images are blocked by default in many clients, so every image carries
//     meaningful alt text and the footer still reads correctly without them.
//
// ON MOBILE CENTRING: the spec asked for centred text on narrow screens. That
// needs a media query, and a media query needs <meta name="viewport"> in the
// email's <head> — which none of these templates have, so clients lay out at a
// default ~980px and the query never fires. Adding a viewport meta would change
// how the ENTIRE email reflows on a phone, not just this footer, so it is not
// something to slip in behind a footer change. The layout here is a single
// column that stacks naturally and reads correctly at any width; it stays
// left-aligned throughout rather than shipping a rule that never runs.

const SITE = "https://www.niyomwealth.com";

// Served from public/email/ — 240px logo (44KB, retina for a 120px box) and
// 48px icons (retina for 24px). The 1000px root logo is 304KB and far too heavy
// to put in every email.
const LOGO_URL = `${SITE}/email/niyom-logo.png`;
const LINKEDIN_ICON = `${SITE}/email/linkedin.png`;
const INSTAGRAM_ICON = `${SITE}/email/instagram.png`;

const LINKEDIN_URL = "https://www.linkedin.com/company/niyom-wealth";
const INSTAGRAM_URL = "https://www.instagram.com/niyom_wealth/";

const COMPANY = "Niyom Wealth Distribution LLP";
const ADDRESS_L1 = "No.126, 1st Floor, Poonamallee High Road,";
const ADDRESS_L2 = "Maduravoyal, Chennai – 600095";
const SUPPORT_EMAIL = "support@niyomwealth.com";

const GOLD = "#8B7355";

/** Default closing notice. OTP / system emails override it — see NOTICE_AUTOMATED. */
export const NOTICE_RECIPIENT = "This message is intended for the named recipient only.";
/** For unattended sends where a human reply goes nowhere. */
export const NOTICE_AUTOMATED = "This is a system-generated message. Please do not reply.";
/** For sends that carry a PDF (receipt, debit note) — the attachment is covered too. */
export const NOTICE_ATTACHMENT = "This message and attachment are intended for the named recipient only.";

export interface EmailFooterOptions {
  /** Copyright year. */
  year: number | string;
  /** Per-email reference (deal confirmation no., debit note no., …). Omitted
   *  when the email has nothing to reference. */
  ref?: string;
  /** Closing notice. Templates differ — automated sends say "do not reply",
   *  RM-sent ones say "named recipient only" — so each keeps its own wording
   *  rather than being flattened to one. */
  notice?: string;
  /** One-click opt-out link. Set ONLY by bulk campaign mail — a client cannot
   *  unsubscribe from their own deal confirmation or OTP, so every
   *  transactional template leaves this undefined and renders as before. */
  unsubscribeUrl?: string;
}

/** Corporate footer, HTML. Include immediately before </div></body>. */
export function emailFooterHtml({ year, ref, notice = NOTICE_RECIPIENT, unsubscribeUrl }: EmailFooterOptions): string {
  const refBit = ref ? ` &nbsp; Ref: ${ref}` : "";
  const unsubBit = unsubscribeUrl
    ? `<br/><a href="${unsubscribeUrl}" target="_blank" rel="noopener" style="color:#999;text-decoration:underline;">Unsubscribe from these updates</a>`
    : "";
  return `
  <table role="presentation" class="nw-f" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="margin-top:32px;border-top:1px solid #eaeaea;border-collapse:collapse;">
    <tr>
      <td style="padding-top:24px;text-align:left;">
        <img src="${LOGO_URL}" width="60" height="60" alt="${COMPANY}"
             style="display:inline-block;border:0;outline:none;text-decoration:none;height:auto;" />
      </td>
    </tr>
    <tr>
      <td style="padding-top:14px;text-align:left;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#666;">
        <div style="font-size:14px;font-weight:700;color:#111;">${COMPANY}</div>
        <div style="padding-top:2px;">${ADDRESS_L1}<br/>${ADDRESS_L2}</div>
        <div style="padding-top:8px;">
          <a href="mailto:${SUPPORT_EMAIL}" style="color:${GOLD};text-decoration:none;">${SUPPORT_EMAIL}</a>
          &nbsp;|&nbsp;
          <a href="${SITE}" target="_blank" rel="noopener" style="color:${GOLD};text-decoration:none;">www.niyomwealth.com</a>
        </div>
      </td>
    </tr>
    <tr>
      <td class="nw-social" style="padding-top:18px;text-align:left;">
        <a href="${LINKEDIN_URL}" target="_blank" rel="noopener" aria-label="Niyom Wealth on LinkedIn"
           style="display:inline-block;text-decoration:none;margin-right:12px;">
          <img src="${LINKEDIN_ICON}" width="22" height="22" alt="LinkedIn"
               style="display:block;border:0;outline:none;text-decoration:none;" />
        </a>
        <a href="${INSTAGRAM_URL}" target="_blank" rel="noopener" aria-label="Niyom Wealth on Instagram"
           style="display:inline-block;text-decoration:none;">
          <img src="${INSTAGRAM_ICON}" width="22" height="22" alt="Instagram"
               style="display:block;border:0;outline:none;text-decoration:none;" />
        </a>
      </td>
    </tr>
    <tr>
      <td style="padding-top:20px;text-align:left;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.7;color:#999;">
        ${notice}<br/>
        &copy; ${year} ${COMPANY}. All Rights Reserved.${refBit}${unsubBit}
      </td>
    </tr>
  </table>`;
}

/** Corporate footer, plain-text counterpart. */
export function emailFooterText({ year, ref, notice = NOTICE_RECIPIENT, unsubscribeUrl }: EmailFooterOptions): string {
  const refBit = ref ? `   Ref: ${ref}` : "";
  const unsubBit = unsubscribeUrl ? `\n\nUnsubscribe from these updates: ${unsubscribeUrl}` : "";
  return `--

${COMPANY}
${ADDRESS_L1} ${ADDRESS_L2}
Email: ${SUPPORT_EMAIL}
Website: ${SITE}

LinkedIn:  ${LINKEDIN_URL}
Instagram: ${INSTAGRAM_URL}

${notice}
© ${year} ${COMPANY}. All Rights Reserved.${refBit}${unsubBit}`;
}
