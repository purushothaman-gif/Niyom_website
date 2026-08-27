import { supabase } from '../lib/supabase';
import { NWTransaction, NWClient, ProductType } from './types';
import { fmt, fmtDate } from './utils';

// ---------------------------------------------------------------------------
// MIS revenue engine.
//
// Lifted out of MIS.tsx unchanged so the on-screen report and the shareable
// team-revenue image are computed by ONE implementation. A second copy of these
// rules would drift the moment either side was touched, and the two would then
// disagree about the same month's revenue in front of the whole team.
//
// The rules themselves are unchanged: landing-cost revenue is recognised in the
// month the deal was PAID in full, insurance and MF trail in the month of the
// transaction.
// ---------------------------------------------------------------------------

export interface MISRow {
  client_id: string;
  /** Owning employee of the client the revenue arose from — the only
   *  attribution available, and the same one the MIS employee filter uses. */
  employee_id: string | null;
  client_name: string;
  client_code: string;
  /** Transaction date this revenue arose from. Always inside the selected
   *  period — the query filters on it — and drives the newest-first ordering. */
  date: string;
  product_type: ProductType;
  product_name: string;
  revenue_type: 'landing_cost' | 'insurance' | 'trail';
  revenue: number;
  notes: string;
}

export function getLastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function isTrailAnniversaryInMonth(trailStartDate: string, year: number, month: number): boolean {
  try {
    const start = new Date(trailStartDate);
    if (isNaN(start.getTime())) return false;
    // Anniversary falls in this month if start month === selected month (any year after start)
    const startYear = start.getFullYear();
    const startMonth = start.getMonth();
    if (startMonth !== month) return false;
    // Must have been at least 1 year since investment
    const anniversaryYear = year;
    if (anniversaryYear <= startYear) return false;
    return true;
  } catch { return false; }
}

/** Period bounds for a month, as the ISO strings the queries filter on. */
export function monthRange(year: number, month: number): { startDate: string; endDate: string } {
  const mm = String(month + 1).padStart(2, '0');
  const endDay = String(getLastDayOfMonth(year, month)).padStart(2, '0');
  return { startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-${endDay}` };
}

/**
 * Revenue rows for the given clients over one month.
 * Callers decide WHICH clients (the report scopes them by role/filter, the team
 * card takes every client); the recognition rules are identical either way.
 */
export async function computeMisRows(
  clientList: NWClient[],
  startDate: string,
  endDate: string,
  selectedYear: number,
  selectedMonth: number,
): Promise<MISRow[]> {
  const clientIds = clientList.map(c => c.id);
  if (clientIds.length === 0) return [];

    // -------------------------------------------------------------------
    // Landing-cost revenue is recognised in the month the PAYMENT arrived,
    // not the month the deal was struck: a deal confirmed 27 Jul and cleared
    // 5 Aug is AUGUST revenue. So the period filter cannot be a plain
    // txn_date range any more.
    //
    // EVERY deal for these clients is loaded, not just the period's, because
    // a deal struck in any earlier month can be paid inside the selected one.
    // -------------------------------------------------------------------
    const { data: dealAll } = await supabase
      .from('nw_deal_confirmations')
      .select('id, client_id, product_type, transaction_type, security_name, quantity, base_rate, landing_cost, deal_date')
      .in('client_id', clientIds);
    const deals = (dealAll ?? []) as any[];
    const dealIds = deals.map(d => d.id);

    // The date a deal was CLEARED: the last active payment against it, and
    // only once it is settled in full. A part-paid deal earns nothing yet —
    // its revenue waits for the payment that closes it.
    const clearedOn = new Map<string, string>();
    if (dealIds.length) {
      const [{ data: summaries }, { data: payments }] = await Promise.all([
        supabase.from('nw_deal_payment_summary')
          .select('deal_id, payment_status').in('deal_id', dealIds),
        supabase.from('nw_deal_payments')
          .select('deal_confirmation_id, payment_date')
          .eq('status', 'active').in('deal_confirmation_id', dealIds),
      ]);
      const settled = new Set(
        ((summaries ?? []) as any[])
          .filter(s => s.payment_status === 'fully_paid' || s.payment_status === 'over_paid')
          .map(s => s.deal_id));
      for (const p of (payments ?? []) as any[]) {
        if (!settled.has(p.deal_confirmation_id) || !p.payment_date) continue;
        const prev = clearedOn.get(p.deal_confirmation_id);
        // ISO dates compare correctly as strings.
        if (!prev || p.payment_date > prev) clearedOn.set(p.deal_confirmation_id, p.payment_date);
      }
    }
    const inPeriod = (d: string | null | undefined) => !!d && d >= startDate && d <= endDate;

    // Two fetches, merged: transactions DATED inside the period (insurance, MF
    // trail, and landing-cost rows with no deal to date them by), and those
    // whose deal was CLEARED inside it even though they were booked earlier.
    const clearedThisPeriod = [...clearedOn.entries()].filter(([, d]) => inPeriod(d)).map(([id]) => id);
    const [{ data: byDate }, { data: byPayment }] = await Promise.all([
      supabase.from('nw_transactions').select('*')
        .in('client_id', clientIds).gte('txn_date', startDate).lte('txn_date', endDate),
      clearedThisPeriod.length
        ? supabase.from('nw_transactions').select('*').in('deal_confirmation_id', clearedThisPeriod)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const uniqueTxns = new Map<string, NWTransaction>();
    for (const t of [...((byDate ?? []) as NWTransaction[]), ...((byPayment ?? []) as NWTransaction[])]) {
      uniqueTxns.set((t as any).id, t);
    }
    const txns = [...uniqueTxns.values()];

    const computed: MISRow[] = [];

    for (const t of txns) {
      const client = clientList.find(c => c.id === t.client_id);
      if (!client) continue;

      const baseRow = {
        client_id: t.client_id,
        employee_id: client.employee_id ?? null,
        client_name: client.full_name,
        client_code: client.client_code,
        date: t.txn_date,
        product_type: t.product_type,
        product_name: t.product_name,
      };

      // Unlisted shares / secondary bonds / primary bonds → profit vs landing cost.
      // BUY:  (Client Price − Landing Cost) × qty
      // SELL: (Landing Cost − Client Price) × qty  (direction reversed)
      //
      // Only GENUINE business counts: one that came through the deal-
      // confirmation flow (has a deal_confirmation_id) or was transferred
      // (transfer_stage = 'transferred'). Existing client positions recorded for
      // the portfolio — and any manual entry that never went through the deal →
      // transfer flow — carry neither and must not inflate revenue. (Insurance /
      // MF below are direct-entry revenue with no transfer step, so they are not
      // gated this way.)
      if (['unlisted_share', 'secondary_bond', 'primary_bond'].includes(t.product_type)
          && ((t as any).transfer_stage === 'transferred' || (t as any).deal_confirmation_id)) {
        const dealId = (t as any).deal_confirmation_id as string | null;
        const cleared = dealId ? clearedOn.get(dealId) : undefined;

        // Which month does this earn in?
        //   linked + settled -> the date its final payment cleared;
        //   linked + unpaid  -> nothing yet. Shown at ₹0 in its own month so
        //                       business we are still owed stays visible
        //                       instead of silently vanishing from the report;
        //   no deal at all   -> no payment to date it by, so it keeps its own
        //                       transaction date rather than being dropped.
        if (dealId && !cleared) {
          if (inPeriod(t.txn_date)) {
            computed.push({
              ...baseRow,
              revenue_type: 'landing_cost',
              revenue: 0,
              notes: '⏳ Awaiting payment — revenue is counted in the month this deal is paid in full',
            });
          }
          continue;
        }
        const revenueDate = (dealId ? cleared : t.txn_date) as string;
        if (!inPeriod(revenueDate)) continue;
        // Landing-cost rows are dated by payment; the transaction date only
        // stands in when there is no deal behind them.
        const rowDate = { ...baseRow, date: revenueDate };

        const landingRaw = (t as any).landing_cost;
        const qty = t.quantity || 0;

        // The rate the client transacted at: DSA-sourced clients settle at
        // dsa_price (net to Niyom after the DSA's cut), everyone else at
        // per_unit_price.
        const isDsa = client?.sourced_via === 'dsa';
        const priceLabel = isDsa ? 'DSA price' : 'Client price';
        const priceRaw = isDsa ? (t as any).dsa_price : (t as any).per_unit_price;
        const price = Number(priceRaw);

        // A missing rate is NOT zero. Defaulting it to zero prices the whole
        // position at nothing and books the entire landing cost as a loss, so
        // one un-entered field can drag a whole month negative. Treat it
        // exactly like a missing landing cost — pending at ₹0, never computed.
        const priceMissing = priceRaw === null || priceRaw === undefined || priceRaw === ''
          || !Number.isFinite(price) || price <= 0;
        const landingMissing = landingRaw === null || landingRaw === undefined || landingRaw === '';

        if (priceMissing || landingMissing) {
          // Revenue is NOT the whole settlement. Show the row as pending (₹0)
          // so it doesn't distort MIS; the user enters the missing field on the
          // transaction to compute real revenue.
          const pending = [priceMissing ? priceLabel : null, landingMissing ? 'Landing cost' : null]
            .filter(Boolean).join(' and ');
          const known = [
            priceMissing ? null : `Price ${fmt(price)}`,
            landingMissing ? null : `Landing Cost ${fmt(Number(landingRaw))}`,
            `Qty ${qty}`,
          ].filter(Boolean).join(' | ');
          computed.push({
            ...rowDate,
            revenue_type: 'landing_cost',
            revenue: 0,
            notes: `⚠ ${pending} pending — enter on this transaction to compute revenue (${known})`,
          });
        } else {
          const landingCost = Number(landingRaw);
          const revenue = t.txn_type === 'sell'
            ? (landingCost - price) * qty
            : (price - landingCost) * qty;
          if (revenue !== 0) {
            const basis = dealId
              ? ` | Paid ${fmtDate(revenueDate)}`
              : ' | Dated by transaction (no deal confirmation)';
            computed.push({
              ...rowDate,
              revenue_type: 'landing_cost',
              revenue,
              notes: `Price: ${fmt(price)} | Landing Cost: ${fmt(landingCost)} | Qty: ${qty}${basis}`,
            });
          }
        }
      }

      // Insurance and MF trail stay dated by the transaction — they are
      // direct-entry revenue with no deal payment to recognise against. The
      // txns list now also carries rows pulled in by PAYMENT date, whose own
      // txn_date can fall outside the period, so both branches re-check it.

      // Insurance → flat insurance_revenue
      if (t.product_type === 'insurance' && inPeriod(t.txn_date)) {
        const rev = (t as any).insurance_revenue || 0;
        if (rev > 0) {
          computed.push({
            ...baseRow,
            revenue_type: 'insurance',
            revenue: rev,
            notes: `Policy: ${t.policy_number || '—'} | ${t.insurer_name || '—'}`,
          });
        }
      }

      // Mutual fund → trail commission at anniversary month of txn_date
      if (t.product_type === 'mutual_fund' && inPeriod(t.txn_date)
          && (t as any).trail_percent && (t as any).trail_start_date) {
        if (isTrailAnniversaryInMonth((t as any).trail_start_date, selectedYear, selectedMonth)) {
          const invested = t.consolidated_amount || 0;
          const trail = (t as any).trail_percent || 0;
          const revenue = (invested * trail) / 100;
          if (revenue > 0) {
            const yrs = selectedYear - new Date((t as any).trail_start_date).getFullYear();
            computed.push({
              ...baseRow,
              revenue_type: 'trail',
              revenue,
              notes: `Invested: ${fmt(invested)} | Trail: ${trail}% p.a. | Year ${yrs} anniversary`,
            });
          }
        }
      }
    }

    // ---------------------------------------------------------------------
    // Fully-paid deals that have NOT been booked into a transaction yet.
    // Revenue should be visible at PAYMENT time, without waiting for the
    // Transfer Queue / Add New Business booking. We surface each such deal
    // here (de-duplicated against booked deals, which are already counted
    // above via their transaction).
    // ---------------------------------------------------------------------
    const DEAL_TYPE: Record<string, ProductType> = {
      'Unlisted Share': 'unlisted_share',
      'Secondary Bond': 'secondary_bond',
      'Primary Bond': 'primary_bond',
    };

    // Selected by the date the deal CLEARED, exactly like the transactions
    // above — clearedOn only ever holds deals settled in full, so a part-paid
    // deal cannot appear here either.
    const clearedDeals = deals.filter(d => inPeriod(clearedOn.get(d.id)));

    {
      // A deal is "booked" once ANY transaction references it — including one
      // dated in a later month, which is normal: a deal confirmed on the 29th
      // is often transferred and booked in the following month. Deriving this
      // from the selected period's transactions alone made such a deal look
      // unbooked whenever its own month was viewed, so it reappeared here as a
      // phantom "awaiting booking" row in the deal month while its real revenue
      // was already counted in the month it was booked — one deal, two months.
      // Booking is now per LINE (a deal can hold several products, each booked
      // as its own transaction), so eligibility here is per line_item: recognise
      // a deal's un-booked lines even when its other lines are already booked.
      const bookedItemIds = new Set<string>();
      const itemsByDeal = new Map<string, any[]>();
      if (clearedDeals.length > 0) {
        const dealIds = clearedDeals.map(d => d.id);
        const [{ data: bookedRows }, { data: itemRows }] = await Promise.all([
          supabase.from('nw_transactions').select('deal_item_id').in('deal_confirmation_id', dealIds),
          supabase.from('nw_deal_confirmation_items')
            .select('id, deal_id, sort_order, product_type, security_name, quantity, base_rate, landing_cost')
            .in('deal_id', dealIds),
        ]);
        for (const b of (bookedRows ?? []) as any[]) {
          if (b.deal_item_id) bookedItemIds.add(b.deal_item_id);
        }
        for (const it of (itemRows ?? []) as any[]) {
          const arr = itemsByDeal.get(it.deal_id) ?? [];
          arr.push(it);
          itemsByDeal.set(it.deal_id, arr);
        }
      }

      for (const d of clearedDeals) {
        const client = clientList.find(c => c.id === d.client_id);
        if (!client) continue;
        // Fall back to the header as a single pseudo-line if a deal somehow has
        // no item rows, so nothing is silently dropped.
        const lines = (itemsByDeal.get(d.id) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
        const effLines = lines.length ? lines : [{
          id: null, product_type: d.product_type, security_name: d.security_name,
          quantity: d.quantity, base_rate: d.base_rate, landing_cost: d.landing_cost,
        }];

        for (const ln of effLines) {
          if (ln.id && bookedItemIds.has(ln.id)) continue;  // this line already counted via its transaction
          const prodNorm = DEAL_TYPE[ln.product_type as string];
          if (!prodNorm) continue;                          // landing-cost products only

          const qty = ln.quantity || 0;
          const price = Number(ln.base_rate);               // client pays base rate × qty
          // A missing base rate must not be read as zero, or the landing cost is
          // reported as a pure loss.
          const priceMissing = ln.base_rate === null || ln.base_rate === undefined || ln.base_rate === ''
            || !Number.isFinite(price) || price <= 0;
          const baseRow = {
            client_id: d.client_id,
            employee_id: client.employee_id ?? null,
            client_name: client.full_name,
            client_code: client.client_code,
            // Dated by payment, not by deal_date, so it sits in the same month
            // its revenue is recognised in.
            date: clearedOn.get(d.id) as string,
            product_type: prodNorm,
            product_name: ln.security_name,
          };

          const landingMissing = ln.landing_cost === null || ln.landing_cost === undefined;
          if (priceMissing || landingMissing) {
            const pending = [priceMissing ? 'Base rate' : null, landingMissing ? 'landing cost' : null]
              .filter(Boolean).join(' and ');
            const known = [
              priceMissing ? null : `Price ${fmt(price)}`,
              landingMissing ? null : `Landing ${fmt(Number(ln.landing_cost))}`,
              `Qty ${qty}`,
            ].filter(Boolean).join(' | ');
            computed.push({
              ...baseRow,
              revenue_type: 'landing_cost',
              revenue: 0,
              notes: `⚠ Paid, awaiting booking — enter ${pending} to compute revenue (${known})`,
            });
          } else {
            const landing = Number(ln.landing_cost);
            const revenue = d.transaction_type === 'Sell'
              ? (landing - price) * qty
              : (price - landing) * qty;
            computed.push({
              ...baseRow,
              revenue_type: 'landing_cost',
              revenue,
              notes: `Paid deal (not yet booked) — Price ${fmt(price)} | Landing ${fmt(landing)} | Qty ${qty}`,
            });
          }
        }
      }
    }

    // Newest first. Dates are ISO (YYYY-MM-DD) so they order correctly as
    // strings; client name breaks ties so rows from the same day keep a stable,
    // predictable order instead of shifting between loads.
    computed.sort((a, b) =>
      b.date.localeCompare(a.date) || a.client_name.localeCompare(b.client_name));
  return computed;
}
