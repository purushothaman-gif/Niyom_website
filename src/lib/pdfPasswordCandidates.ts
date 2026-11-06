/**
 * Likely passwords for a client's own documents, from what we already hold.
 *
 * Indian banks, depositories and registrars lock statements with a formula
 * built from the account holder's details, e.g.:
 *   CDSL/NSDL CML, CAMS/KFintech CAS   PAN (upper case)
 *   ICICI, Axis, Kotak statements       first 4 letters of name (lower) + DDMM
 *   SBI e-statement                     last 5 digits of mobile + DDMMYY
 *   many others                         DOB as DDMMYYYY, or name + birth year
 * Trying these first means most locked uploads open with no question asked.
 *
 * Pure function — no I/O — so it is unit-tested on its own.
 */
export interface PasswordHints {
  fullName?: string | null;
  pan?: string | null;
  /** ISO yyyy-mm-dd (as stored in nw_clients.dob) */
  dob?: string | null;
  phone?: string | null;
  /** Bank account / demat / customer numbers we know for this person. */
  accountNumbers?: (string | null | undefined)[];
}

const MAX = 80;

export function passwordCandidates(h: PasswordHints): string[] {
  const out: string[] = [];
  const add = (...v: (string | null | undefined | false)[]) => {
    for (const s of v) if (s && s.length >= 4 && !out.includes(s)) out.push(s);
  };

  const pan = (h.pan ?? '').trim().toUpperCase();
  const digits = (h.phone ?? '').replace(/\D/g, '').slice(-10);
  const first = ((h.fullName ?? '').trim().split(/\s+/)[0] ?? '').replace(/[^A-Za-z]/g, '');
  const n4 = first.slice(0, 4);
  const names = n4.length === 4
    ? [n4.toLowerCase(), n4.toUpperCase(), n4[0].toUpperCase() + n4.slice(1).toLowerCase()]
    : [];

  let dd = '', mm = '', yyyy = '', yy = '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(h.dob ?? '');
  if (m) { [yyyy, mm, dd] = [m[1], m[2], m[3]]; yy = yyyy.slice(2); }
  const ddmm = dd && dd + mm;
  const ddmmyyyy = dd && dd + mm + yyyy;
  const ddmmyy = dd && dd + mm + yy;

  // 1. PAN — depository CML, CAS
  add(pan, pan.toLowerCase());
  // 2. Name + date — ICICI / Axis / Kotak / HDFC cards
  for (const n of names) add(ddmm && n + ddmm, ddmmyyyy && n + ddmmyyyy, yyyy && n + yyyy, ddmmyy && n + ddmmyy);
  // 3. DOB alone
  add(ddmmyyyy, ddmmyy, dd && yyyy + mm + dd, dd && `${dd}-${mm}-${yyyy}`, dd && `${dd}/${mm}/${yyyy}`);
  // 4. Mobile combinations — SBI and others
  if (digits.length === 10) {
    add(ddmmyy && digits.slice(-5) + ddmmyy, ddmm && digits.slice(-4) + ddmm, ddmm && ddmm + digits.slice(-4));
    add(digits, digits.slice(-5), digits.slice(-6));
  }
  // 5. PAN + DOB, name + PAN fragments
  add(ddmmyyyy && pan + ddmmyyyy, ddmmyyyy && pan.toLowerCase() + ddmmyyyy, pan && n4 && n4.toLowerCase() + pan.slice(-4));
  // 6. Account / customer numbers
  for (const raw of h.accountNumbers ?? []) {
    const acct = (raw ?? '').replace(/\s/g, '');
    if (acct.length < 4) continue;
    add(acct, ddmm && acct.slice(-4) + ddmm, ddmm && ddmm + acct.slice(-4));
  }
  return out.slice(0, MAX);
}
