/**
 * TransactionService
 * -----------------------------------------------------------------------------
 * Fetches the client's full transaction history (the snapshot only carries the
 * latest few for the dashboard) and provides pure filter/summary/group helpers.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import type { NWTransaction, ProductType } from '../../crm/types';
import { PRODUCT_LABELS, PRODUCT_CHART_COLORS } from '../../crm/utils';
import type { TransactionRow, TxnFilter, TxnSummary } from '../types/activity';

export const TransactionService = {
  /** All transactions for a client, newest first. Sole Supabase boundary here. */
  async getAll(clientId: string): Promise<NWTransaction[]> {
    const { data, error } = await supabase
      .from('nw_transactions')
      .select('*')
      .eq('client_id', clientId)
      .order('txn_date', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as NWTransaction[]) ?? [];
  },

  /** Normalize DB rows into presentation rows. */
  toRows(txns: NWTransaction[]): TransactionRow[] {
    return txns.map((t) => ({
      id: t.id,
      productType: t.product_type as ProductType,
      productLabel: PRODUCT_LABELS[t.product_type] ?? t.product_type,
      productColor: PRODUCT_CHART_COLORS[t.product_type] ?? '#7688A4',
      name: t.product_name,
      txnType: t.txn_type,
      amount: t.consolidated_amount || 0,
      units: t.quantity ?? undefined,
      price: t.per_unit_price ?? undefined,
      date: t.txn_date,
    }));
  },

  /** Apply search + product + type filters. */
  filter(rows: TransactionRow[], f: TxnFilter): TransactionRow[] {
    const q = f.query.trim().toLowerCase();
    return rows.filter((r) => {
      if (f.product !== 'all' && r.productType !== f.product) return false;
      if (f.type !== 'all' && r.txnType !== f.type) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  },

  summary(rows: TransactionRow[]): TxnSummary {
    return rows.reduce<TxnSummary>(
      (acc, r) => {
        if (r.txnType === 'buy') acc.invested += r.amount;
        else acc.redeemed += r.amount;
        acc.count += 1;
        return acc;
      },
      { invested: 0, redeemed: 0, count: 0 },
    );
  },

  /** Group rows into month buckets (keeps input order within a group). */
  groupByMonth(rows: TransactionRow[]): Array<{ key: string; label: string; rows: TransactionRow[] }> {
    const groups = new Map<string, { label: string; rows: TransactionRow[] }>();
    for (const r of rows) {
      const d = new Date(r.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const g = groups.get(key) ?? { label, rows: [] };
      g.rows.push(r);
      groups.set(key, g);
    }
    return [...groups.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, g]) => ({ key, label: g.label, rows: g.rows }));
  },
};
