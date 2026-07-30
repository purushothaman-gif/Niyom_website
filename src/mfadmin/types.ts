/**
 * MF Admin Portal — view models
 * -----------------------------------------------------------------------------
 * The employee-facing operations console over BSE StAR MF. Staff never touch
 * BSE's own UI: everything routes through AdminService (real MF aggregates from
 * the CRM tables) + BSEService (order/scheme boundary, mocked).
 */

/** AUM split bucket (by AMC, category, etc.). */
export interface AumBucket {
  key: string;
  label: string;
  color: string;
  value: number;
  percent: number;
  count: number;
}

/** A cross-client MF order row for the operations feed. */
export interface AdminOrderRow {
  id: string;
  clientName: string;
  clientCode: string;
  scheme: string;
  type: 'buy' | 'sell';
  amount: number;
  date: string;
  /** Operational state — pending/confirmed are BSE-side (mocked for now). */
  status: 'confirmed' | 'pending' | 'rejected';
}

/** A client ranked by MF assets under management. */
export interface ClientAum {
  clientId: string;
  name: string;
  code: string;
  aum: number;
  invested: number;
  gainPercent: number;
  holdings: number;
}

/** Everything the admin dashboard needs in one aggregate. */
export interface AdminDashboardData {
  /* Real — computed from nw_holdings (mutual_fund) across all clients. */
  mfAum: number;
  mfInvested: number;
  mfGainPercent: number;
  activeClients: number;
  totalClients: number;
  amcSplit: AumBucket[];
  topClients: ClientAum[];
  recentOrders: AdminOrderRow[];

  /* BSE-side operational metrics — live from the proxy when it is reachable. */
  /** SXP registrations currently `active` at BSE. */
  liveSips: number;
  /** Orders still working their way through the BSE lifecycle. */
  pendingOrders: number;
  /** Orders placed at BSE today. */
  todaysOrders: number;
  /** UCCs registered at BSE, and how many can actually transact. */
  uccTotal: number;
  uccActive: number;
  /**
   * Estimated trail brokerage month-to-date. Derived from CRM holdings
   * (real trail_percent) — BSE does not expose accrued trail, so this stays an
   * estimate even when the ops metrics above are live.
   */
  trailMtd: number;
  /**
   * True when the BSE ops metrics could NOT be loaded and the figures above are
   * illustrative. The UI must say so rather than passing them off as live.
   */
  isMockOps: boolean;
  /** Why BSE data is unavailable, when it is. */
  opsError?: string;
}
