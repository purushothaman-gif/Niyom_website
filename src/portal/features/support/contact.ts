/**
 * The support-desk details now live in shared/ so the website and the mobile
 * app cannot drift apart on a phone number. Re-exported here so existing
 * imports keep working; `copyText` is browser-only and stays.
 */
export * from '../../../../shared/support/contact';

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
