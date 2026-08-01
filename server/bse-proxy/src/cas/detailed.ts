/**
 * Detailed CAS parser — the transaction ledger.
 *
 * A Summary statement carries holdings only. A Detailed one carries every
 * transaction since inception plus the advisor code per scheme, which is what
 * capital gains, a real XIRR, and "is this holding ours or held away" all need.
 *
 * ## Scheme block
 *
 *   AXIS Mutual Fund                                                  <- AMC
 *   PAN: BYTPP1625E KYC: OK PAN: OK
 *   128EFDGG-Axis Large Cap Fund - Direct Growth (Demat) - ISIN: INF846K01DP8(Advisor: INZ000031633) Registrar :
 *   KFINTECH
 *   Folio No: 91047754804 / 0
 *   Opening Unit Balance: 0.000
 *   ... transactions ...
 *   NAV on 31-Jul-2026: INR 70.65 Market Value on 31-Jul-2026: INR 0.00
 *   Closing Unit Balance: 0.000 Total Cost Value: 0.00
 *
 * ## The fused-column problem, and how it is resolved
 *
 *   19-Oct-2018 5,000.00 26.66187.547Purchase 187.547
 *                        ^^^^^^^^^^^^ price and units, no separator
 *
 * "26.66187.547" splits as 26.66|187.547 or 26.6618|7.547 — both look valid,
 * and guessing wrong silently corrupts every unit figure in the statement.
 *
 * It does not have to be guessed. The line also carries the running unit
 * balance, so the correct split is the one satisfying
 * `balance == previous balance + units`. Each candidate is tested against that
 * identity and the arithmetic decides. When no candidate satisfies it the
 * transaction is recorded as unresolved rather than approximated.
 */

export interface CasTransaction {
  date: string; // ISO
  type: string; // PURCHASE | REDEMPTION | SWITCH_IN | SWITCH_OUT | DIVIDEND | ...
  description: string;
  amount: number; // signed: negative for money leaving the fund
  units: number; // signed
  nav: number;
  balanceUnits: number;
}

export interface CasDetailedScheme {
  amc: string;
  folioNumber: string;
  rtaCode: string;
  schemeName: string;
  isin: string;
  advisorCode: string;
  registrar: string;
  isDemat: boolean;
  openingUnits: number;
  closingUnits: number;
  costValue: number;
  nav: number;
  navDate: string;
  marketValue: number;
  transactions: CasTransaction[];
  /** Set when the ledger does not add up to the closing balance the CAS states. */
  balanceMismatch: number | null;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const iso = (d: string): string => {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(d.trim());
  const mm = m ? MONTHS[m[2].toLowerCase()] : null;
  return m && mm ? `${m[3]}-${mm}-${m[1]}` : '';
};

/** "(501.22)" is negative; "5,000.00" positive. */
const money = (s: string): number => {
  const neg = /^\(.*\)$/.test(s.trim());
  const n = Number(s.replace(/[(),]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
};

const near = (a: number, b: number, tol = 0.001) => Math.abs(a - b) <= tol;

/** Page furniture that appears mid-block and must never reach the parser. */
const NOISE =
  /^(CAMSCASWS|Consolidated Account Statement|Page \d+ of \d+|Date Amount Price|\(INR\)|\d{2}-[A-Za-z]{3}-\d{4} To \d{2}-[A-Za-z]{3}-\d{4}$)/i;

/**
 * A scheme header wraps when the name is long, splitting mid-attribute:
 *
 *   117TSD1G-Mirae Asset ELSS Tax Saver Fund (formerly ...) - ISIN: INF769K01DM9(Advisor:
 *   INZ000031633)
 *   Registrar :
 *
 * Rejoining before matching is what keeps a long-named scheme from being
 * dropped entirely — which is exactly the silent under-reporting this parser
 * exists to prevent. Found by the totals not adding up.
 */
function joinWrappedHeaders(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    /*
     * A long name can also wrap just BEFORE the "(Demat)" marker, leaving the
     * ISIN on a line that begins with it:
     *
     *   HGFGT-HDFC Balanced Advantage Fund - Direct Plan - Growth Option (form...
     *   (Non-Demat) - ISIN: INF179K01WA6(Advisor: INZ000208032)
     *
     * That second line satisfies SCHEME_HEAD on its own — reading "(Non" as the
     * RTA code and "Demat)" as the entire scheme name — so the check below
     * never fires, and the scheme is kept under a meaningless name rather than
     * being dropped. It has to be rejoined before anything else looks at it.
     */
    if (/^\(\s*(?:Non[\s-]*)?Demat\s*\)\s*-\s*ISIN:/i.test(line) && out.length) {
      line = `${out.pop()} ${line}`;
    }

    if (/-\s*ISIN:\s*[A-Z0-9]{12}/.test(line) && !SCHEME_HEAD.test(line)) {
      // Absorb continuations until the header parses, stopping at the folio
      // line so a genuinely malformed header cannot swallow the block.
      let j = i + 1;
      while (j < lines.length && j - i <= 4 && !SCHEME_HEAD.test(line)) {
        if (/^Folio No:/i.test(lines[j])) break;
        line = `${line}${lines[j]}`;
        j++;
      }
      if (SCHEME_HEAD.test(line)) i = j - 1;
      else line = lines[i];
    }
    out.push(line);
  }
  return out;
}

const SCHEME_HEAD =
  /^(\S+?)-(.+?)\s*-\s*ISIN:\s*([A-Z0-9]{12})(?:\(Advisor:\s*([^)]*)\))?\s*(?:Registrar\s*:\s*(\S+)?)?\s*$/;

const TXN = /^(\d{2}-[A-Za-z]{3}-\d{4})\s+(\(?[\d,]+\.\d{2}\)?)\s+(.*)$/;

/**
 * Entries printed between asterisks rather than as a normal ledger row:
 *
 *   18-Jan-2019 0.01*** STT Paid ***
 *   24-Jul-2018 903.90***IDCW @ Rs.0.19478990 per unit***
 *   01-Jul-2024***Cancelled***
 *
 * TXN cannot match these — it requires whitespace after the amount and these
 * run the asterisks straight onto it — so without this they were skipped
 * wholesale, taking every dividend payout and every stamp duty and STT charge
 * with them. They carry no units, which is why the unit checks never noticed.
 *
 * The amount is optional, and that is the distinction that matters: a row with
 * one is money moving and belongs in the ledger, while a row without one
 * ("Cancelled", "Registration of Nominee") is an account event and does not.
 */
const MARKER =
  /^(\d{2}-[A-Za-z]{3}-\d{4})\s*(\(?[\d,]+\.\d{2}\)?)?\s*\*{2,}\s*(.+?)\s*\*{2,}$/;

/**
 * Split "26.66187.547" into price and units using the balance identity.
 *
 * Units always carry three decimals, so candidates are the positions where a
 * three-decimal number could start. The one that makes the running balance work
 * is the right one; if none does, the caller records the transaction as
 * unresolved rather than picking the most plausible.
 */
function splitPriceUnits(
  fused: string,
  prevBalance: number,
  balance: number,
): { nav: number; units: number } | null {
  const negative = fused.includes('(');
  const clean = fused.replace(/[(),]/g, '');

  for (let cut = 1; cut < clean.length - 3; cut++) {
    const left = clean.slice(0, cut);
    const right = clean.slice(cut);
    // Both halves must be well-formed numbers, and units always have 3 dp.
    if (!/^\d+\.\d{1,4}$/.test(left) || !/^\d+\.\d{3}$/.test(right)) continue;
    const units = negative ? -Number(right) : Number(right);
    if (near(prevBalance + units, balance)) return { nav: Number(left), units };
  }
  return null;
}

/**
 * A transaction's prose -> a stable type.
 *
 * ## Why this matches anywhere in the string, not just the start
 *
 * It used to test `startsWith('purchase')` and `startsWith('sip')`, which
 * matched "SIP Purchase-BSE ..." and missed almost everything else a registrar
 * actually writes:
 *
 *   Systematic Investment (1)
 *   Systematic Purchase (Continuous Offer) - Instalment 2/904 - via Internet
 *   Initial Purchase
 *   NFO Purchase
 *
 * On one real statement that was 121 transactions worth 2,04,489 falling
 * through to OTHER — more than the whole portfolio. Nothing looked broken: the
 * units parse the same whatever the type is called, so every balance check
 * still passed and the holdings were correct to the paisa. Only the money-
 * weighted return was wrong, because OTHER is not a cash flow, and a client saw
 * 70% where the truth was a fraction of that.
 *
 * ## Order matters, and the action comes before the charge
 *
 * A redemption's prose often mentions the charge deducted from it —
 * "Redemption - NEFT PAYOUT-NSE - ... , less STT" — so testing for STT first
 * turns real redemptions into fee rows. The genuine charge lines carry no
 * action word at all ("STT Paid", "Stamp Duty"), so they fall through safely to
 * the end.
 *
 * Within the actions, "Systematic Withdrawal" is a redemption despite reading
 * like the systematic purchases above, so withdrawal is tested before the
 * purchase words; a switch is neither and is caught before both.
 */
export function classify(rest: string): { type: string; description: string } {
  const description = rest.trim();
  const s = description.toLowerCase();

  // A switch moves money between schemes and is neither a purchase nor a sale.
  if (s.includes('switch')) {
    return { type: s.includes('out') ? 'SWITCH_OUT' : 'SWITCH_IN', description };
  }

  if (s.includes('idcw') || s.includes('dividend')) return { type: 'DIVIDEND', description };

  // Before the purchase words: a systematic WITHDRAWAL reads like a systematic
  // investment but is the opposite.
  if (/redemption|redeem|withdrawal|repurchase/.test(s)) {
    return { type: 'REDEMPTION', description };
  }

  if (/purchase|investment|\bsip\b|nfo|allot/.test(s)) {
    return { type: 'PURCHASE', description };
  }

  // Charges last: only a row with no action in it at all is actually a charge.
  if (s.includes('stamp duty')) return { type: 'STAMP_DUTY', description };
  // Word-bounded: "stt" as a substring appears inside ordinary words.
  if (/\bstt\b/.test(s)) return { type: 'STT', description };

  return { type: 'OTHER', description };
}

export function parseDetailedSchemes(text: string): CasDetailedScheme[] {
  const lines = joinWrappedHeaders(
    text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean),
  );
  const out: CasDetailedScheme[] = [];

  let amc = '';
  let cur: CasDetailedScheme | null = null;
  let running = 0;
  /** A wrapped transaction whose balance appears on a later line. */
  let awaitingBalance: { txn: CasTransaction; fused: string } | null = null;

  const close = () => {
    if (!cur) return;
    const drift = cur.transactions.length
      ? cur.transactions[cur.transactions.length - 1].balanceUnits - cur.closingUnits
      : cur.openingUnits - cur.closingUnits;
    cur.balanceMismatch = near(drift, 0, 0.001) ? null : drift;
    out.push(cur);
    cur = null;
  };

  for (const line of lines) {
    if (NOISE.test(line)) continue;

    const head = SCHEME_HEAD.exec(line);
    if (head) {
      close();
      const name = head[2].trim();
      cur = {
        amc,
        folioNumber: '',
        rtaCode: head[1],
        schemeName: name,
        isin: head[3],
        advisorCode: (head[4] ?? '').trim(),
        registrar: head[5] ?? '',
        isDemat: /\(\s*Demat\s*\)/i.test(name) && !/Non[\s-]*Demat/i.test(name),
        openingUnits: 0,
        closingUnits: 0,
        costValue: 0,
        nav: 0,
        navDate: '',
        marketValue: 0,
        transactions: [],
        balanceMismatch: null,
      };
      running = 0;
      awaitingBalance = null;
      continue;
    }

    if (!cur) {
      // Between blocks, a bare line naming a fund house is the AMC heading.
      if (/mutual fund|MF$|asset management/i.test(line) && line.length < 60) amc = line;
      continue;
    }

    // The registrar sometimes sits on its own line — either bare, after a
    // "Registrar :" left stranded on the header, or carrying the label itself.
    const reg = cur.registrar
      ? null
      : /^(?:Registrar\s*:\s*)?(CAMS|KFINTECH)$/i.exec(line);
    if (reg) {
      cur.registrar = reg[1].toUpperCase();
      continue;
    }

    const folio = /^Folio No:\s*(.+?)\s*$/i.exec(line);
    if (folio) {
      cur.folioNumber = folio[1].replace(/\s*\/\s*/, '/');
      continue;
    }

    const open = /^Opening Unit Balance:\s*([\d,.]+)/i.exec(line);
    if (open) {
      cur.openingUnits = Number(open[1].replace(/,/g, '')) || 0;
      running = cur.openingUnits;
      continue;
    }

    const valuation = /NAV on (\d{2}-[A-Za-z]{3}-\d{4}):\s*INR\s*([\d,.]+)\s*Market Value on \d{2}-[A-Za-z]{3}-\d{4}:\s*INR\s*([\d,.]+)/i.exec(line);
    if (valuation) {
      cur.navDate = iso(valuation[1]);
      cur.nav = Number(valuation[2].replace(/,/g, '')) || 0;
      cur.marketValue = Number(valuation[3].replace(/,/g, '')) || 0;
      // The closing line can be fused onto this one on the final page.
    }

    const closing = /Closing Unit Balance:\s*([\d,.]+)\s*Total Cost Value:\s*([\d,.]+)/i.exec(line);
    if (closing) {
      cur.closingUnits = Number(closing[1].replace(/,/g, '')) || 0;
      cur.costValue = Number(closing[2].replace(/,/g, '')) || 0;
      close();
      continue;
    }

    // A wrapped transaction's balance arrives alone on the next line.
    if (awaitingBalance && /^[\d,]+\.\d{3}$/.test(line)) {
      const balance = Number(line.replace(/,/g, ''));
      const split = splitPriceUnits(awaitingBalance.fused, running, balance);
      if (split) {
        awaitingBalance.txn.nav = split.nav;
        awaitingBalance.txn.units = split.units;
      }
      awaitingBalance.txn.balanceUnits = balance;
      running = balance;
      awaitingBalance = null;
      continue;
    }

    const marker = MARKER.exec(line);
    if (marker) {
      if (marker[2]) {
        const { type, description } = classify(marker[3]);
        cur.transactions.push({
          date: iso(marker[1]), type, description,
          amount: money(marker[2]), units: 0, nav: 0, balanceUnits: running,
        });
      }
      continue;
    }

    const txn = TXN.exec(line);
    if (txn) {
      const amount = money(txn[2]);
      const rest = txn[3];

      // Fee lines carry no units: "0.01*** STT Paid ***".
      const fee = /^\*+\s*(.+?)\s*\*+$/.exec(rest);
      if (fee) {
        const { type, description } = classify(fee[1]);
        cur.transactions.push({
          date: iso(txn[1]), type, description, amount,
          units: 0, nav: 0, balanceUnits: running,
        });
        continue;
      }

      // "26.66187.547Purchase 187.547" — fused numbers, then the type, then
      // optionally the balance on the same line.
      //
      // A redemption made "less STT" carries a footnote asterisk between the
      // two — "(155.315)*Redemption-BSE ... , less STT" — and without allowing
      // for it the line matched nothing and was skipped. That is expensive
      // twice over: the redemption vanishes, AND the running balance stays
      // where it was, so the NEXT transaction's price/units split no longer
      // satisfies the balance identity and its units are lost too.
      const body = /^([\d,.()]+?)(\*?[A-Za-z].*)$/.exec(rest);
      if (!body) continue;
      const fused = body[1];
      const tail = body[2].replace(/^\*+/, '');
      const trailing = /\s([\d,]+\.\d{3})\s*$/.exec(tail);

      const { type, description } = classify(trailing ? tail.slice(0, trailing.index) : tail);
      const record: CasTransaction = {
        date: iso(txn[1]), type, description,
        amount, units: 0, nav: 0, balanceUnits: running,
      };

      if (trailing) {
        const balance = Number(trailing[1].replace(/,/g, ''));
        const split = splitPriceUnits(fused, running, balance);
        if (split) {
          record.nav = split.nav;
          record.units = split.units;
        }
        record.balanceUnits = balance;
        running = balance;
        cur.transactions.push(record);
      } else {
        // Balance wrapped to a later line — hold the record open.
        cur.transactions.push(record);
        awaitingBalance = { txn: record, fused };
      }
    }
  }

  close();
  return out;
}
