/**
 * Carry the registrar's true cost of acquisition from a reconciled DETAILED CAS
 * onto the client's registrar-fed holdings (`mf_rta_holdings.invested_cost`), so
 * the MF Statement tab shows real invested / returns / XIRR.
 *
 * ## Why this bridge exists
 *
 * The daily distributor mailback (CAMS WBR9/WBR2/WBR53, KFintech WBCUM/WBTRN)
 * can only ever expose transactions done under OUR ARN and folio-level units +
 * current value. For a folio that moved to us on a change of broker, the units
 * bought under the previous distributor — and their cost — are invisible to the
 * mailback (confirmed against WBR53, which carries valuation, not cost). The
 * investor's own detailed CAS spans every distributor and prints "Total Cost
 * Value" per scheme, so an uploaded CAS is the one place that cost exists.
 *
 * The CAS already lands in the `cas_*` tables (the client's portfolio view). This
 * copies just the cost of acquisition onto the matching `mf_rta_holdings` row so
 * the registrar Statement view — a separate surface reading `mf_rta_*` — stops
 * showing value-but-no-return.
 *
 * ## Safety
 *
 * Runs as the service role (bypasses RLS) but is scoped to THIS client's own
 * folios. It is additive and conservative: it only ever sets a positive cost,
 * never clears one, and never guesses. A scheme is written only when it maps to
 * exactly one registrar holding with confidence — by the RTA product code, by a
 * tight unit fingerprint, or by an unambiguous single-scheme folio on both
 * sides. Anything less certain is skipped, because a wrong cost is worse than a
 * missing one.
 */
import type { SbConfig } from './db.ts';
import { sbPatch, sbSelect } from './db.ts';
import type { CasDetailedScheme } from './detailed.ts';

interface RegHolding {
  id: string;
  folio: string;
  scheme_code: string | null;
  units: number | string | null;
}

export interface BridgeResult {
  matched: number;
  skipped: number;
}

const normFolio = (f: string): string => (f ?? '').replace(/\s+/g, '').toUpperCase();
/** The folio number without its check digit, e.g. "34268297 / 74" -> "34268297". */
const baseFolio = (f: string): string => normFolio(f).split('/')[0];

/** a ≈ b, within max(abs floor, rel·max(a,b)). */
const near = (a: number, b: number, rel: number): boolean =>
  Math.abs(a - b) <= Math.max(0.001, rel * Math.max(Math.abs(a), Math.abs(b)));

export async function bridgeRegistrarCost(
  cfg: SbConfig,
  clientId: string,
  schemes: CasDetailedScheme[],
  /** The CAS "as on" / to date; stamped on each cost we write. */
  costDate: string | null,
): Promise<BridgeResult> {
  const priced = schemes.filter((s) => s.costValue > 0 && s.closingUnits > 0);
  if (!priced.length) return { matched: 0, skipped: 0 };

  // This client's own registrar folios → their holdings. Scoped here, never
  // trusting a folio number alone to belong to this client.
  const folios = await sbSelect<{ id: string }>(
    cfg,
    `mf_rta_folios?select=id&client_id=eq.${encodeURIComponent(clientId)}`,
  );
  if (!folios.length) return { matched: 0, skipped: priced.length };

  const holdings = await sbSelect<RegHolding>(
    cfg,
    `mf_rta_holdings?select=id,folio,scheme_code,units&folio_id=in.(${folios.map((f) => f.id).join(',')})`,
  );
  if (!holdings.length) return { matched: 0, skipped: priced.length };

  // How many priced CAS schemes sit on each folio — lets a 1-holding/1-scheme
  // folio pair unambiguously without a code or unit match.
  const casPerFolio = new Map<string, number>();
  for (const s of priced) {
    const k = normFolio(s.folioNumber);
    casPerFolio.set(k, (casPerFolio.get(k) ?? 0) + 1);
  }

  const date = costDate ?? new Date().toISOString().slice(0, 10);
  let matched = 0;
  let skipped = 0;

  for (const s of priced) {
    const fN = normFolio(s.folioNumber);
    const exact = holdings.filter((h) => normFolio(h.folio) === fN);
    const candidates = exact.length
      ? exact
      : holdings.filter((h) => baseFolio(h.folio) === baseFolio(s.folioNumber));
    if (!candidates.length) {
      skipped++;
      continue;
    }

    const code = (s.rtaCode ?? '').toUpperCase();
    let match: RegHolding | undefined =
      (code ? candidates.find((h) => (h.scheme_code ?? '').toUpperCase() === code) : undefined) ??
      candidates.find((h) => near(Number(h.units ?? 0), s.closingUnits, 0.002));

    // Unambiguous fallback: one registrar holding on this folio, one priced CAS
    // scheme on this folio, and the units in the same ballpark (guards against a
    // stale snapshot pairing the wrong scheme).
    if (
      !match &&
      candidates.length === 1 &&
      (casPerFolio.get(fN) ?? 0) === 1 &&
      near(Number(candidates[0].units ?? 0), s.closingUnits, 0.2)
    ) {
      match = candidates[0];
    }

    if (!match) {
      skipped++;
      continue;
    }

    await sbPatch(cfg, `mf_rta_holdings?id=eq.${match.id}`, {
      invested_cost: Number(s.costValue.toFixed(2)),
      cost_date: date,
    });
    matched++;
  }

  return { matched, skipped };
}
