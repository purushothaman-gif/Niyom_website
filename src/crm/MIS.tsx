import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { NWEmployee, NWTransaction, NWClient, ProductType } from './types';
import { fmt, fmtDate, PRODUCT_LABELS } from './utils';
import { BarChart3, Download, ChevronDown } from 'lucide-react';

interface Props { employee: NWEmployee; }

interface MISRow {
  client_id: string;
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

function getLastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function isTrailAnniversaryInMonth(trailStartDate: string, year: number, month: number): boolean {
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

export default function MIS({ employee }: Props) {
  const today = new Date();
  const [selectedYear, setSelectedYear] = useState(today.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(today.getMonth()); // 0-indexed
  const [rows, setRows] = useState<MISRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [empList, setEmpList] = useState<{ id: string; full_name: string; employee_code: string }[]>([]);
  const [empFilter, setEmpFilter] = useState('all');

  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';

  useEffect(() => {
    if (!isAdmin) return;
    supabase.from('nw_employees').select('id, full_name, employee_code').eq('status', 'active').order('full_name')
      .then(({ data }) => setEmpList((data as any[]) || []));
  }, [isAdmin]);

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const years = Array.from({ length: 5 }, (_, i) => today.getFullYear() - i);

  const startDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-01`;
  const endDay = getLastDayOfMonth(selectedYear, selectedMonth);
  const endDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

  const calculate = useCallback(async () => {
    setLoading(true);

    // Fetch clients (admin = all or filtered by employee, employee = own)
    let clientQuery = supabase.from('nw_clients').select('id, full_name, client_code, employee_id, sourced_via');;
    if (!isAdmin) clientQuery = clientQuery.eq('employee_id', employee.id);
    else if (empFilter !== 'all') clientQuery = clientQuery.eq('employee_id', empFilter);
    const { data: clientData } = await clientQuery;
    const clientList = (clientData as NWClient[]) || [];
    const clientIds = clientList.map(c => c.id);

    if (clientIds.length === 0) { setRows([]); setLoading(false); setHasLoaded(true); return; }

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
      const bookedDealIds = new Set<string>();
      if (clearedDeals.length > 0) {
        const { data: bookedRows } = await supabase
          .from('nw_transactions')
          .select('deal_confirmation_id')
          .in('deal_confirmation_id', clearedDeals.map(d => d.id));
        for (const b of (bookedRows ?? []) as any[]) {
          if (b.deal_confirmation_id) bookedDealIds.add(b.deal_confirmation_id);
        }
      }

      for (const d of clearedDeals) {
        if (bookedDealIds.has(d.id)) continue;  // already counted via its transaction
        const prodNorm = DEAL_TYPE[d.product_type as string];
        if (!prodNorm) continue;                // landing-cost products only
        const client = clientList.find(c => c.id === d.client_id);
        if (!client) continue;

        const qty = d.quantity || 0;
        const price = Number(d.base_rate);      // client pays base rate × qty
        // Same guard as the transaction branch above: a missing base rate must
        // not be read as zero, or the landing cost is reported as a pure loss.
        const priceMissing = d.base_rate === null || d.base_rate === undefined || d.base_rate === ''
          || !Number.isFinite(price) || price <= 0;
        const baseRow = {
          client_id: d.client_id,
          client_name: client.full_name,
          client_code: client.client_code,
          // Dated by payment, not by deal_date, so it sits in the same month
          // its revenue is recognised in.
          date: clearedOn.get(d.id) as string,
          product_type: prodNorm,
          product_name: d.security_name,
        };

        const landingMissing = d.landing_cost === null || d.landing_cost === undefined;
        if (priceMissing || landingMissing) {
          // Paid but not fully priced yet — show it so it isn't lost, without
          // guessing revenue. Enter the missing field (book it) to compute it.
          const pending = [priceMissing ? 'Base rate' : null, landingMissing ? 'landing cost' : null]
            .filter(Boolean).join(' and ');
          const known = [
            priceMissing ? null : `Price ${fmt(price)}`,
            landingMissing ? null : `Landing ${fmt(Number(d.landing_cost))}`,
            `Qty ${qty}`,
          ].filter(Boolean).join(' | ');
          computed.push({
            ...baseRow,
            revenue_type: 'landing_cost',
            revenue: 0,
            notes: `⚠ Paid, awaiting booking — enter ${pending} to compute revenue (${known})`,
          });
        } else {
          const landing = Number(d.landing_cost);
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

    // Newest first. Dates are ISO (YYYY-MM-DD) so they order correctly as
    // strings; client name breaks ties so rows from the same day keep a stable,
    // predictable order instead of shifting between loads.
    computed.sort((a, b) =>
      b.date.localeCompare(a.date) || a.client_name.localeCompare(b.client_name));

    setRows(computed);
    setLoading(false);
    setHasLoaded(true);
  }, [selectedYear, selectedMonth, empFilter, isAdmin, employee.id, startDate, endDate]);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const byType = {
    landing_cost: rows.filter(r => r.revenue_type === 'landing_cost').reduce((s, r) => s + r.revenue, 0),
    insurance: rows.filter(r => r.revenue_type === 'insurance').reduce((s, r) => s + r.revenue, 0),
    trail: rows.filter(r => r.revenue_type === 'trail').reduce((s, r) => s + r.revenue, 0),
  };

  const revenueTypeLabel: Record<string, string> = {
    landing_cost: 'Unlisted / Bonds',
    insurance: 'Insurance',
    trail: 'MF Trail',
  };
  // RGB triplets so on-screen badges can composite tint + solid via rgba()/rgb().
  const revenueTypeColor: Record<string, string> = {
    landing_cost: 'var(--accent-rgb)',
    insurance: '249, 115, 22',
    trail: '236, 72, 153',
  };

  const printMIS = () => {
    const logoHtml = `<div style="font-weight:900;font-size:22px;color:#111;font-family:Georgia,serif;">Niyom Wealth</div>`;

    const rowsHtml = rows.map((r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td style="white-space:nowrap">${fmtDate(r.date)}</td>
        <td><strong>${r.client_name}</strong><br><span style="color:#888;font-size:11px">${r.client_code}</span></td>
        <td>${PRODUCT_LABELS[r.product_type] || r.product_type}</td>
        <td>${r.product_name}</td>
        <td>${revenueTypeLabel[r.revenue_type]}</td>
        <td>${r.notes}</td>
        <td style="text-align:right;font-weight:700;color:${r.revenue >= 0 ? '#059669' : '#DC2626'}">
          ${r.revenue >= 0 ? '' : '-'}&#8377;${Math.abs(r.revenue).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </td>
      </tr>`).join('');

    const html = `<!DOCTYPE html>
<html>
<head>
  <title>MIS Report — ${MONTHS[selectedMonth]} ${selectedYear}</title>
  <style>
    @page { margin: 18mm 14mm; }
    body { font-family: Arial, sans-serif; color: #111; font-size: 12px; }
    .header { display:flex; align-items:center; justify-content:space-between; border-bottom:3px solid #d4af37; padding-bottom:12px; margin-bottom:16px; }
    .period { font-size:11px; color:#888; }
    .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:20px; }
    .stat { background:#f8f8f8; border-radius:6px; padding:10px 12px; border-top:3px solid #eee; }
    .stat-label { font-size:9px; color:#999; text-transform:uppercase; letter-spacing:0.08em; }
    .stat-value { font-size:16px; font-weight:800; margin-top:3px; }
    table { width:100%; border-collapse:collapse; }
    th { background:#f2f2f2; padding:7px 9px; text-align:left; font-size:10px; text-transform:uppercase; color:#777; border-bottom:1px solid #e0e0e0; }
    td { padding:7px 9px; border-bottom:1px solid #f0f0f0; font-size:11px; vertical-align:top; }
    .footer { margin-top:28px; text-align:center; font-size:10px; color:#aaa; border-top:1px solid #eee; padding-top:10px; }
  </style>
</head>
<body>
  <div class="header">
    <div>${logoHtml}<div class="period">MIS Report &nbsp;&middot;&nbsp; ${MONTHS[selectedMonth]} ${selectedYear} &nbsp;&middot;&nbsp; ${startDate} to ${endDate}</div></div>
    <div style="text-align:right"><div style="font-size:20px;font-weight:800;color:#059669">&#8377;${totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div><div style="font-size:10px;color:#888">Total Revenue</div></div>
  </div>
  <div class="stats">
    <div class="stat" style="border-top-color:#d4af37"><div class="stat-label">Unlisted / Bonds</div><div class="stat-value" style="color:#d4af37">&#8377;${byType.landing_cost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div></div>
    <div class="stat" style="border-top-color:#f97316"><div class="stat-label">Insurance</div><div class="stat-value" style="color:#f97316">&#8377;${byType.insurance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div></div>
    <div class="stat" style="border-top-color:#ec4899"><div class="stat-label">MF Trail</div><div class="stat-value" style="color:#ec4899">&#8377;${byType.trail.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div></div>
    <div class="stat" style="border-top-color:#059669"><div class="stat-label">Total Entries</div><div class="stat-value">${rows.length}</div></div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Date</th><th>Client</th><th>Product Type</th><th>Product</th><th>Revenue Type</th><th>Details</th><th style="text-align:right">Revenue</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;padding:20px;color:#aaa">No revenue entries for this period</td></tr>'}</tbody>
  </table>
  <div class="footer">Niyom Wealth Distribution &nbsp;&middot;&nbsp; Confidential &nbsp;&middot;&nbsp; Generated ${new Date().toLocaleString('en-IN')}</div>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 400);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Revenue</p>
          <h1 className="text-2xl font-bold text-text-primary">MIS Report</h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Revenue is counted in the month the payment was received, not the month the deal was booked.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasLoaded && rows.length > 0 && (
            <button onClick={printMIS}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <Download className="w-4 h-4" /> Download PDF
            </button>
          )}
          <button onClick={calculate} disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
            <BarChart3 className="w-4 h-4" />
            {loading ? 'Calculating...' : 'Generate MIS'}
          </button>
        </div>
      </div>

      {/* Period selector */}
      <div className="rounded-2xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Select Period</p>
        <div className="flex items-center gap-3 flex-wrap">
          {isAdmin && (
            <div className="relative">
              <select value={empFilter} onChange={e => setEmpFilter(e.target.value)}
                className="pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
                style={{ background: 'var(--bg-base)', border: '1px solid rgba(var(--accent-rgb),0.4)' }}>
                <option value="all">All Employees</option>
                {empList.map(e => <option key={e.id} value={e.id}>{e.full_name} ({e.employee_code})</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--accent)' }} />
            </div>
          )}
          <div className="relative">
            <select value={selectedMonth} onChange={e => setSelectedMonth(parseInt(e.target.value))}
              className="pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
          </div>
          <div className="relative">
            <select value={selectedYear} onChange={e => setSelectedYear(parseInt(e.target.value))}
              className="pl-3 pr-8 py-2.5 rounded-xl text-sm text-text-primary outline-none appearance-none"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
          </div>
          <div className="px-3 py-2.5 rounded-xl text-sm" style={{ background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.2)', color: 'var(--accent)' }}>
            {startDate} &rarr; {endDate}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {hasLoaded && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Total Revenue', value: fmt(totalRevenue), color: 'var(--success)' },
            { label: 'Unlisted / Bonds', value: fmt(byType.landing_cost), color: 'var(--accent)' },
            { label: 'Insurance', value: fmt(byType.insurance), color: 'var(--chart-6)' },
            { label: 'MF Trail', value: fmt(byType.trail), color: 'var(--chart-4)' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-faint)' }}>{s.label}</p>
              <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Revenue table */}
      {hasLoaded && (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            <p className="text-sm font-bold text-text-primary">Revenue Breakdown — {MONTHS[selectedMonth]} {selectedYear}</p>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full nw-table">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Date', 'Client', 'Product', 'Type', 'Revenue Type', 'Details', 'Revenue'].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-12 text-sm" style={{ color: 'var(--text-faint)' }}>
                    No revenue entries for {MONTHS[selectedMonth]} {selectedYear}
                  </td></tr>
                ) : rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <p className="text-sm text-text-primary">{fmtDate(r.date)}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-text-primary">{r.client_name}</p>
                      <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{r.client_code}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-text-primary">{r.product_name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{PRODUCT_LABELS[r.product_type] || r.product_type}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-strong)' }}>
                        {PRODUCT_LABELS[r.product_type]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs font-bold px-2 py-1 rounded-lg"
                        style={{ background: `rgba(${revenueTypeColor[r.revenue_type]}, 0.08)`, color: `rgb(${revenueTypeColor[r.revenue_type]})` }}>
                        {revenueTypeLabel[r.revenue_type]}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 max-w-[200px]">
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.notes}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <p className={`text-sm font-bold ${r.revenue >= 0 ? 'text-c-emerald' : 'text-c-red'}`}>
                        {r.revenue >= 0 ? '' : '-'}{fmt(Math.abs(r.revenue))}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)' }}>
                    <td colSpan={6} className="px-5 py-3.5 text-sm font-bold text-text-primary">Total Revenue</td>
                    <td className="px-5 py-3.5 text-sm font-bold text-c-emerald">{fmt(totalRevenue)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {!hasLoaded && (
        <div className="rounded-2xl p-12 text-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <BarChart3 className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--border-strong)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-faint)' }}>Select a period and click Generate MIS</p>
          <p className="text-xs mt-1" style={{ color: 'var(--border-strong)' }}>Revenue is calculated based on holdings data entered by your team</p>
        </div>
      )}
    </div>

    
  );
}
