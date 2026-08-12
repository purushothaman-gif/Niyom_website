/**
 * NIYOM support-desk contact details — single source of truth.
 * -----------------------------------------------------------------------------
 * Shared by the client portal on niyomwealth.com and the mobile app, so a
 * changed support number reaches both. Intentionally separate from the public
 * site (Landing.tsx), which uses a different number.
 *
 * Constants only. `copyText` stayed on the website: it reaches for
 * navigator.clipboard and falls back to a hidden <textarea>, neither of which
 * exists in an app (which uses expo-clipboard instead).
 */
export const SUPPORT_PHONE = '+91 89392 00110';
export const SUPPORT_PHONE_HREF = 'tel:+918939200110';
export const SUPPORT_EMAIL = 'support@niyomwealth.com';
export const SUPPORT_WHATSAPP_HREF =
  'https://wa.me/918939200110?text=Hello,%20I%20need%20help%20with%20my%20NIYOM%20account';

