/**
 * AdminService — the MF Admin dashboard aggregate.
 *
 * STANDALONE BY DESIGN: this console covers BSE StAR MF and nothing else. It
 * reads only the NIYOM BSE proxy — never CRM tables (nw_clients, nw_holdings,
 * nw_transactions, dsa_debit_notes). A client existing in the CRM says nothing
 * about their BSE registration, and mixing the two produced figures that looked
 * like BSE data but weren't. If a number here can't come from BSE, it isn't
 * shown.
 */
import { BseOpsService, isBseConfigured } from './BseOpsService';
import type { AdminDashboardData, AdminOrderRow, AumBucket } from '../types';
import { ALLOCATION_PALETTE } from '../../portal/services/palette';

const ORDER_TYPE: Record<string, AdminOrderRow['type']> = {
  p: 'buy',
  r: 'sell',
  s: 'buy',
};

/** Orders still moving through BSE's lifecycle (not done/rejected/cancelled). */
function isPending(status: string): boolean {
  const s = status.toLowerCase();
  return !(s === 'done' || s.includes('reject') || s.includes('cancel') || s.includes('settled'));
}

function sameDay(iso: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const n = new Date();
  return (
    d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
  );
}

export const AdminService = {
  async getDashboard(): Promise<AdminDashboardData> {
    if (!isBseConfigured()) {
      throw new Error('BSE proxy is not configured (VITE_BSE_PROXY_URL).');
    }

    const [orders, sxp, uccs, holdings] = await Promise.all([
      BseOpsService.orders(),
      BseOpsService.sxp(),
      BseOpsService.uccs(),
      // Netted from allotted orders — empty until BSE settles something.
      BseOpsService.holdings().catch(() => []),
    ]);

    const bookValue = holdings.reduce((s, h) => s + h.value, 0);
    const invested = holdings.reduce((s, h) => s + h.invested, 0);

    // Traded value by scheme — the closest thing to an allocation split that
    // BSE alone can tell us, since it reports no AUM.
    const schemeMap = new Map<string, { value: number; count: number }>();
    for (const o of orders) {
      const key = o.schemeName || o.schemeCode || 'Unknown';
      const e = schemeMap.get(key) ?? { value: 0, count: 0 };
      e.value += o.amount;
      e.count += 1;
      schemeMap.set(key, e);
    }
    const totalTraded = [...schemeMap.values()].reduce((s, e) => s + e.value, 0);
    const schemeSplit: AumBucket[] = [...schemeMap.entries()]
      .map(([key, e], i) => ({
        key,
        label: key,
        color: ALLOCATION_PALETTE[i % ALLOCATION_PALETTE.length],
        value: e.value,
        percent: totalTraded > 0 ? (e.value / totalTraded) * 100 : 0,
        count: e.count,
      }))
      .sort((a, b) => b.value - a.value);

    const recentOrders: AdminOrderRow[] = orders.slice(0, 8).map((o) => ({
      id: o.orderId,
      clientName: o.clientName?.trim() || o.clientCode,
      clientCode: o.clientCode,
      scheme: o.schemeName || o.schemeCode,
      type: ORDER_TYPE[o.type] ?? 'buy',
      amount: o.amount,
      date: o.placedAt,
      status: isPending(o.status) ? 'pending' : 'confirmed',
    }));

    return {
      bookValue,
      invested,
      uccTotal: uccs.length,
      uccActive: uccs.filter((u) => u.status.toUpperCase() === 'ACTIVE').length,
      liveSips: sxp.filter((s) => s.status.toLowerCase() === 'active').length,
      sxpTotal: sxp.length,
      pendingOrders: orders.filter((o) => isPending(o.status)).length,
      todaysOrders: orders.filter((o) => sameDay(o.placedAt)).length,
      totalOrders: orders.length,
      tradedValue: totalTraded,
      schemeSplit,
      recentOrders,
    };
  },
};
