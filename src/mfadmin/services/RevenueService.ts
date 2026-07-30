/**
 * RevenueService — the two sides of MF revenue.
 *
 * DATA PROVENANCE, because getting this wrong in a regulated business is worse
 * than showing nothing:
 *
 * BROKERAGE (what NIYOM earns) is an ACCRUAL ESTIMATE computed from
 * nw_holdings.trail_percent. BSE does NOT report settled brokerage to our
 * member tier — get_mis_detail, get_payment_detail and list_payment_detail all
 * return errcode `authz`. So these figures are a run-rate on real holdings, not
 * money BSE has confirmed or paid. Every surface must say so.
 *
 * COMMISSION (what NIYOM pays DSAs) is READ from dsa_debit_notes, which
 * DSAPayout.tsx has already computed and issued. The payout formula lives
 * there and only there — this module must never recompute it, or the two will
 * drift and the debit notes are the legally issued document.
 */
import { supabase } from '../../lib/supabase';

/* ------------------------------- Brokerage -------------------------------- */

export interface TrailRow {
  clientId: string;
  clientName: string;
  clientCode: string;
  amc: string;
  scheme: string;
  value: number;
  trailPercent: number;
  /** value × trail% — what this holding earns in a year at today's value. */
  annual: number;
}

export interface BrokerageSummary {
  rows: TrailRow[];
  totalValue: number;
  annualTrail: number;
  monthlyTrail: number;
  /** Holdings with no trail_percent set — silently earning nothing in this view. */
  missingTrail: number;
  byAmc: { amc: string; value: number; annual: number; count: number }[];
}

interface HoldingRow {
  client_id: string;
  fund_house: string | null;
  scheme_name: string | null;
  current_value: number | null;
  trail_percent: number | null;
  client?: { full_name: string; client_code: string } | null;
}

/* ------------------------------- Commission ------------------------------- */

export interface CommissionNote {
  id: string;
  noteNumber: string;
  dsaName: string;
  dsaCode: string;
  month: number;
  year: number;
  payout: number;
  tds: number;
  net: number;
  status: string;
  signatureStatus: string;
  generatedAt: string;
  paidAt: string | null;
}

export interface CommissionSummary {
  notes: CommissionNote[];
  totalPayout: number;
  totalTds: number;
  totalNet: number;
  paidNet: number;
  outstandingNet: number;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
export const monthLabel = (m: number) => MONTHS[Math.min(Math.max(m, 1), 12) - 1] ?? String(m);

export const RevenueService = {
  /** Trail brokerage accrual across all mutual-fund holdings. */
  async brokerage(): Promise<BrokerageSummary> {
    const { data, error } = await supabase
      .from('nw_holdings')
      .select(
        'client_id, fund_house, scheme_name, current_value, trail_percent, client:nw_clients(full_name, client_code)',
      )
      .eq('product_type', 'mutual_fund');
    if (error) throw new Error(error.message);

    const holdings = (data as unknown as HoldingRow[]) ?? [];
    const rows: TrailRow[] = holdings
      .map((h) => {
        const value = Number(h.current_value ?? 0);
        const trailPercent = Number(h.trail_percent ?? 0);
        return {
          clientId: h.client_id,
          clientName: h.client?.full_name ?? '—',
          clientCode: h.client?.client_code ?? '—',
          amc: h.fund_house || 'Unknown AMC',
          scheme: h.scheme_name || '—',
          value,
          trailPercent,
          annual: (value * trailPercent) / 100,
        };
      })
      .sort((a, b) => b.annual - a.annual);

    const totalValue = rows.reduce((s, r) => s + r.value, 0);
    const annualTrail = rows.reduce((s, r) => s + r.annual, 0);

    const amcMap = new Map<string, { value: number; annual: number; count: number }>();
    for (const r of rows) {
      const e = amcMap.get(r.amc) ?? { value: 0, annual: 0, count: 0 };
      e.value += r.value;
      e.annual += r.annual;
      e.count += 1;
      amcMap.set(r.amc, e);
    }

    return {
      rows,
      totalValue,
      annualTrail,
      monthlyTrail: annualTrail / 12,
      missingTrail: rows.filter((r) => r.trailPercent <= 0).length,
      byAmc: [...amcMap.entries()]
        .map(([amc, e]) => ({ amc, ...e }))
        .sort((a, b) => b.annual - a.annual),
    };
  },

  /**
   * DSA commission, read from the debit notes DSAPayout.tsx already issued.
   * Deliberately a read — never a recomputation (see the file header).
   */
  async commission(): Promise<CommissionSummary> {
    const { data, error } = await supabase
      .from('dsa_debit_notes')
      .select(
        'id, debit_note_number, month, year, payout_amount, tds_amount, net_payable_amount, status, signature_status, generated_at, paid_at, dsa:nw_dsa(full_name, dsa_code)',
      )
      .order('generated_at', { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);

    const notes: CommissionNote[] = (
      (data as unknown as Record<string, unknown>[]) ?? []
    ).map((n) => {
      const dsa = (n.dsa as { full_name?: string; dsa_code?: string } | null) ?? null;
      return {
        id: String(n.id),
        noteNumber: String(n.debit_note_number ?? ''),
        dsaName: dsa?.full_name ?? '—',
        dsaCode: dsa?.dsa_code ?? '—',
        month: Number(n.month ?? 0),
        year: Number(n.year ?? 0),
        payout: Number(n.payout_amount ?? 0),
        tds: Number(n.tds_amount ?? 0),
        net: Number(n.net_payable_amount ?? 0),
        status: String(n.status ?? ''),
        signatureStatus: String(n.signature_status ?? ''),
        generatedAt: String(n.generated_at ?? ''),
        paidAt: (n.paid_at as string) ?? null,
      };
    });

    // Cancelled notes are superseded — they must not inflate any total.
    const live = notes.filter((n) => n.status.toLowerCase() !== 'cancelled');
    const paidNet = live
      .filter((n) => n.status.toLowerCase() === 'paid')
      .reduce((s, n) => s + n.net, 0);
    const totalNet = live.reduce((s, n) => s + n.net, 0);

    return {
      notes,
      totalPayout: live.reduce((s, n) => s + n.payout, 0),
      totalTds: live.reduce((s, n) => s + n.tds, 0),
      totalNet,
      paidNet,
      outstandingNet: totalNet - paidNet,
    };
  },
};
