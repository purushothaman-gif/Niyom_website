/*
 * Clean an IFSC as people actually enter it.
 *
 * Two mistakes account for almost every rejected code: stray spaces from a
 * copy-paste (a trailing space alone fails the format check), and the letter O
 * typed for the zero in position five. That fifth character is a zero in every
 * IFSC by RBI's definition -- it is reserved -- so correcting O to 0 there is
 * not a guess, it is the only value the position can hold. Nothing else is
 * altered: a genuinely wrong code is still refused, with a reason.
 */
export function normaliseIfsc(raw: string): string {
  const s = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 11 && s[4] === 'O' ? s.slice(0, 4) + '0' + s.slice(5) : s;
}
