/**
 * NIYOM support-desk contact details — single source of truth for the client
 * portal only. Intentionally separate from the public site (Landing.tsx), which
 * uses a different support number.
 */
export const SUPPORT_PHONE = '+91 89392 00110';
export const SUPPORT_PHONE_HREF = 'tel:+918939200110';
export const SUPPORT_EMAIL = 'support@niyomwealth.com';
export const SUPPORT_WHATSAPP_HREF =
  'https://wa.me/918939200110?text=Hello,%20I%20need%20help%20with%20my%20NIYOM%20account';

/**
 * Copy text to the clipboard, with a legacy fallback for browsers/contexts where
 * the async Clipboard API is unavailable (e.g. non-HTTPS or older webviews).
 * Returns true on success so callers can show "Copied!" feedback.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}
