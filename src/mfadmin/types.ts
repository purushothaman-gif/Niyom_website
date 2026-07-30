/**
 * MF Admin Portal — view models
 * -----------------------------------------------------------------------------
 * The employee-facing operations console over BSE StAR MF. It is STANDALONE:
 * every figure below comes from BSE via the NIYOM proxy, never from CRM tables.
 * BSE reports no AUM and no brokerage to our member tier, so those concepts are
 * deliberately absent — what's here is the order/UCC/SXP book BSE does give us.
 */

/** A split bucket (by scheme, AMC, etc.) for the allocation chart. */
export interface AumBucket {
  key: string;
  label: string;
  color: string;
  value: number;
  percent: number;
  count: number;
}

/** A cross-client order row for the operations feed. */
export interface AdminOrderRow {
  id: string;
  clientName: string;
  clientCode: string;
  scheme: string;
  type: 'buy' | 'sell';
  amount: number;
  date: string;
  status: 'confirmed' | 'pending' | 'rejected';
}

/** Everything the admin dashboard needs, all of it sourced from BSE. */
export interface AdminDashboardData {
  /**
   * Netted from allotted orders — BSE exposes no holdings API to our member
   * tier, so this stays zero until orders actually settle.
   */
  bookValue: number;
  invested: number;

  /* UCC book */
  uccTotal: number;
  uccActive: number;

  /* Systematic plans */
  liveSips: number;
  sxpTotal: number;

  /* Order book */
  pendingOrders: number;
  todaysOrders: number;
  totalOrders: number;
  /** Gross value of orders placed — BSE reports no AUM, so this is the proxy for scale. */
  tradedValue: number;

  schemeSplit: AumBucket[];
  recentOrders: AdminOrderRow[];
}
