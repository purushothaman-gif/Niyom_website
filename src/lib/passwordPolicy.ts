// Single source of truth for the client-login password strength policy.
//
// Applies wherever a client SETS a new password (forced first-login screen,
// voluntary profile change, RM provisioning). It is intentionally NOT used for
// login validation, so existing clients keep logging in with their current
// passwords — they only meet these rules if/when they change or reset.
//
// The Deno edge functions (create-client-login, reset-password-with-otp) keep
// their own inline copies of this rule set because they cannot import from src/.

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // Supabase/bcrypt limit

/** Live checklist rows for the password-strength UIs. */
export function passwordChecks(pw: string): { text: string; met: boolean }[] {
  return [
    { text: `At least ${PASSWORD_MIN} characters`, met: pw.length >= PASSWORD_MIN },
    { text: 'One uppercase letter', met: /[A-Z]/.test(pw) },
    { text: 'One lowercase letter', met: /[a-z]/.test(pw) },
    { text: 'One number', met: /[0-9]/.test(pw) },
    { text: 'One symbol', met: /[^A-Za-z0-9]/.test(pw) },
  ];
}

/** True when every strength rule is satisfied. */
export function isPasswordStrong(pw: string): boolean {
  return pw.length <= PASSWORD_MAX && passwordChecks(pw).every((c) => c.met);
}

/** First failing rule's message, or null when the password is valid. */
export function passwordError(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Password must be ${PASSWORD_MAX} characters or fewer.`;
  if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter.';
  if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include a symbol.';
  return null;
}
