/**
 * AdminService
 * -----------------------------------------------------------------------------
 * Read-side aggregates for the MF Admin Portal. Reads the CRM tables across ALL
 * clients (employee-scoped) and derives operations metrics. BSE-specific
 * operational figures (pending orders, live SIP count, trail brokerage) are
 * clearly mocked until the BSE gateway is wired — flagged via isMockOps.
 */
import { supabase } from '../../lib/supabase';
import { ALLOCATION_PALETTE } from '../../portal/services/palette';
import { BseOpsService, isBseConfigured } from './BseOpsService';
import type { AdminDashboardData, AdminOrderRow, AumBucket, ClientAum } from '../types';

/** BSE order states that are still in flight (i.e. not done/rejected/cancelled). */
function isPendingOrder(status: string): boolean {
  const s = status.toLowerCase();
  if (s === 'done' || s.includes('reject') || s.includes('cancel') || s.includes('settled')) {
    return false;
  }
  return true;
}

interface BseOps {
  liveSips: number;
  pendingOrders: number;
  todaysOrders: number;
  uccTotal: number;
  uccActive: number;
}

/**
 * Live operational counts from BSE, via the proxy. Returns null (rather than
 * throwing) when BSE is unreachable or unconfigured, so a BSE outage degrades
 * the ops tiles instead of taking down the whole dashboard.
 */
async function loadBseOps(): Promise<{ ops: BseOps | null; error?: string }> {
  if (!isBseConfigured()) return { ops: null, error: 'BSE proxy is not configured.' };
  try {
    const [orders, sxp, uccs] = await Promise.all([
      BseOpsService.orders(),
      BseOpsService.sxp(),
      BseOpsService.uccs(),
    ]);
    return {
      ops: {
        liveSips: sxp.filter((s) => s.status.toLowerCase() === 'active').length,
        pendingOrders: orders.filter((o) => isPendingOrder(o.status)).length,
        todaysOrders: orders.filter((o) => o.placedAt && sameDay(o.placedAt)).length,
        uccTotal: uccs.length,
        uccActive: uccs.filter((u) => u.status.toUpperCase() === 'ACTIVE').length,
      },
    };
  } catch (err) {
    return { ops: null, error: err instanceof Error ? err.message : 'BSE is unreachable.' };
  }
}

interface HoldingLite {
  client_id: string;
  current_value: number | null;
  invested_amount: number | null;
  fund_house: string | null;
  trail_percent: number | null;
  client?: { full_name: string; client_code: string } | null;
}

interface TxnLite {
  id: string;
  product_name: string;
  txn_type: 'buy' | 'sell';
  consolidated_amount: number | null;
  txn_date: string;
  client?: { full_name: string; client_code: string } | null;
}

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

export const AdminService = {
  async getDashboard(): Promise<AdminDashboardData> {
    const [holdingsRes, txnRes, clientCountRes, bse] = await Promise.all([
      supabase
        .from('nw_holdings')
        .select('client_id, current_value, invested_amount, fund_house, trail_percent, client:nw_clients(full_name, client_code)')
        .eq('product_type', 'mutual_fund'),
      supabase
        .from('nw_transactions')
        .select('id, product_name, txn_type, consolidated_amount, txn_date, client:nw_clients(full_name, client_code)')
        .eq('product_type', 'mutual_fund')
        .order('txn_date', { ascending: false })
        .limit(8),
      supabase.from('nw_clients').select('id', { count: 'exact', head: true }),
      loadBseOps(),
    ]);

    const holdings = (holdingsRes.data as unknown as HoldingLite[]) ?? [];
    const txns = (txnRes.data as unknown as TxnLite[]) ?? [];
    const totalClients = clientCountRes.count ?? 0;

    const mfAum = holdings.reduce((s, h) => s + (h.current_value || 0), 0);
    const mfInvested = holdings.reduce((s, h) => s + (h.invested_amount || 0), 0);

    // AMC-wise AUM split.
    const amcMap = new Map<string, { value: number; count: number }>();
    for (const h of holdings) {
      const amc = h.fund_house || 'Other';
      const e = amcMap.get(amc) ?? { value: 0, count: 0 };
      e.value += h.current_value || 0;
      e.count += 1;
      amcMap.set(amc, e);
    }
    const amcSplit: AumBucket[] = [...amcMap.entries()]
      .map(([key, e], i) => ({
        key,
        label: key,
        color: ALLOCATION_PALETTE[i % ALLOCATION_PALETTE.length],
        value: e.value,
        percent: pct(e.value, mfAum),
        count: e.count,
      }))
      .sort((a, b) => b.value - a.value);

    // Top clients by MF AUM.
    const clientMap = new Map<string, ClientAum>();
    for (const h of holdings) {
      const c = clientMap.get(h.client_id) ?? {
        clientId: h.client_id,
        name: h.client?.full_name ?? '—',
        code: h.client?.client_code ?? '—',
        aum: 0,
        invested: 0,
        gainPercent: 0,
        holdings: 0,
      };
      c.aum += h.current_value || 0;
      c.invested += h.invested_amount || 0;
      c.holdings += 1;
      clientMap.set(h.client_id, c);
    }
    const topClients = [...clientMap.values()]
      .map((c) => ({ ...c, gainPercent: pct(c.aum - c.invested, c.invested) }))
      .sort((a, b) => b.aum - a.aum)
      .slice(0, 6);

    const recentOrders: AdminOrderRow[] = txns.map((t) => ({
      id: t.id,
      clientName: t.client?.full_name ?? '—',
      clientCode: t.client?.client_code ?? '—',
      scheme: t.product_name,
      type: t.txn_type,
      amount: t.consolidated_amount || 0,
      date: t.txn_date,
      status: 'confirmed',
    }));

    // Estimated trail brokerage MTD (real inputs, illustrative math).
    const trailAnnual = holdings.reduce(
      (s, h) => s + ((h.current_value || 0) * (h.trail_percent || 0)) / 100,
      0,
    );

    return {
      mfAum,
      mfInvested,
      mfGainPercent: pct(mfAum - mfInvested, mfInvested),
      activeClients: clientMap.size,
      totalClients,
      amcSplit,
      topClients,
      recentOrders,
      // Ops metrics: live from BSE when the proxy answers, else clearly flagged
      // as illustrative rather than quietly showing invented numbers.
      liveSips: bse.ops?.liveSips ?? Math.round(clientMap.size * 1.6),
      pendingOrders: bse.ops?.pendingOrders ?? Math.min(9, Math.round(clientMap.size * 0.2)),
      todaysOrders: bse.ops?.todaysOrders ?? recentOrders.filter((o) => sameDay(o.date)).length,
      uccTotal: bse.ops?.uccTotal ?? 0,
      uccActive: bse.ops?.uccActive ?? 0,
      trailMtd: trailAnnual / 12,
      isMockOps: bse.ops === null,
      opsError: bse.error,
    };
  },
};

function sameDay(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
